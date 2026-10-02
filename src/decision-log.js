import { DecisionLogError, notFound, forbidden, invalid, conflict } from './errors.js';
import { MemoryStore } from './store.js';
import { resolveSettings } from './settings.js';
import { tallyVotes, isApproved } from './voting.js';
import { diffMarkdown } from './diff.js';
import { lexicalFinder, RELATIONSHIP_TYPES } from './related.js';
import { DEFAULT_TEMPLATE } from './template.js';
import * as queries from './queries.js';
import { sha256, clone, pad, dateOf, isDateString, isNonEmpty, hms, clampInt } from './util.js';

export { MemoryStore, DecisionLogError };

const ROLES = ['member', 'lead', 'admin'];
const VOTES = ['approve', 'request_revision', 'abstain'];
const PRIORITIES = ['high', 'medium', 'low'];
const ROLE_ORDER = ['owner', 'contributor', 'reviewer', 'approver', 'decliner'];
const EDIT_WINDOW_MS = 5 * 60_000;
const GENESIS = '0'.repeat(64);

const ALL_STATES = ['draft', 'proposed', 'declined', 'approved'];

export class DecisionLog {
  constructor({ clock = () => new Date(), store = new MemoryStore(), relatedFinder = lexicalFinder, relatedThreshold = 60 } = {}) {
    this.clock = clock;
    this.store = store;
    this.finder = relatedFinder ?? lexicalFinder;
    this.threshold = relatedThreshold ?? 60;
    this.actions = this._defineActions();
  }

  // ------------------------------------------------------------------ helpers
  _now() { return this.clock().toISOString(); }
  _today() { return dateOf(this._now()); }

  _owner(id) {
    const o = this.store.owners.get(id);
    if (!o) throw notFound(`Owner ${id}`);
    return o;
  }
  _team(owner, name) {
    const t = this.store.teams.get(`${owner}/${name}`);
    if (!t) throw notFound(`Team ${name}`);
    return t;
  }
  _project(identifier) {
    const p = this.store.projects.get(identifier);
    if (!p) throw notFound(`Project ${identifier}`);
    return p;
  }
  _decision(id) {
    const d = this.store.decisions.get(id);
    if (!d) throw notFound(`Decision ${id}`);
    return d;
  }
  _teamOf(d) { return this._team(d.customer, d.team); }

  _isOrgAdmin(actor, owner) { return actor === owner; }
  _memberOf(team, actor) { return team.members.find((m) => m.user === actor); }
  _isTeamAdmin(actor, team) {
    return this._isOrgAdmin(actor, team.owner) || this._memberOf(team, actor)?.role === 'admin';
  }
  _canView(actor, d) {
    return this._isOrgAdmin(actor, d.customer) || !!this._memberOf(this._teamOf(d), actor);
  }
  _requireView(actor, d) {
    if (!this._canView(actor, d)) throw forbidden(`${actor} has no access to ${d.id}`);
  }
  _isApprover(actor, d) {
    const team = this._teamOf(d);
    if (this._isOrgAdmin(actor, d.customer)) return true;
    const role = this._memberOf(team, actor)?.role;
    return role === 'lead' || role === 'admin';
  }
  _eligibleVoters(d) {
    return this._teamOf(d).members.map((m) => m.user).filter((u) => u !== d.owner);
  }
  _settingsOf(d) { return this._project(d.project).approval_settings; }

  _audit(actor, action, decisionId, before, after, extra = {}) {
    const { audit } = this.store;
    const prev = audit.at(-1);
    const entry = {
      seq: (prev?.seq ?? 0) + 1,
      at: this._now(),
      actor,
      action,
      decision_id: decisionId ?? null,
      before: before ?? null,
      after: after ?? null,
      ip: extra.ip ?? null,
      detail: extra.detail ?? null,
      prev_hash: prev?.hash ?? GENESIS,
    };
    entry.hash = sha256(JSON.stringify(entry));
    audit.push(entry);
  }

  _touch(decisionId, user, actionType, role = null, metadata = null) {
    this.store.participants.push({ decision_id: decisionId, user, action_type: actionType, participation_type: role, at: this._now(), metadata });
  }

  _notify(user, type, decisionId, message) {
    this.store.notifications.push({
      id: `notif-${pad(this.store.next('notification'))}`, user, type, decision_id: decisionId, message, created_at: this._now(), read: false,
    });
  }

  _page({ limit, offset }) {
    return { limit: clampInt(limit, { min: 1, max: 100, def: 25 }), offset: clampInt(offset, { min: 0, max: Number.MAX_SAFE_INTEGER, def: 0 }) };
  }

  // ------------------------------------------------------------------ org structure
  createOwner({ identifier, name, email }) {
    if (!isNonEmpty(identifier)) throw invalid('identifier is required');
    if (this.store.owners.has(identifier)) throw conflict(`Owner ${identifier} already exists`);
    const now = this._now();
    const owner = { identifier, name: name ?? identifier, email: email ?? null, created_at: now, updated_at: now };
    this.store.owners.set(identifier, owner);
    this.store.teams.set(`${identifier}/default`, { owner: identifier, name: 'default', members: [], created_at: now, updated_at: now });
    this._audit(identifier, 'create_owner', null, null, { identifier });
    return clone(owner);
  }

