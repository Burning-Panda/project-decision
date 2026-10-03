import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DecisionLog, MemoryStore } from '../src/decision-log.js';
import { createHash } from 'node:crypto';
import { setup, draft, proposed, act, assertCode, U } from './helpers.js';
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

test('outsiders cannot read anything; the org identifier can read everything', () => {
  const { log } = setup();
  const id = proposed(log);
  for (const fn of [
    () => log.getDecision(id, U.outsider),
    () => log.listComments(id, U.outsider),
    () => log.getVersions(id, U.outsider),
    () => log.getParticipants(id, U.outsider),
    () => log.renderDecisionDocument(id, U.outsider),
  ]) assertCode(fn, 'FORBIDDEN', 403);
  assert.equal(log.getDecision(id, U.org).id, id);
});

test('team admins manage membership; plain members cannot', () => {
  const { log } = setup();
  assertCode(() => log.addTeamMember({ owner: 'acme', team: 'default', user: 'x@acme.com', role: 'member', actor: U.bob }), 'FORBIDDEN', 403);
  assertCode(() => log.addTeamMember({ owner: 'acme', team: 'default', user: 'x@acme.com', role: 'king', actor: U.org }), 'VALIDATION_ERROR', 400);
  assertCode(() => log.createProject({ owner: 'acme', identifier: 'PRJ', title: 'dup', actor: U.org }), 'CONFLICT', 409);
  assertCode(() => log.createProject({ owner: 'acme', identifier: 'ZZ', title: 'x', actor: U.bob }), 'FORBIDDEN', 403);
});

test('projects live in a team; decisions are visible only to that team', () => {
  const { log } = setup();
  log.createTeam({ owner: 'acme', name: 'payments', actor: U.org });
  log.addTeamMember({ owner: 'acme', team: 'payments', user: U.bob, role: 'member', actor: U.org });
  log.createProject({ owner: 'acme', team: 'payments', identifier: 'PAY', title: 'Pay', actor: U.org });
  const d = log.createDecision({ project: 'PAY', actor: U.bob, title: 'Use Stripe' });
  assert.equal(d.team, 'payments');
  assertCode(() => log.getDecision(d.id, U.carol), 'FORBIDDEN', 403);
  assertCode(() => log.createDecision({ project: 'PAY', actor: U.alice, title: 'x' }), 'FORBIDDEN', 403);
});

test('every action is audited with before/after state, ip and a verifiable hash chain', () => {
  const { log } = setup();
  const d = draft(log);
  act(log, d.id, U.alice, 'propose', {}, { ip: '10.0.0.1' });
  act(log, d.id, U.lead, 'approve');
  const trail = log.auditTrail({ decision_id: d.id });
  assert.deepEqual(trail.map((e) => e.action), ['create', 'propose', 'approve']);
  const propose = trail[1];
  assert.equal(propose.actor, U.alice);
  assert.equal(propose.ip, '10.0.0.1');
  assert.equal(propose.before.status, 'draft');
  assert.equal(propose.after.status, 'proposed');
  assert.match(propose.hash, /^[0-9a-f]{64}$/);
  assert.equal(propose.prev_hash, trail[0].hash);
  assert.equal(log.verifyAuditChain().ok, true);
});

test('audit trail filters by actor and detects tampering', () => {
  const { log } = setup();
  const d = draft(log);
  act(log, d.id, U.alice, 'propose');
  assert.ok(log.auditTrail({ actor: U.alice }).every((e) => e.actor === U.alice));
  log.store.audit[1].actor = 'mallory@evil.com';
  const res = log.verifyAuditChain();
  assert.equal(res.ok, false);
  assert.equal(res.broken_at, log.store.audit[1].seq);
});

test('failed actions leave state and audit untouched', () => {
  const { log } = setup();
  const d = draft(log);
  const before = log.auditTrail({}).length;
  assertCode(() => act(log, d.id, U.bob, 'propose'), 'FORBIDDEN');
  assert.equal(log.auditTrail({}).length, before);
  assert.equal(log.getDecision(d.id, U.alice).status, 'draft');
});

