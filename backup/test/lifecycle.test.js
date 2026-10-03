import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, draft, proposed, act, assertCode, U, CONTENT_V1 } from './helpers.js';

test('decision ids increment per project and project count tracks them', () => {
  const { log } = setup();
  log.createProject({ owner: 'acme', identifier: 'WEB', title: 'Web', actor: U.org });
  assert.equal(draft(log).id, 'PRJ-001');
  assert.equal(draft(log).id, 'PRJ-002');
  assert.equal(draft(log, { project: 'WEB' }).id, 'WEB-001');
  assert.equal(log.getProject('PRJ').decision_count, 2);
  assert.equal(log.getProject('WEB').decision_count, 1);
});

test('new decision is an owned draft with the default template when no content given', () => {
  const { log } = setup();
  const d = log.createDecision({ project: 'PRJ', actor: U.alice, title: 'Pick a queue' });
  assert.equal(d.status, 'draft');
  assert.equal(d.owner, U.alice);
  assert.equal(d.number, 1);
  assert.equal(d.team, 'default');
  for (const h of ['## Context', '## Decision', '## Alternatives Considered', '## Consequences', '## Follow-up Actions']) {
    assert.ok(d.content.includes(h), `template missing ${h}`);
  }
  const people = log.getParticipants(d.id, U.alice);
  assert.deepEqual(people.map((p) => p.user), [U.alice]);
  assert.ok(people[0].roles.includes('owner'));
});

test('creation validation and permissions', () => {
  const { log } = setup();
  assertCode(() => draft(log, { actor: U.outsider }), 'FORBIDDEN', 403);
  assertCode(() => draft(log, { project: 'NOPE' }), 'NOT_FOUND', 404);
  assertCode(() => draft(log, { title: '  ' }), 'VALIDATION_ERROR', 400);
});

test('drafts are editable by the owner only; updated_at does not move on content edits', () => {
  const { log, clock } = setup();
  const d = draft(log);
  clock.advanceHours(1);
  const edited = log.updateDraft(d.id, U.alice, { title: 'New title', content: 'edited' });
  assert.equal(edited.title, 'New title');
  assert.equal(edited.content, 'edited');
  assert.equal(edited.updated_at, d.updated_at);
  assertCode(() => log.updateDraft(d.id, U.bob, { content: 'x' }), 'FORBIDDEN', 403);
});

test('propose locks content, hashes it with sha256 and snapshots revision 1', () => {
  const { log, clock } = setup();
  const d = draft(log);
  clock.advanceHours(2);
  const r = act(log, d.id, U.alice, 'propose');
  assert.equal(r.success, true);
  assert.equal(r.status_code, 200);
  assert.equal(r.action_performed, 'propose');
  assert.equal(r.decision.status, 'proposed');
  assert.match(r.decision.content_hash, /^[0-9a-f]{64}$/);
  assert.ok(r.decision.proposed_at);
  assert.ok(r.decision.immutable_from);
  assert.equal(r.decision.current_revision, 1);
  assert.equal(r.metadata.previous_state, 'draft');
  assert.equal(r.metadata.new_state, 'proposed');
  assert.notEqual(r.decision.updated_at, d.updated_at);
  assert.equal(log.getVersions(d.id, U.alice).length, 1);
});

test('propose may carry final content; only the owner may propose', () => {
  const { log } = setup();
  const d = draft(log);
  assertCode(() => act(log, d.id, U.bob, 'propose'), 'FORBIDDEN', 403);
  const r = act(log, d.id, U.alice, 'propose', { content: '## Decision\nFinal wording' });
  assert.equal(r.decision.content, '## Decision\nFinal wording');
});

test('content cannot be edited or deleted once proposed', () => {
  const { log } = setup();
  const id = proposed(log);
  assertCode(() => log.updateDraft(id, U.alice, { content: 'sneaky' }), 'IMMUTABLE_CONTENT', 409);
  assertCode(() => log.deleteDraft(id, U.alice), 'INVALID_STATE', 409);
});

test('only drafts can be deleted, and only by their owner', () => {
  const { log } = setup();
  const d = draft(log);
  assertCode(() => log.deleteDraft(d.id, U.bob), 'FORBIDDEN', 403);
  log.deleteDraft(d.id, U.alice);
  assertCode(() => log.getDecision(d.id, U.alice), 'NOT_FOUND', 404);
});

test('unknown actions and wrong-state actions give actionable errors', () => {
  const { log } = setup();
  const d = draft(log);
  assertCode(() => act(log, d.id, U.alice, 'teleport'), 'UNKNOWN_ACTION', 400);
  const e = assertCode(() => act(log, d.id, U.lead, 'approve'), 'INVALID_STATE', 409);
  assert.ok(e.details.allowed_actions.includes('propose'));
  assert.equal(e.details.current_state, 'draft');
  assertCode(() => act(log, 'PRJ-999', U.alice, 'propose'), 'NOT_FOUND', 404);
});