  createTeam({ owner, name, actor }) {
    this._owner(owner);
    if (!this._isOrgAdmin(actor, owner)) throw forbidden('Only the owner can create teams');
    if (!isNonEmpty(name)) throw invalid('name is required');
    if (this.store.teams.has(`${owner}/${name}`)) throw conflict(`Team ${name} already exists`);
    const now = this._now();
    const team = { owner, name, members: [], created_at: now, updated_at: now };
    this.store.teams.set(`${owner}/${name}`, team);
    this._audit(actor, 'create_team', null, null, { owner, name });
    return clone(team);
  }

  addTeamMember({ owner, team = 'default', user, role = 'member', actor }) {
    this._owner(owner);
    const t = this._team(owner, team);
    if (!this._isTeamAdmin(actor, t)) throw forbidden('Only team admins can manage members');
    if (!isNonEmpty(user)) throw invalid('user is required');
    if (!ROLES.includes(role)) throw invalid(`role must be one of ${ROLES.join(', ')}`);
    const existing = t.members.find((m) => m.user === user);
    if (existing) existing.role = role; else t.members.push({ user, role });
    t.updated_at = this._now();
    this._audit(actor, 'add_team_member', null, null, { owner, team, user, role });
    return clone(t);
  }

  getTeam(owner, name = 'default') { return clone(this._team(owner, name)); }

  createProject({ owner, team = 'default', identifier, title, description = '', settings, actor }) {
    this._owner(owner);
    const t = this._team(owner, team);
    if (!this._isTeamAdmin(actor, t)) throw forbidden('Only team admins can create projects');
    if (!isNonEmpty(identifier) || !/^[A-Za-z][A-Za-z0-9]*$/.test(identifier)) throw invalid('identifier must be alphanumeric and start with a letter');
    if (!isNonEmpty(title)) throw invalid('title is required');
    const approval_settings = resolveSettings(settings?.approval_settings);
    if (this.store.projects.has(identifier)) throw conflict(`Project ${identifier} already exists`);
    const now = this._now();
    const project = {
      owner, team, identifier, title, description, active: true,
      decision_count: 0, last_number: 0, approval_settings, created_at: now, updated_at: now,
    };
    this.store.projects.set(identifier, project);
    this._audit(actor, 'create_project', null, null, { identifier, team });
    return clone(project);
  }

  getProject(identifier) { return clone(this._project(identifier)); }

  updateProjectSettings(identifier, actor, settings) {
    const p = this._project(identifier);
    if (!this._isTeamAdmin(actor, this._team(p.owner, p.team))) throw forbidden('Only team admins can change settings');
    p.approval_settings = resolveSettings(settings?.approval_settings ?? settings, p.approval_settings);
    p.updated_at = this._now();
    this._audit(actor, 'update_project_settings', null, null, { identifier });
    return clone(p);
  }

  // ------------------------------------------------------------------ decisions
  createDecision({ project, actor, title, content }) {
    const p = this._project(project);
    const team = this._team(p.owner, p.team);
    if (!this._isOrgAdmin(actor, p.owner) && !this._memberOf(team, actor)) throw forbidden(`${actor} is not a member of team ${team.name}`);
    if (!isNonEmpty(title)) throw invalid('title is required');
    const now = this._now();
    p.last_number += 1;
    p.decision_count += 1;
    const d = {
      id: `${p.identifier}-${pad(p.last_number)}`,
      number: p.last_number,
      project: p.identifier,
      team: p.team,
      customer: p.owner,
      title: title.trim(),
      content: isNonEmpty(content) ? content : DEFAULT_TEMPLATE,
      content_hash: null,
      status: 'draft',
      owner: actor,
      created_at: now,
      updated_at: now,
      proposed_at: null,
      approved_at: null,
      declined_at: null,
      immutable_from: null,
      current_revision: 0,
      approvers: [],
      decline: null,
      is_superseded: false,
      superseded_by_id: null,
      supersedes_id: null,
    };
    this.store.decisions.set(d.id, d);
    this.store.revisions.set(d.id, []);
    this._touch(d.id, actor, 'created', 'owner');
    this._audit(actor, 'create', d.id, null, { status: 'draft' });
    this._scanRelated(d);
    return clone(d);
  }

  updateDraft(id, actor, { title, content } = {}) {
    const d = this._decision(id);
    this._requireView(actor, d);
    if (d.owner !== actor) throw forbidden('Only the owner can edit a draft');
    if (d.status !== 'draft') {
      throw new DecisionLogError('IMMUTABLE_CONTENT', `${id} is ${d.status}; its content can no longer be edited`, 409, { current_state: d.status });
    }
    if (title !== undefined) {
      if (!isNonEmpty(title)) throw invalid('title cannot be empty');
      d.title = title.trim();
    }
    if (content !== undefined) {
      if (typeof content !== 'string') throw invalid('content must be a string');
      d.content = content;
    }
    this._audit(actor, 'edit_draft', id, { status: 'draft' }, { status: 'draft' });
    this._scanRelated(d);
    return clone(d);
  }

  deleteDraft(id, actor) {
    const d = this._decision(id);
    this._requireView(actor, d);
    if (d.owner !== actor) throw forbidden('Only the owner can delete a draft');
    if (d.status !== 'draft') throw new DecisionLogError('INVALID_STATE', `Only drafts can be deleted (${id} is ${d.status})`, 409, { current_state: d.status });
    if (this.store.revisions.get(id).length) throw new DecisionLogError('INVALID_STATE', `${id} has proposal history and cannot be deleted`, 409, { current_state: d.status });
    this.store.decisions.delete(id);
    this.store.revisions.delete(id);
    this._project(d.project).decision_count -= 1;
    this._audit(actor, 'delete_draft', id, { status: 'draft' }, null);
  }

