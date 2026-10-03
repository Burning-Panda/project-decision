import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, draft, proposed, act, assertCode, U, CONTENT_V1, CONTENT_V2 } from './helpers.js';

test('request_revision needs a reason and a proposed decision; returns 201 with a draft', () => {
  const { log } = setup();
  const d = draft(log);
  assertCode(() => act(log, d.id, U.lead, 'request_revision', { reason: 'x' }), 'INVALID_STATE', 409);
  act(log, d.id, U.alice, 'propose');
  assertCode(() => act(log, d.id, U.lead, 'request_revision'), 'VALIDATION_ERROR', 400);
  assertCode(() => act(log, d.id, U.outsider, 'request_revision', { reason: 'x' }), 'FORBIDDEN', 403);
  assertCode(() => act(log, d.id, U.alice, 'request_revision', { reason: 'x' }), 'FORBIDDEN', 403);
  const r = act(log, d.id, U.lead, 'request_revision', {
    reason: 'Need clarification on rollback plan', suggested_changes: 'Add rollback section',
  });
  assert.equal(r.status_code, 201);
  assert.equal(r.decision.status, 'draft');
  assert.equal(r.data.revision.revision_number, 1);
  assert.equal(r.data.revision.reason, 'Need clarification on rollback plan');
  assert.equal(r.data.revision.requested_by, U.lead);
});

test('revision cycle keeps every version immutable and reachable', () => {
  const { log, clock } = setup();
  const id = proposed(log);
  const v1Hash = log.getDecision(id, U.alice).content_hash;
  clock.advanceDays(1);
  act(log, id, U.lead, 'request_revision', { reason: 'Need rollback plan' });
  log.updateDraft(id, U.alice, { content: CONTENT_V2 });
  const r = act(log, id, U.alice, 'propose');
  assert.equal(r.decision.current_revision, 2);
  assert.notEqual(r.decision.content_hash, v1Hash);

  const versions = log.getVersions(id, U.alice);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].version, 1);
  assert.equal(versions[0].content, CONTENT_V1);
  assert.equal(versions[0].content_hash, v1Hash);
  assert.equal(versions[0].outcome, 'revision_requested');
  assert.equal(versions[0].reason, 'Need rollback plan');
  assert.equal(versions[0].current, false);
  assert.equal(versions[1].content, CONTENT_V2);
  assert.equal(versions[1].outcome, null);
  assert.equal(versions[1].current, true);
});

test('diff groups changes by section path and accepts "v1" style refs', () => {
  const { log } = setup();
  const id = proposed(log);
  act(log, id, U.lead, 'request_revision', { reason: 'timeline' });
  log.updateDraft(id, U.alice, { content: CONTENT_V2 });
  act(log, id, U.alice, 'propose');

  const diff = log.diff(id, U.bob, { from: 'v1', to: 'v2' });
  assert.equal(diff.from, 1);
  assert.equal(diff.to, 2);
  const decision = diff.changes.find((c) => c.section === 'Decision');
  assert.deepEqual(decision.removed, ['Move to PostgreSQL 16 and deprecate MySQL']);
  assert.deepEqual(decision.added, ['Move to PostgreSQL 16 within 90 days, maintain MySQL fallback for 30 days']);
  const neg = diff.changes.find((c) => c.section === 'Consequences > Negative');
  assert.equal(neg.removed.length, 1);
  assert.equal(neg.added.length, 1);
  assert.equal(diff.changes.some((c) => c.section === 'Context'), false);
  assert.deepEqual(diff.stats, { added: 2, removed: 2 });
  assert.deepEqual(log.diff(id, U.bob, { from: 2, to: 2 }).changes, []);
  assertCode(() => log.diff(id, U.bob, { from: 1, to: 9 }), 'NOT_FOUND', 404);
});

test('votes are scoped to a revision and reset on re-proposal by default', () => {
  const { log } = setup({ mode: 'consensus_voting' });
  const id = proposed(log);
  act(log, id, U.bob, 'vote', { vote: 'approve' });
  act(log, id, U.carol, 'vote', { vote: 'approve' });
  act(log, id, U.lead, 'request_revision', { reason: 'tighten scope' });
  act(log, id, U.alice, 'propose');
  const d = log.getDecision(id, U.alice);
  assert.equal(d.votes.length, 0);
  assert.equal(d.vote_tally.approve, 0);
});

test('with revision_vote_resets_count=false approvals carry over', () => {
  const { log } = setup({ mode: 'consensus_voting', revision_vote_resets_count: false });
  const id = proposed(log);
  act(log, id, U.bob, 'vote', { vote: 'approve' });
  act(log, id, U.carol, 'vote', { vote: 'approve' });
  act(log, id, U.lead, 'request_revision', { reason: 'tighten scope' });
  act(log, id, U.alice, 'propose');
  assert.equal(log.getDecision(id, U.alice).vote_tally.approve, 2);
  const r = act(log, id, U.david, 'vote', { vote: 'approve' });
  assert.equal(r.decision.status, 'approved');
});
