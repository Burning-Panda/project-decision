import { invalid, forbidden } from './errors.js';
import { clampInt, clone, csvCell, dateOf, levenshtein, words } from './util.js';

const page = (args) => ({
  limit: clampInt(args.limit, { min: 1, max: 100, def: 25 }),
  offset: clampInt(args.offset, { min: 0, max: Number.MAX_SAFE_INTEGER, def: 0 }),
});

const baseView = (d) => clone(d);

export function listDecisions(log, f = {}) {
  let items = log.visibleDecisions(f.actor);
  if (f.team) items = items.filter((d) => d.team === f.team);
  if (f.project) items = items.filter((d) => d.project === f.project);
  if (f.status) items = items.filter((d) => d.status === f.status);
  if (f.owner) items = items.filter((d) => d.owner === f.owner);
  const sort = f.sort ?? '-created_at';
  const dir = sort.startsWith('+') || !sort.startsWith('-') ? 1 : -1;
  const field = sort.replace(/^[+-]/, '').trim() || 'created_at';
  if (!['created_at', 'updated_at', 'title', 'number', 'id', 'status'].includes(field)) throw invalid(`Cannot sort by ${field}`);
  items.sort((a, b) => dir * String(a[field]).localeCompare(String(b[field]), 'en', { numeric: true }) || dir * (a.number - b.number));
  const p = page(f);
  return { items: items.slice(p.offset, p.offset + p.limit).map(baseView), total: items.length, ...p };
}

// ---------------------------------------------------------------- search
export function search(log, args = {}) {
  const { actor, q = '', status, owner, project, team, approver, from, to } = args;
  let pool = log.visibleDecisions(actor);
  if (status) pool = pool.filter((d) => d.status === status);
  if (owner) pool = pool.filter((d) => d.owner === owner);
  if (project) pool = pool.filter((d) => d.project === project);
  if (team) pool = pool.filter((d) => d.team === team);
  if (approver) pool = pool.filter((d) => d.approvers.some((a) => a.user === approver));
  if (from) pool = pool.filter((d) => dateOf(d.created_at) >= from);
  if (to) pool = pool.filter((d) => dateOf(d.created_at) <= to);

  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const results = [];
  for (const d of pool) {
    if (!tokens.length) { results.push({ d, score: 0, matched_in: [] }); continue; }
    const fields = {
      title: d.title.toLowerCase(),
      content: d.content.toLowerCase(),
      comments: log.store.comments.filter((c) => c.decision_id === d.id && !c.deleted_at).map((c) => c.content.toLowerCase()).join('\n'),
      transcript: log.store.meetings.filter((m) => m.decision_id === d.id).map((m) => m.transcript_text.toLowerCase()).join('\n'),
    };
    const vocab = [...new Set(words(`${d.title} ${d.content}`))];
    let score = 0;
    const matched = new Set();
    let all = true;
    for (const t of tokens) {
      let hit = false;
      if (d.id.toLowerCase().includes(t)) { score += 10; matched.add('id'); hit = true; }
      for (const [name, weight] of [['title', 5], ['content', 2], ['comments', 1], ['transcript', 1]]) {
        if (fields[name].includes(t)) { score += weight; matched.add(name); hit = true; }
      }
      if (!hit && t.length >= 5) {
        const tol = t.length >= 9 ? 2 : 1;
        if (vocab.some((w) => Math.abs(w.length - t.length) <= tol && levenshtein(w, t) <= tol)) { score += 1; matched.add('fuzzy'); hit = true; }
      }
      if (!hit) { all = false; break; }
    }
    if (all) results.push({ d, score, matched_in: [...matched] });
  }
  results.sort((a, b) => b.score - a.score || b.d.created_at.localeCompare(a.d.created_at) || b.d.number - a.d.number);
  const p = page(args);
  return {
    items: results.slice(p.offset, p.offset + p.limit).map((r) => ({
      decision_id: r.d.id, title: r.d.title, status: r.d.status, score: r.score, matched_in: r.matched_in,
    })),
    total: results.length, ...p,
  };
}

// ---------------------------------------------------------------- dashboard
export function dashboard(log, user) {
  const visible = log.visibleDecisions(user);
  const roleSets = new Map();
  for (const e of log.store.participants) {
    if (e.user !== user || !e.participation_type) continue;
    if (!roleSets.has(e.decision_id)) roleSets.set(e.decision_id, new Set());
    roleSets.get(e.decision_id).add(e.participation_type);
  }
  const awaiting = (d) => {
    if (d.status !== 'proposed' || d.owner === user) return false;
    const s = log._settingsOf(d);
    if (s.mode === 'consensus_voting' || s.mode === 'quorum') {
      const member = log._memberOf(log._teamOf(d), user);
      return !!member && !log._effectiveVotes(d).some((v) => v.voter === user);
    }
    return log._isApprover(user, d);
  };
  return {
    owned: visible.filter((d) => d.owner === user).map(baseView),
    awaiting_my_approval: visible.filter(awaiting).map(baseView),
    contributed: visible.filter((d) => d.owner !== user && roleSets.has(d.id)).map(baseView),
    in_my_projects: visible.map(baseView),
  };
}