  getDecision(id, actor) {
    const d = this._decision(id);
    this._requireView(actor, d);
    return this._view(d);
  }

  _view(d) {
    const view = clone(d);
    const votes = this._effectiveVotes(d);
    view.versions = this._versions(d.id);
    view.participants = this._participants(d.id);
    view.comments = this._comments(d.id);
    view.votes = clone(votes);
    view.vote_tally = tallyVotes(votes);
    view.related = this._related(d.id);
    view.followups = this.store.followups.filter((f) => f.decision_id === d.id).map((f) => this._todoView(f));
    view.meetings = clone(this.store.meetings.filter((m) => m.decision_id === d.id));
    return view;
  }

  listDecisions(filters = {}) {
    return queries.listDecisions(this, filters);
  }

  allowedActions(d) {
    const settings = this._settingsOf(d);
    return Object.entries(this.actions)
      .filter(([name, def]) => def.states.includes(d.status) && !(name === 'vote' && settings.mode === 'single_approval'))
      .map(([name]) => name);
  }

  // ------------------------------------------------------------------ unified action endpoint
  perform(id, actor, request, opts = {}) {
    const { action, payload } = request ?? {};
    const d = this._decision(id);
    this._requireView(actor, d);
    const idemKey = opts.idempotencyKey ? `${actor}|${id}|${opts.idempotencyKey}` : null;
    if (idemKey && this.store.idempotency[idemKey]) return { ...clone(this.store.idempotency[idemKey]), idempotent_replay: true };

    const def = this.actions[action];
    if (!def) throw new DecisionLogError('UNKNOWN_ACTION', `Unknown action "${action}"`, 400, { allowed_actions: this.allowedActions(d) });
    const ctx = { d, actor, payload: payload ?? {}, settings: this._settingsOf(d), opts };
    def.authorize(ctx);
    if (!def.states.includes(d.status)) {
      const details = { current_state: d.status, allowed_actions: this.allowedActions(d) };
      if (d.status === 'approved') {
        details.approved_date = d.approved_at;
        details.alternatives = [{ action: 'create_superseding_decision', description: 'Create a new decision to replace this one' }];
      }
      throw new DecisionLogError('INVALID_STATE', `Cannot ${action} a decision in ${d.status} status`, 409, details);
    }

    const previous = d.status;
    const out = def.run(ctx);
    if (def.audit !== false) this._audit(actor, action, d.id, { status: previous }, { status: d.status }, { ip: opts.ip });
    const shown = out.decision ?? d;
    const response = {
      success: true,
      status_code: out.status_code ?? 200,
      action_performed: action,
      decision: this._view(shown),
      metadata: { previous_state: previous, new_state: d.status, timestamp: this._now(), ...(out.metadata ?? {}) },
      message: out.message ?? `${action} completed`,
      data: out.data ?? {},
    };
    if (idemKey) this.store.idempotency[idemKey] = clone(response);
    return response;
  }

