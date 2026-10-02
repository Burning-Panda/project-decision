import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, draft, proposed, act, assertCode, U } from './helpers.js';

function seed() {
  const ctx = setup({ mode: 'consensus_voting' });
  const { log, clock } = ctx;
  log.createProject({ owner: 'acme', identifier: 'WEB', title: 'Web', actor: U.org });
  const a = draft(log, { title: 'Migrate to PostgreSQL', content: 'Move the primary database to Postgres.' });
  clock.advanceDays(1);
  const b = draft(log, { actor: U.bob, title: 'API rate limiting strategy', content: 'Token bucket per customer.' });
  clock.advanceDays(1);
  const c = draft(log, { project: 'WEB', title: 'Frontend framework', content: 'Adopt a component framework.' });
  return { ...ctx, a: a.id, b: b.id, c: c.id };
}

test('listDecisions filters, sorts and paginates', () => {
  const { log, a, b, c } = seed();
  act(log, a, U.alice, 'propose');
  assert.equal(log.listDecisions({ actor: U.alice }).total, 3);
  assert.deepEqual(log.listDecisions({ actor: U.alice, project: 'PRJ' }).items.map((d) => d.id), [b, a]); // default -created_at
  assert.deepEqual(log.listDecisions({ actor: U.alice, status: 'proposed' }).items.map((d) => d.id), [a]);
  assert.deepEqual(log.listDecisions({ actor: U.alice, sort: '+created_at' }).items.map((d) => d.id), [a, b, c]);
  assert.deepEqual(log.listDecisions({ actor: U.alice, team: 'default', sort: '+created_at', limit: 1, offset: 1 }).items.map((d) => d.id), [b]);
  const p = log.listDecisions({ actor: U.alice, limit: 500 });
  assert.equal(p.limit, 100);
  assert.equal(log.listDecisions({ actor: U.alice }).limit, 25);
  assert.equal(log.listDecisions({ actor: U.outsider }).total, 0);
});

test('search finds content, ids, comments and transcripts, honouring access', () => {
  const { log, a, b } = seed();
  log.addComment(b, U.carol, { content: 'What about sliding windows?' });
  act(log, a, U.alice, 'propose');
  act(log, a, U.bob, 'add_meeting', { segments: [{ start_seconds: 0, speaker: 'Bob', text: 'We discussed pgbouncer pooling' }] });
  const ids = (q, extra) => log.search({ actor: U.alice, q, ...extra }).items.map((r) => r.decision_id);
  assert.deepEqual(ids('postgres'), [a]);
  assert.deepEqual(ids('PRJ-002'), [b]);
  assert.deepEqual(ids('sliding'), [b]);
  assert.deepEqual(ids('pgbouncer'), [a]);
  assert.ok(log.search({ actor: U.alice, q: 'pgbouncer' }).items[0].matched_in.includes('transcript'));
  assert.deepEqual(ids('postgress'), [a], 'fuzzy title/content match');
  assert.deepEqual(ids('zzzzzz'), []);
  assert.deepEqual(log.search({ actor: U.outsider, q: 'postgres' }).items, []);
});

test('search filters by status, owner, project, approver and date range', () => {
  const { log, clock, a, b, c } = seed();
  const base = { actor: U.alice, q: '' };
  const ids = (f) => log.search({ ...base, ...f }).items.map((r) => r.decision_id).sort();
  assert.deepEqual(ids({ owner: U.bob }), [b]);
  assert.deepEqual(ids({ project: 'WEB' }), [c]);
  act(log, a, U.alice, 'propose');
  for (const u of [U.bob, U.carol, U.david]) act(log, a, u, 'vote', { vote: 'approve' });
  assert.deepEqual(ids({ status: 'approved' }), [a]);
  assert.deepEqual(ids({ approver: U.carol }), [a]);
  assert.deepEqual(ids({ approver: U.lead }), []);
  assert.deepEqual(ids({ from: '2024-03-21', to: '2024-03-21' }), [b]);
  assert.ok(clock);
});

test('dashboard answers the four participation questions', () => {
  const { log, a, b, c } = seed();
  act(log, a, U.alice, 'propose');
  act(log, b, U.bob, 'propose');
  act(log, a, U.carol, 'vote', { vote: 'approve' });
  log.addComment(c, U.david, { content: 'thoughts' });
  const bobs = log.dashboard(U.bob);
  assert.deepEqual(bobs.owned.map((d) => d.id), [b]);
  assert.deepEqual(bobs.awaiting_my_approval.map((d) => d.id), [a]);
  assert.deepEqual(log.dashboard(U.carol).awaiting_my_approval.map((d) => d.id), [b]); // already voted on a
  assert.deepEqual(log.dashboard(U.david).contributed.map((d) => d.id), [c]);
  assert.equal(log.dashboard(U.alice).in_my_projects.length, 3);
});

test('reports: volume, approval metrics, revision cycles, participation, todos', () => {
  const { log, clock, a, b } = seed();
  act(log, a, U.alice, 'propose');
  clock.advanceHours(10);
  for (const u of [U.bob, U.carol, U.david]) act(log, a, u, 'vote', { vote: 'approve' });
  act(log, b, U.bob, 'propose');
  act(log, b, U.lead, 'request_revision', { reason: 'more detail' });
  act(log, a, U.alice, 'assign_followup', { title: 't', assigned_to: U.bob, due_date: '2024-09-01' });

  const vol = log.report('decision_volume', { actor: U.org });
  assert.equal(vol.by_month['2024-03'], 3);
  assert.equal(vol.by_team.default, 3);
  const m = log.report('approval_metrics', { actor: U.org });
  assert.equal(m.approved, 1);
  assert.equal(m.declined, 0);
  assert.equal(m.approval_rate, 1);
  assert.equal(m.avg_hours_to_approval, 10);
  const r = log.report('revision_cycles', { actor: U.org });
  assert.equal(r.by_decision[b], 1);
  assert.equal(r.average, 0.5);
  const p = log.report('participation', { actor: U.org });
  assert.ok(p.voters.find((v) => v.user === U.bob).count >= 1);
  const t = log.report('todo_completion', { actor: U.org });
  assert.equal(t.total, 1);
  const au = log.report('audit', { actor: U.org, from: '2024-03-01', to: '2024-03-31' });
  assert.ok(au.entries.length > 5);
  assertCode(() => log.report('nonsense', { actor: U.org }), 'VALIDATION_ERROR', 400);
  assertCode(() => log.report('audit', { actor: U.bob }), 'FORBIDDEN', 403);
});

test('export as JSON includes votes; CSV escapes properly', () => {
  const { log, a } = seed();
  log.updateDraft(a, U.alice, { title: 'Title, with "quotes"' });
  const json = log.exportDecisions({ actor: U.org, format: 'json' });
  assert.equal(json.length, 3);
  assert.ok('votes' in json[0] && 'content' in json[0]);
  const csv = log.exportDecisions({ actor: U.org, format: 'csv' });
  const lines = csv.trim().split('\n');
  assert.equal(lines[0].split(',')[0], 'id');
  assert.ok(csv.includes('"Title, with ""quotes"""'));
  assert.equal(lines.length, 4);
  assert.ok(proposed);
});