test('single approval: a lead approves, content and hash are untouched', () => {
  const { log, clock } = setup();
  const id = proposed(log);
  const before = log.getDecision(id, U.alice);
  clock.advanceHours(5);
  const r = act(log, id, U.lead, 'approve', { comment: 'Ship it' });
  assert.equal(r.status_code, 200);
  assert.equal(r.decision.status, 'approved');
  assert.ok(r.decision.approved_at);
  assert.equal(r.decision.content, before.content);
  assert.equal(r.decision.content_hash, before.content_hash);
  assert.deepEqual(r.decision.approvers.map((a) => a.user), [U.lead]);
  assert.ok(r.decision.approvers[0].approved_at);
  assert.equal(log.verifyIntegrity(id).ok, true);
});

test('approving an approved decision suggests superseding', () => {
  const { log } = setup();
  const id = proposed(log);
  act(log, id, U.lead, 'approve');
  const e = assertCode(() => act(log, id, U.lead, 'approve'), 'INVALID_STATE', 409);
  assert.equal(e.details.current_state, 'approved');
  assert.ok(e.details.alternatives.some((a) => a.action === 'create_superseding_decision'));
});

test('decline needs a reason, stores it outside the document and allows return to draft', () => {
  const { log } = setup();
  const id = proposed(log);
  assertCode(() => act(log, id, U.lead, 'decline'), 'VALIDATION_ERROR', 400);
  const r = act(log, id, U.lead, 'decline', { reason: 'Too risky without rollback plan' });
  assert.equal(r.decision.status, 'declined');
  assert.equal(r.decision.decline.reason, 'Too risky without rollback plan');
  assert.equal(r.decision.decline.by, U.lead);
  assert.ok(!r.decision.content.includes('Too risky'));
  assertCode(() => act(log, id, U.bob, 'return_to_draft'), 'FORBIDDEN', 403);
  const back = act(log, id, U.alice, 'return_to_draft');
  assert.equal(back.decision.status, 'draft');
  log.updateDraft(id, U.alice, { content: 'reworked' });
  assert.equal(log.getVersions(id, U.alice).length, 1, 'declined version is preserved');
  assert.equal(log.getVersions(id, U.alice)[0].content, CONTENT_V1);
});

test('superseding creates a linked draft; original is marked once the new one is approved', () => {
  const { log } = setup();
  const id = proposed(log);
  assertCode(() => act(log, id, U.bob, 'create_superseding_decision', { title: 'x' }), 'INVALID_STATE', 409);
  act(log, id, U.lead, 'approve');
  const r = act(log, id, U.bob, 'create_superseding_decision', { title: 'Use CockroachDB instead', content: 'new' });
  assert.equal(r.status_code, 201);
  const next = r.decision;
  assert.equal(next.id, 'PRJ-002');
  assert.equal(next.status, 'draft');
  assert.equal(next.owner, U.bob);
  assert.equal(next.supersedes_id, id);
  assert.equal(log.getDecision(id, U.bob).is_superseded, false);

  act(log, next.id, U.bob, 'propose');
  act(log, next.id, U.lead, 'approve');
  const old = log.getDecision(id, U.bob);
  assert.equal(old.is_superseded, true);
  assert.equal(old.superseded_by_id, 'PRJ-002');
  assert.equal(old.status, 'approved', 'original stays approved in the audit trail');
  assert.ok(log.getRelated('PRJ-002', U.bob).some((x) => x.related_decision_id === id && x.type === 'supersedes'));
});

test('integrity check detects tampering and records a violation', () => {
  const { log } = setup();
  const id = proposed(log);
  assert.equal(log.verifyIntegrity(id).ok, true);
  log.store.decisions.get(id).content = 'tampered';
  const res = log.verifyIntegrity(id);
  assert.equal(res.ok, false);
  assert.notEqual(res.expected_hash, res.current_hash);
  assert.ok(log.auditTrail({ decision_id: id }).some((e) => e.action === 'integrity_violation'));
});

test('renderDecisionDocument produces the standard header, approvers and sections', () => {
  const { log } = setup();
  const id = proposed(log);
  act(log, id, U.lead, 'approve');
  const md = log.renderDecisionDocument(id, U.alice);
  assert.match(md, /^# PRJ-001: Migrate to new database/);
  assert.match(md, /- Status: Approved/);
  assert.match(md, /- Date Created: 2024-03-20/);
  assert.match(md, /- Owner: alice@acme.com/);
  assert.match(md, /lead@acme.com - Approved on 2024-03-20/);
  assert.match(md, /## Decision/);
});