  _defineActions() {
    const owner = ({ d, actor }) => { if (d.owner !== actor) throw forbidden(`Only the owner (${d.owner}) can do this`); };
    const memberNotOwner = ({ d, actor }) => {
      if (d.owner === actor) throw forbidden('The owner cannot do this on their own decision');
      if (!this._memberOf(this._teamOf(d), actor)) throw forbidden('Only team members can do this');
    };
    const approver = ({ d, actor }) => {
      if (d.owner === actor) throw forbidden('The owner cannot do this on their own decision');
      if (!this._isApprover(actor, d)) throw forbidden('Only team leads or admins can do this');
    };
    const anyone = () => {};
    const voting = (settings) => settings.mode === 'consensus_voting' || settings.mode === 'quorum';

    return {
      propose: {
        states: ['draft'],
        authorize: owner,
        run: ({ d, actor, payload }) => {
          if (payload.content !== undefined) {
            if (!isNonEmpty(payload.content)) throw invalid('content cannot be empty');
            d.content = payload.content;
          }
          if (!isNonEmpty(d.content)) throw invalid('content cannot be empty');
          const now = this._now();
          const revisions = this.store.revisions.get(d.id);
          d.content_hash = sha256(d.content);
          d.current_revision = revisions.length + 1;
          revisions.push({
            revision_number: d.current_revision, content: d.content, content_hash: d.content_hash,
            outcome: null, reason: null, requested_by: null, requested_at: null, suggested_changes: null, created_at: now,
          });
          d.status = 'proposed';
          d.proposed_at = now;
          d.immutable_from = now;
          d.updated_at = now;
          d.approved_at = d.declined_at = null;
          d.approvers = [];
          this._touch(d.id, actor, 'proposed');
          for (const m of this._teamOf(d).members) if (m.user !== actor) this._notify(m.user, 'decision_proposed', d.id, `${d.id} was proposed: ${d.title}`);
          this._scanRelated(d);
          return { message: `${d.id} proposed (revision ${d.current_revision})` };
        },
      },

      vote: {
        states: ['proposed'],
        authorize: memberNotOwner,
        run: (ctx) => {
          if (ctx.settings.mode === 'single_approval') throw new DecisionLogError('VOTING_DISABLED', 'Voting is not enabled for this project', 409, { allowed_actions: ['approve', 'decline'] });
          return this._castVote(ctx, ctx.payload.vote);
        },
      },

      approve: {
        states: ['proposed'],
        authorize: (ctx) => (voting(ctx.settings) ? memberNotOwner(ctx) : approver(ctx)),
        run: (ctx) => {
          if (voting(ctx.settings)) return this._castVote(ctx, 'approve', true);
          const { d, actor, payload } = ctx;
          this._markApproved(d, [{ user: actor, approved_at: this._now(), comment: payload.comment ?? null }]);
          this._touch(d.id, actor, 'approved', 'approver');
          return { message: `${d.id} approved` };
        },
      },

      decline: {
        states: ['proposed'],
        authorize: approver,
        run: ({ d, actor, payload }) => {
          if (!isNonEmpty(payload.reason)) throw invalid('reason is required to decline');
          const now = this._now();
          d.status = 'declined';
          d.declined_at = now;
          d.updated_at = now;
          d.decline = { by: actor, reason: payload.reason, at: now };
          Object.assign(this._currentRevision(d), { outcome: 'declined', reason: payload.reason, requested_by: actor, requested_at: now });
          this._touch(d.id, actor, 'declined', 'decliner', { reason: payload.reason });
          this._notify(d.owner, 'decision_declined', d.id, `${d.id} was declined: ${payload.reason}`);
          return { message: `${d.id} declined` };
        },
      },

      request_revision: {
        states: ['proposed'],
        authorize: memberNotOwner,
        run: ({ d, actor, payload, settings }) => this._requestRevision(d, actor, payload.reason, payload.suggested_changes, settings),
      },

      return_to_draft: {
        states: ['declined'],
        authorize: owner,
        run: ({ d, actor }) => {
          d.status = 'draft';
          d.decline = null;
          d.content_hash = null;
          d.immutable_from = null;
          d.updated_at = this._now();
          this._touch(d.id, actor, 'returned_to_draft');
          return { message: `${d.id} returned to draft` };
        },
      },

      create_superseding_decision: {
        states: ['approved'],
        authorize: anyone,
        audit: false,
        run: ({ d, actor, payload }) => {
          const next = this.createDecision({
            project: d.project, actor,
            title: isNonEmpty(payload.title) ? payload.title : `Supersedes ${d.id}: ${d.title}`,
            content: payload.content,
          });
          const stored = this._decision(next.id);
          stored.supersedes_id = d.id;
          this._upsertRelationship(stored.id, d.id, { type: 'supersedes', score: 100, ai: false, by: actor, status: 'confirmed' });
          this._audit(actor, 'create_superseding_decision', d.id, { status: d.status }, { status: d.status }, { detail: { superseding: stored.id } });
          return { status_code: 201, decision: stored, message: `${stored.id} drafted to supersede ${d.id}` };
        },
      },

      add_comment: {
        states: ALL_STATES,
        authorize: anyone,
        audit: false,
        run: ({ d, actor, payload }) => ({ status_code: 201, data: { comment: this.addComment(d.id, actor, payload) }, message: 'Comment added' }),
      },

      assign_followup: {
        states: ALL_STATES,
        authorize: anyone,
        audit: false,
        run: ({ d, actor, payload }) => ({ status_code: 201, data: { followup: this.addFollowup(d.id, actor, payload) }, message: 'Follow-up assigned' }),
      },

      add_meeting: {
        states: ALL_STATES,
        authorize: anyone,
        audit: false,
        run: ({ d, actor, payload }) => ({ status_code: 201, data: { meeting: this.addMeeting(d.id, actor, payload) }, message: 'Meeting recorded' }),
      },
    };
  }

  _currentRevision(d) { return this.store.revisions.get(d.id).at(-1); }

  _markApproved(d, approvers, actor = null) {
    const now = this._now();
    d.status = 'approved';
    d.approved_at = now;
    d.updated_at = now;
    d.approvers = approvers;
    this._currentRevision(d).outcome = 'approved';
    if (d.supersedes_id) {
      const old = this.store.decisions.get(d.supersedes_id);
      if (old) {
        old.is_superseded = true;
        old.superseded_by_id = d.id;
        this._audit(actor ?? 'system', 'superseded', old.id, { status: old.status }, { status: old.status }, { detail: { superseded_by: d.id } });
      }
    }
    this._notify(d.owner, 'decision_approved', d.id, `${d.id} was approved`);
  }

  _requestRevision(d, actor, reason, suggested, settings) {
    if (settings.require_reason_on_revision && !isNonEmpty(reason)) throw invalid('reason is required to request a revision');
    const now = this._now();
    const rev = this._currentRevision(d);
    Object.assign(rev, { outcome: 'revision_requested', reason: reason ?? null, requested_by: actor, requested_at: now, suggested_changes: suggested ?? null });
    d.status = 'draft';
    d.content_hash = null;
    d.immutable_from = null;
    d.updated_at = now;
    this._touch(d.id, actor, 'requested_revision', 'reviewer', { reason });
    this._notify(d.owner, 'revision_requested', d.id, `${actor} requested a revision of ${d.id}: ${reason ?? ''}`);
    return {
      status_code: 201,
      data: { revision: { revision_number: rev.revision_number, reason: rev.reason, requested_by: actor, requested_at: now, suggested_changes: rev.suggested_changes } },
      message: 'Revision requested; decision returned to draft',
    };
  }