test('idempotency keys make retries safe', () => {
  const { log } = setup({ mode: 'consensus_voting' });
  const id = proposed(log);
  const opts = { idempotencyKey: 'vote-alice-prj001' };
  const first = act(log, id, U.bob, 'vote', { vote: 'approve' }, opts);
  const again = act(log, id, U.bob, 'vote', { vote: 'approve' }, opts);
  assert.equal(again.idempotent_replay, true);
  assert.equal(first.idempotent_replay, undefined);
  assert.deepEqual(again.metadata.vote_tally, first.metadata.vote_tally);
  const n = log.auditTrail({ decision_id: id }).filter((e) => e.action === 'vote').length;
  assert.equal(n, 1);

  const fo = { idempotencyKey: 'fu-1' };
  const fu = { title: 'once', assigned_to: U.carol };
  act(log, id, U.alice, 'assign_followup', fu, fo);
  act(log, id, U.alice, 'assign_followup', fu, fo);
  assert.equal(log.listTodos({ user: U.carol }).total, 1);
});

test('state survives a JSON round trip including id counters and audit chain', () => {
  const { log } = setup();
  const id = proposed(log);
  act(log, id, U.lead, 'approve');
  const json = JSON.parse(JSON.stringify(log.store.toJSON()));
  const restored = new DecisionLog({ store: MemoryStore.fromJSON(json), clock: () => new Date('2024-04-01T00:00:00Z') });
  assert.equal(restored.getDecision(id, U.alice).status, 'approved');
  assert.equal(restored.verifyAuditChain().ok, true);
  assert.equal(restored.verifyIntegrity(id).ok, true);
  assert.equal(restored.createDecision({ project: 'PRJ', actor: U.alice, title: 'next' }).id, 'PRJ-002');
});

test('audit hashes do not depend on object key order (stores such as jsonb reorder keys)', () => {
  const { log } = setup();
  const d = draft(log);
  act(log, d.id, U.alice, 'propose');
  assert.ok(log.store.audit.every((e) => e.hv === 2), 'new entries carry the hash version');
  log.store.audit = log.store.audit.map((e) => Object.fromEntries(Object.entries(e).sort(([a], [b]) => (a < b ? 1 : -1)))); // reverse key order
  assert.equal(log.verifyAuditChain().ok, true);
  log.store.audit[0].actor = 'mallory@evil.com';
  assert.equal(log.verifyAuditChain().ok, false, 'still tamper-evident');
});

test('chains written before hash versioning (insertion-order hashes) still verify', () => {
  const { log } = setup();
  log.store.audit.length = 0;
  let prev = '0'.repeat(64);
  for (let seq = 1; seq <= 3; seq++) {
    const e = { seq, at: '2024-01-01T00:00:00.000Z', actor: 'a', action: 'create', decision_id: null, before: null, after: null, ip: null, detail: null, prev_hash: prev };
    e.hash = sha256(JSON.stringify(e));
    prev = e.hash;
    log.store.audit.push(e);
  }
  assert.deepEqual(log.verifyAuditChain(), { ok: true, broken_at: null });
  log.store.audit[1].actor = 'mallory';
  assert.deepEqual(log.verifyAuditChain(), { ok: false, broken_at: 2 });
});

test('new entries can extend a legacy chain', () => {
  const { log } = setup();
  log.store.audit.length = 0;
  const e = { seq: 1, at: '2024-01-01T00:00:00.000Z', actor: 'a', action: 'create', decision_id: null, before: null, after: null, ip: null, detail: null, prev_hash: '0'.repeat(64) };
  e.hash = sha256(JSON.stringify(e));
  log.store.audit.push(e);
  log.createOwner({ identifier: 'newco' });
  assert.equal(log.store.audit.at(-1).hv, 2);
  assert.equal(log.store.audit.at(-1).prev_hash, e.hash);
  assert.equal(log.verifyAuditChain().ok, true);
});