// ---------------------------------------------------------------- reports
const round = (n) => Math.round(n * 100) / 100;
const REPORTS = ['decision_volume', 'approval_metrics', 'participation', 'revision_cycles', 'supersession', 'todo_completion', 'audit'];

export function report(log, type, { actor, from, to } = {}) {
  if (!REPORTS.includes(type)) throw invalid(`Unknown report "${type}"; expected one of ${REPORTS.join(', ')}`);
  const decisions = log.visibleDecisions(actor);
  const ids = new Set(decisions.map((d) => d.id));

  switch (type) {
    case 'decision_volume': {
      const by_month = {}, by_team = {};
      for (const d of decisions) {
        const m = d.created_at.slice(0, 7);
        by_month[m] = (by_month[m] ?? 0) + 1;
        by_team[d.team] = (by_team[d.team] ?? 0) + 1;
      }
      return { type, total: decisions.length, by_month, by_team };
    }
    case 'approval_metrics': {
      const approved = decisions.filter((d) => d.approved_at);
      const declined = decisions.filter((d) => d.status === 'declined');
      const hours = approved.map((d) => (Date.parse(d.approved_at) - Date.parse(d.proposed_at)) / 3_600_000);
      const closed = approved.length + declined.length;
      return {
        type, approved: approved.length, declined: declined.length,
        approval_rate: closed ? round(approved.length / closed) : 0,
        avg_hours_to_approval: hours.length ? round(hours.reduce((a, b) => a + b, 0) / hours.length) : null,
      };
    }
    case 'participation': {
      const tally = (pred) => {
        const m = new Map();
        for (const e of log.store.participants) if (ids.has(e.decision_id) && pred(e)) m.set(e.user, (m.get(e.user) ?? 0) + 1);
        return [...m].map(([user, count]) => ({ user, count })).sort((a, b) => b.count - a.count || a.user.localeCompare(b.user));
      };
      return {
        type,
        voters: tally((e) => e.action_type === 'voted' || e.action_type === 'approved'),
        commenters: tally((e) => e.action_type === 'commented' && e.participation_type === 'contributor'),
        owners: tally((e) => e.action_type === 'created'),
      };
    }
    case 'revision_cycles': {
      const by_decision = {};
      for (const d of decisions) {
        const revs = log.store.revisions.get(d.id) ?? [];
        if (revs.length) by_decision[d.id] = revs.filter((r) => r.outcome === 'revision_requested').length;
      }
      const counts = Object.values(by_decision);
      return { type, by_decision, average: counts.length ? round(counts.reduce((a, b) => a + b, 0) / counts.length) : 0 };
    }
    case 'supersession':
      return { type, chains: decisions.filter((d) => d.supersedes_id).map((d) => ({ id: d.id, supersedes: d.supersedes_id })) };
    case 'todo_completion': {
      const items = log.store.followups.filter((f) => ids.has(f.decision_id)).map((f) => log._todoView(f));
      const completed = items.filter((t) => t.status === 'completed').length;
      return {
        type, total: items.length, completed, overdue: items.filter((t) => t.status === 'overdue').length,
        completion_rate: items.length ? round(completed / items.length) : 0,
      };
    }
    case 'audit': {
      const admin = log.store.owners.has(actor) || [...log.store.teams.values()].some((t) => log._isTeamAdmin(actor, t));
      if (!admin) throw forbidden('Only admins can view the audit report');
      const entries = log.auditTrail({ from, to }).filter((e) => !e.decision_id || ids.has(e.decision_id));
      return { type, from: from ?? null, to: to ?? null, entries };
    }
  }
}

// ---------------------------------------------------------------- export
const CSV_COLUMNS = ['id', 'title', 'status', 'project', 'team', 'owner', 'created_at', 'updated_at', 'proposed_at', 'approved_at', 'declined_at', 'approvers', 'superseded_by_id'];

export function exportDecisions(log, { actor, format = 'json' } = {}) {
  const decisions = log.visibleDecisions(actor).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.number - b.number);
  if (format === 'json') return decisions.map((d) => log._view(d));
  if (format !== 'csv') throw invalid('format must be json or csv');
  const rows = decisions.map((d) => CSV_COLUMNS.map((c) => csvCell(c === 'approvers' ? d.approvers.map((a) => a.user).join(';') : d[c])).join(','));
  return `${[CSV_COLUMNS.join(','), ...rows].join('\n')}\n`;
}