  _castVote({ d, actor, payload, settings }, vote, viaApprove = false) {
    if (!VOTES.includes(vote)) throw invalid(`vote must be one of ${VOTES.join(', ')}`);
    if (vote === 'abstain' && !settings.allow_abstain) throw invalid('abstaining is not allowed in this project');
    const comment = payload.comment ?? payload.reason ?? null;
    const veto = settings.mode === 'veto';
    if (vote === 'request_revision' && (veto || settings.require_reason_on_revision) && !isNonEmpty(comment)) {
      throw invalid('a reason is required when requesting a revision');
    }
    const now = this._now();
    const rev = d.current_revision;
    const existing = this.store.votes.find((v) => v.decision_id === d.id && v.revision === rev && v.voter === actor);
    if (existing) Object.assign(existing, { vote, comment, voted_at: now });
    else this.store.votes.push({ decision_id: d.id, revision: rev, voter: actor, vote, comment, voted_at: now });
    this._touch(d.id, actor, 'voted', vote === 'approve' ? 'approver' : vote === 'request_revision' ? 'reviewer' : null, { vote });
    if (settings.notification_on_vote) this._notify(d.owner, 'vote_received', d.id, `${actor} voted ${vote} on ${d.id}`);

    if (veto && vote === 'request_revision') return this._requestRevision(d, actor, comment, null, settings);

    const votes = this._effectiveVotes(d);
    const tally = tallyVotes(votes);
    const metadata = { vote_tally: tally };
    if (isApproved(settings, tally, this._eligibleVoters(d).length)) {
      const approvers = votes.filter((v) => v.vote === 'approve').map((v) => ({ user: v.voter, approved_at: v.voted_at, comment: v.comment }));
      this._markApproved(d, approvers, actor);
      return { status_code: 202, metadata, message: `Vote recorded; ${d.id} approved` };
    }
    return { status_code: viaApprove ? 202 : 200, metadata, message: 'Vote recorded' };
  }

  _effectiveVotes(d) {
    const all = this.store.votes.filter((v) => v.decision_id === d.id);
    if (!d.current_revision) return [];
    const settings = this._settingsOf(d);
    if (settings.revision_vote_resets_count) return all.filter((v) => v.revision === d.current_revision);
    const latest = new Map();
    for (const v of all) if (!latest.has(v.voter) || latest.get(v.voter).revision <= v.revision) latest.set(v.voter, v);
    return [...latest.values()];
  }

  /** Approves veto-mode decisions whose objection window has elapsed. Run periodically. */
  sweep() {
    const approved = [];
    const now = this.clock().getTime();
    for (const d of this.store.decisions.values()) {
      if (d.status !== 'proposed') continue;
      const s = this._settingsOf(d);
      if (s.mode !== 'veto' || !s.auto_approve_after_days) continue;
      if (now >= Date.parse(d.proposed_at) + s.auto_approve_after_days * 86_400_000) {
        const before = d.status;
        this._markApproved(d, []);
        this._audit('system', 'auto_approve', d.id, { status: before }, { status: d.status });
        approved.push(d.id);
      }
    }
    return approved;
  }

  // ------------------------------------------------------------------ versions & integrity
  _versions(id) {
    const revs = this.store.revisions.get(id) ?? [];
    return revs.map((r, i) => ({
      version: r.revision_number, content: r.content, content_hash: r.content_hash, outcome: r.outcome, reason: r.reason,
      requested_by: r.requested_by, requested_at: r.requested_at, suggested_changes: r.suggested_changes,
      created_at: r.created_at, current: i === revs.length - 1,
    }));
  }

  getVersions(id, actor) {
    const d = this._decision(id);
    this._requireView(actor, d);
    return this._versions(id);
  }

  diff(id, actor, { from, to } = {}) {
    const d = this._decision(id);
    this._requireView(actor, d);
    const revs = this.store.revisions.get(id);
    const parse = (v, def) => {
      if (v === undefined || v === null || v === '') return def;
      const n = Number.parseInt(String(v).replace(/^v/i, ''), 10);
      if (Number.isNaN(n)) throw invalid(`Invalid version "${v}"`);
      return n;
    };
    const t = parse(to, revs.length);
    const f = parse(from, t - 1);
    const find = (n) => revs.find((r) => r.revision_number === n) ?? (() => { throw notFound(`Version v${n} of ${id}`); })();
    const a = find(f), b = find(t);
    return { decision_id: id, from: f, to: t, ...diffMarkdown(a.content, b.content) };
  }

  verifyIntegrity(id) {
    const d = this._decision(id);
    const current = sha256(d.content);
    let ok = true;
    let expected = d.content_hash;
    if (d.status !== 'draft') ok = current === expected;
    else expected = null;
    for (const r of this.store.revisions.get(id)) {
      if (sha256(r.content) !== r.content_hash) { ok = false; expected = expected ?? r.content_hash; }
    }
    if (!ok) this._audit('system', 'integrity_violation', id, { content_hash: expected }, { content_hash: current });
    return { decision_id: id, ok, expected_hash: expected, current_hash: current };
  }

  // ------------------------------------------------------------------ comments
  _commentView(c) { return clone(c); }
  _comments(id) { return this.store.comments.filter((c) => c.decision_id === id).map((c) => this._commentView(c)); }

