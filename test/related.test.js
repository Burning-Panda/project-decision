import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, draft, proposed, act, assertCode, U } from './helpers.js';

const PG = 'Migrate production database from MySQL to PostgreSQL 16. Performance benchmarks, replication and rollback plan for the database migration.';
const PG2 = 'Migrate the production database from MySQL to PostgreSQL 16. Benchmarks for performance, replication and a rollback plan for database migration.';
const COFFEE = 'Buy a new espresso machine for the office kitchen and pick a coffee supplier.';

test('default finder links near-duplicate decisions and ignores unrelated ones', () => {
  const { log } = setup();
  const a = draft(log, { title: 'Database migration', content: PG });
  const b = draft(log, { title: 'Database migration plan', content: PG2 });
  const c = draft(log, { title: 'Office coffee', content: COFFEE });
  const rel = log.getRelated(b.id, U.alice);
  assert.equal(rel.length, 1);
  assert.equal(rel[0].related_decision_id, a.id);
  assert.equal(rel[0].ai_identified, true);
  assert.equal(rel[0].type, 'related');
  assert.ok(rel[0].confidence_score >= 60 && rel[0].confidence_score <= 100);
  assert.deepEqual(log.getRelated(c.id, U.alice), []);
});

test('injected finder results are filtered by the confidence threshold', () => {
  const finder = () => [
    { decision_id: 'PRJ-001', type: 'conflicts', score: 92 },
    { decision_id: 'PRJ-002', type: 'complements', score: 40 },
  ];
  const { log } = setup({ finder, threshold: 60 });
  draft(log); draft(log);
  const third = draft(log);
  const rel = log.getRelated(third.id, U.alice);
  assert.deepEqual(rel.map((r) => [r.related_decision_id, r.type, r.confidence_score]), [['PRJ-001', 'conflicts', 92]]);
});

test('finder runs on create, draft save and propose', () => {
  let calls = 0;
  const { log } = setup({ finder: () => { calls++; return []; } });
  const d = draft(log);
  assert.equal(calls, 1);
  log.updateDraft(d.id, U.alice, { content: 'changed' });
  assert.equal(calls, 2);
  act(log, d.id, U.alice, 'propose');
  assert.equal(calls, 3);
});

test('rescans do not duplicate suggestions or resurrect dismissed ones', () => {
  const finder = (d) => (d.id === 'PRJ-002' ? [{ decision_id: 'PRJ-001', type: 'related', score: 80 }] : []);
  const { log } = setup({ finder });
  draft(log);
  const b = draft(log);
  log.updateDraft(b.id, U.alice, { content: 'again' });
  assert.equal(log.getRelated(b.id, U.alice).length, 1);
  log.reviewRelated(b.id, 'PRJ-001', U.alice, 'dismiss');
  act(log, b.id, U.alice, 'propose');
  assert.equal(log.getRelated(b.id, U.alice).length, 0);
  assert.equal(log.getRelated(b.id, U.alice, { includeDismissed: true }).length, 1);
});

test('suggestions can be confirmed; manual links record their type', () => {
  const finder = (d) => (d.id === 'PRJ-002' ? [{ decision_id: 'PRJ-001', type: 'related', score: 80 }] : []);
  const { log } = setup({ finder });
  draft(log);
  const b = draft(log);
  assert.equal(log.reviewRelated(b.id, 'PRJ-001', U.bob, 'confirm').status, 'confirmed');
  const c = draft(log);
  const m = log.addRelated(c.id, U.bob, { related_decision_id: 'PRJ-001', type: 'complements' });
  assert.equal(m.ai_identified, false);
  assert.equal(m.confidence_score, 100);
  assert.equal(m.created_by, U.bob);
  assertCode(() => log.addRelated(c.id, U.bob, { related_decision_id: 'PRJ-001', type: 'friends' }), 'VALIDATION_ERROR', 400);
  assertCode(() => log.addRelated(c.id, U.bob, { related_decision_id: 'PRJ-404', type: 'related' }), 'NOT_FOUND', 404);
  assertCode(() => log.addRelated(c.id, U.outsider, { related_decision_id: 'PRJ-001', type: 'related' }), 'FORBIDDEN', 403);
});

test('rendered document lists related decisions with type and match percent', () => {
  const finder = (d) => (d.id === 'PRJ-002' ? [{ decision_id: 'PRJ-001', type: 'conflicts', score: 92 }] : []);
  const { log } = setup({ finder });
  draft(log, { title: 'Database platform selection' });
  const b = draft(log);
  const md = log.renderDecisionDocument(b.id, U.alice);
  assert.match(md, /## Related Decisions/);
  assert.match(md, /\*\*PRJ-001: Database platform selection\*\* - \*Conflicts\* \(92% match\)/);
  assert.ok(proposed);
});