  _mentions(text, team) {
    const found = new Set();
    for (const m of text.matchAll(/@([A-Za-z0-9._-]+)/g)) {
      const name = m[1].toLowerCase();
      const member = team.members.find((x) => x.user.split('@')[0].toLowerCase() === name);
      if (member) found.add(member.user);
    }
    return [...found];
  }

  addComment(id, actor, { content, parent_id = null } = {}) {
    const d = this._decision(id);
    this._requireView(actor, d);
    if (!isNonEmpty(content)) throw invalid('content is required');
    if (parent_id && !this.store.comments.some((c) => c.id === parent_id && c.decision_id === id)) throw notFound(`Comment ${parent_id}`);
    const mentions = this._mentions(content, this._teamOf(d));
    const c = {
      id: `comment-${pad(this.store.next('comment'))}`, decision_id: id, user: actor, content, parent_id,
      resolved: false, mentions, created_at: this._now(), edited_at: null, deleted_at: null,
    };
    this.store.comments.push(c);
    this._touch(id, actor, 'commented', 'contributor');
    this._touch(id, actor, 'commented', 'reviewer');
    for (const u of mentions) if (u !== actor) this._notify(u, 'mention', id, `${actor} mentioned you on ${id}`);
    this._audit(actor, 'add_comment', id, null, { comment_id: c.id });
    return this._commentView(c);
  }

  _comment(id, commentId) {
    const c = this.store.comments.find((x) => x.id === commentId && x.decision_id === id);
    if (!c) throw notFound(`Comment ${commentId}`);
    return c;
  }

  listComments(id, actor) {
    const d = this._decision(id);
    this._requireView(actor, d);
    return this._comments(id);
  }

  editComment(id, commentId, actor, content) {
    const d = this._decision(id);
    this._requireView(actor, d);
    const c = this._comment(id, commentId);
    if (c.user !== actor) throw forbidden('Only the author can edit a comment');
    if (c.deleted_at) throw new DecisionLogError('INVALID_STATE', 'Comment was deleted', 409);
    if (this.clock().getTime() - Date.parse(c.created_at) > EDIT_WINDOW_MS) {
      throw new DecisionLogError('EDIT_WINDOW_EXPIRED', 'Comments can only be edited within 5 minutes', 403);
    }
    if (!isNonEmpty(content)) throw invalid('content is required');
    c.content = content;
    c.edited_at = this._now();
    c.mentions = this._mentions(content, this._teamOf(d));
    this._audit(actor, 'edit_comment', id, null, { comment_id: c.id });
    return this._commentView(c);
  }

  deleteComment(id, commentId, actor) {
    const d = this._decision(id);
    this._requireView(actor, d);
    const c = this._comment(id, commentId);
    if (c.user !== actor && !this._isTeamAdmin(actor, this._teamOf(d))) throw forbidden('Only the author or an admin can delete a comment');
    c.content = '[deleted]';
    c.mentions = [];
    c.deleted_at = this._now();
    this._audit(actor, 'delete_comment', id, null, { comment_id: c.id });
    return this._commentView(c);
  }

  resolveComment(id, commentId, actor, resolved = true) {
    const d = this._decision(id);
    this._requireView(actor, d);
    const c = this._comment(id, commentId);
    c.resolved = !!resolved;
    this._audit(actor, resolved ? 'resolve_comment' : 'reopen_comment', id, null, { comment_id: c.id });
    return this._commentView(c);
  }

  // ------------------------------------------------------------------ participants & notifications
  _participants(id) {
    const by = new Map();
    for (const e of this.store.participants) {
      if (e.decision_id !== id) continue;
      if (!by.has(e.user)) by.set(e.user, { user: e.user, roles: new Set(), actions: [] });
      const p = by.get(e.user);
      if (e.participation_type) p.roles.add(e.participation_type);
      p.actions.push({ action_type: e.action_type, at: e.at });
    }
    return [...by.values()].map((p) => ({ ...p, roles: ROLE_ORDER.filter((r) => p.roles.has(r)), last_action_at: p.actions.at(-1).at }));
  }

  getParticipants(id, actor) {
    const d = this._decision(id);
    this._requireView(actor, d);
    return this._participants(id);
  }

  listNotifications(user) { return clone(this.store.notifications.filter((n) => n.user === user)); }

  // ------------------------------------------------------------------ follow-ups / todos
  addFollowup(id, actor, p = {}) {
    const d = this._decision(id);
    this._requireView(actor, d);
    if (!isNonEmpty(p.title)) throw invalid('title is required');
    if (!isNonEmpty(p.assigned_to)) throw invalid('assigned_to is required');
    if (!this._memberOf(this._teamOf(d), p.assigned_to)) throw invalid(`${p.assigned_to} is not a member of team ${d.team}`);
    if (p.due_date != null && !isDateString(p.due_date)) throw invalid('due_date must be YYYY-MM-DD');
    const priority = p.priority ?? 'medium';
    if (!PRIORITIES.includes(priority)) throw invalid(`priority must be one of ${PRIORITIES.join(', ')}`);
    const now = this._now();
    const f = {
      id: `followup-${pad(this.store.next('followup'))}`, decision_id: id, assigned_to: p.assigned_to, created_by: actor,
      title: p.title, description: p.description ?? '', due_date: p.due_date ?? null, priority, status: 'pending',
      created_at: now, updated_at: now, completed_at: null, assignee_notes: null,
    };
    this.store.followups.push(f);
    this._touch(id, actor, 'assigned_followup');
    this._notify(f.assigned_to, 'followup_assigned', id, `${actor} assigned you "${f.title}" on ${id}`);
    this._audit(actor, 'assign_followup', id, null, { followup_id: f.id });
    return this._todoView(f);
  }

  _derivedStatus(f) {
    if (f.status !== 'completed' && f.due_date && f.due_date < this._today()) return 'overdue';
    return f.status;
  }

  _todoView(f) {
    const d = this.store.decisions.get(f.decision_id);
    return { ...clone(f), status: this._derivedStatus(f), decision_title: d?.title ?? null, project: d?.project ?? null };
  }

  listTodos({ user, status, project, sort = 'due_date', limit, offset } = {}) {
    if (!isNonEmpty(user)) throw invalid('user is required');
    let items = this.store.followups.filter((f) => f.assigned_to === user).map((f) => this._todoView(f));
    if (status) items = items.filter((t) => t.status === status);
    if (project) items = items.filter((t) => t.project === project);
    const prio = { high: 0, medium: 1, low: 2 };
    const cmp = {
      due_date: (a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'),
      priority: (a, b) => prio[a.priority] - prio[b.priority] || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'),
      created_at: (a, b) => a.created_at.localeCompare(b.created_at),
    }[sort];
    if (!cmp) throw invalid('sort must be due_date, priority or created_at');
    items.sort((a, b) => cmp(a, b) || a.id.localeCompare(b.id));
    const page = this._page({ limit, offset });
    return { items: items.slice(page.offset, page.offset + page.limit), total: items.length, ...page };
  }

  updateTodo(todoId, actor, { status, notes } = {}) {
    const f = this.store.followups.find((x) => x.id === todoId);
    if (!f) throw notFound(`Todo ${todoId}`);
    if (f.assigned_to !== actor) throw forbidden('Only the assignee can update a todo');
    if (status !== undefined && !['pending', 'in_progress', 'completed'].includes(status)) {
      throw invalid('status must be pending, in_progress or completed');
    }
    const before = f.status;
    if (status !== undefined) {
      f.status = status;
      f.completed_at = status === 'completed' ? this._now() : null;
    }
    if (notes !== undefined) f.assignee_notes = notes;
    f.updated_at = this._now();
    this._audit(actor, 'update_todo', f.decision_id, { status: before }, { status: f.status }, { detail: { followup_id: f.id } });
    return this._todoView(f);
  }

  todoStats(user) {
    const items = this.store.followups.filter((f) => f.assigned_to === user).map((f) => this._todoView(f));
    const completed = items.filter((t) => t.status === 'completed').length;
    const overdue = items.filter((t) => t.status === 'overdue').length;
    return {
      total: items.length, completed, completion_rate: items.length ? completed / items.length : 0,
      overdue, on_track: items.length - completed - overdue,
    };
  }

  // ------------------------------------------------------------------ meetings
  addMeeting(id, actor, p = {}) {
    const d = this._decision(id);
    this._requireView(actor, d);
    const segments = Array.isArray(p.segments) ? p.segments : [];
    if (!segments.length && !isNonEmpty(p.transcript_text)) throw invalid('a transcript (segments or transcript_text) is required');
    for (const s of segments) if (!isNonEmpty(s?.text)) throw invalid('every segment needs text');
    const sorted = segments.map((s) => ({ start_seconds: Number(s.start_seconds) || 0, speaker: s.speaker ?? 'Unknown', text: s.text })).sort((a, b) => a.start_seconds - b.start_seconds);
    const now = this._now();
    const m = {
      id: `meeting-${pad(this.store.next('meeting'))}`, decision_id: id, recorded_by: actor,
      audio_file_url: p.audio_file_url ?? null, segments: sorted,
      transcript_text: sorted.length ? sorted.map((s) => `${s.speaker}: ${s.text}`).join('\n') : p.transcript_text,
      duration_seconds: p.duration_seconds ?? (sorted.at(-1)?.start_seconds ?? 0),
      attendees: p.attendees ?? [actor], key_takeaways: p.key_takeaways ?? [],
      recorded_at: p.recorded_at ? new Date(p.recorded_at).toISOString() : now, transcript_completed_at: now, created_at: now,
    };
    this.store.meetings.push(m);
    this._touch(id, actor, 'recorded_meeting', 'contributor');
    this._audit(actor, 'add_meeting', id, null, { meeting_id: m.id });
    return clone(m);
  }

  _renderMeetings(id) {
    const meetings = this.store.meetings.filter((m) => m.decision_id === id);
    if (!meetings.length) return '';
    const out = ['## Meeting Records', ''];
    for (const m of meetings) {
      out.push(`### Meeting: ${m.recorded_at.slice(0, 10)} ${m.recorded_at.slice(11, 16)} - ${hms(m.duration_seconds)}`, '');
      out.push(`**Attendees**: ${m.attendees.join(', ')}`, '');
      if (m.audio_file_url) out.push(`**Recording**: ${m.audio_file_url}`, '');
      out.push('**Transcript**:', '');
      if (m.segments.length) for (const s of m.segments) out.push(`[${hms(s.start_seconds)}] **${s.speaker}**: ${s.text}`);
      else out.push(m.transcript_text);
      if (m.key_takeaways.length) out.push('', '**Key Takeaways**:', ...m.key_takeaways.map((t) => `- ${t}`));
      out.push('');
    }
    return out.join('\n');
  }

  renderMeetingNotes(id, actor) {
    const d = this._decision(id);
    this._requireView(actor, d);
    return this._renderMeetings(id);
  }

  // ------------------------------------------------------------------ related decisions
  _upsertRelationship(id, relatedId, { type, score, ai, by, status }) {
    let r = this.store.relationships.find((x) => x.decision_id === id && x.related_decision_id === relatedId);
    if (!r) {
      r = { decision_id: id, related_decision_id: relatedId, created_at: this._now() };
      this.store.relationships.push(r);
    }
    Object.assign(r, { type, confidence_score: score, ai_identified: ai, created_by: by ?? null, status });
    return r;
  }

  _scanRelated(d) {
    const candidates = [...this.store.decisions.values()].filter((c) => c.customer === d.customer && c.id !== d.id);
    const found = this.finder(clone(d), clone(candidates)) ?? [];
    for (const f of found) {
      if (f.decision_id === d.id || !this.store.decisions.has(f.decision_id)) continue;
      if (f.score < this.threshold) continue;
      if (!RELATIONSHIP_TYPES.includes(f.type)) continue;
      if (this.store.relationships.some((x) => x.decision_id === d.id && x.related_decision_id === f.decision_id)) continue;
      this._upsertRelationship(d.id, f.decision_id, { type: f.type, score: f.score, ai: true, by: null, status: 'suggested' });
    }
  }

  _related(id, { includeDismissed = false } = {}) {
    return this.store.relationships
      .filter((r) => r.decision_id === id && (includeDismissed || r.status !== 'dismissed'))
      .map((r) => ({ ...clone(r), related_title: this.store.decisions.get(r.related_decision_id)?.title ?? null }))
      .sort((a, b) => b.confidence_score - a.confidence_score);
  }

  getRelated(id, actor, opts = {}) {
    const d = this._decision(id);
    this._requireView(actor, d);
    return this._related(id, opts);
  }

  addRelated(id, actor, { related_decision_id, type } = {}) {
    const d = this._decision(id);
    this._requireView(actor, d);
    if (!RELATIONSHIP_TYPES.includes(type)) throw invalid(`type must be one of ${RELATIONSHIP_TYPES.join(', ')}`);
    const other = this._decision(related_decision_id);
    if (other.customer !== d.customer) throw forbidden('Cannot relate decisions across owners');
    const r = this._upsertRelationship(id, related_decision_id, { type, score: 100, ai: false, by: actor, status: 'confirmed' });
    this._audit(actor, 'add_related', id, null, { related_decision_id, type });
    return clone(r);
  }

  reviewRelated(id, relatedId, actor, decision) {
    const d = this._decision(id);
    this._requireView(actor, d);
    if (!['confirm', 'dismiss'].includes(decision)) throw invalid('decision must be confirm or dismiss');
    const r = this.store.relationships.find((x) => x.decision_id === id && x.related_decision_id === relatedId);
    if (!r) throw notFound(`Relationship ${id} -> ${relatedId}`);
    r.status = decision === 'confirm' ? 'confirmed' : 'dismissed';
    this._audit(actor, `${decision}_related`, id, null, { related_decision_id: relatedId });
    return clone(r);
  }

  // ------------------------------------------------------------------ rendering
  renderDecisionDocument(id, actor) {
    const d = this._decision(id);
    this._requireView(actor, d);
    const cap = (s) => s[0].toUpperCase() + s.slice(1);
    const lines = [
      `# ${d.id}: ${d.title}`, '',
      `- Status: ${cap(d.status)}`,
      `- Date Created: ${dateOf(d.created_at)}`,
      `- Date Modified: ${dateOf(d.updated_at)}`,
      `- Owner: ${d.owner}`,
      '- Approvers:',
      ...d.approvers.map((a) => `  - ${a.user} - Approved on ${dateOf(a.approved_at)}`),
      '', d.content.trimEnd(), '',
    ];
    const related = this._related(id);
    if (related.length) {
      lines.push('## Related Decisions', '');
      for (const r of related) lines.push(`- **${r.related_decision_id}: ${r.related_title}** - *${cap(r.type)}* (${r.confidence_score}% match)`);
      lines.push('');
    }
    const meetings = this._renderMeetings(id);
    if (meetings) lines.push(meetings);
    return lines.join('\n');
  }

  // ------------------------------------------------------------------ audit
  auditTrail({ decision_id, actor, from, to } = {}) {
    return clone(this.store.audit.filter((e) => (
      (!decision_id || e.decision_id === decision_id)
      && (!actor || e.actor === actor)
      && (!from || dateOf(e.at) >= from)
      && (!to || dateOf(e.at) <= to)
    )));
  }

  verifyAuditChain() {
    let prev = GENESIS;
    for (const e of this.store.audit) {
      const { hash, ...rest } = e;
      if (rest.prev_hash !== prev || sha256(JSON.stringify(rest)) !== hash) return { ok: false, broken_at: e.seq };
      prev = hash;
    }
    return { ok: true, broken_at: null };
  }

  // ------------------------------------------------------------------ queries
  search(args) { return queries.search(this, args); }
  dashboard(user) { return queries.dashboard(this, user); }
  report(type, args) { return queries.report(this, type, args); }
  exportDecisions(args) { return queries.exportDecisions(this, args); }
  visibleDecisions(actor) { return [...this.store.decisions.values()].filter((d) => this._canView(actor, d)); }
}
