import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, proposed, act, assertCode, U } from './helpers.js';

const FU = { title: 'Benchmark PostgreSQL', assigned_to: U.bob, due_date: '2024-04-15', priority: 'high', description: 'Compare to MySQL 8' };

test('assign_followup creates a pending follow-up/todo and notifies the assignee', () => {
  const { log } = setup();
  const id = proposed(log);
  const r = act(log, id, U.alice, 'assign_followup', FU);
  assert.equal(r.status_code, 201);
  const f = r.data.followup;
  assert.match(f.id, /^followup-\d{3}$/);
  assert.equal(f.decision_id, id);
  assert.equal(f.assigned_to, U.bob);
  assert.equal(f.created_by, U.alice);
  assert.equal(f.status, 'pending');
  assert.equal(f.completed_at, null);
  assert.ok(log.listNotifications(U.bob).some((n) => n.type === 'followup_assigned'));
  assert.equal(log.getDecision(id, U.alice).followups.length, 1);
});

test('assign_followup validation and permissions', () => {
  const { log } = setup();
  const id = proposed(log);
  assertCode(() => act(log, id, U.alice, 'assign_followup', { ...FU, title: '' }), 'VALIDATION_ERROR', 400);
  assertCode(() => act(log, id, U.alice, 'assign_followup', { ...FU, assigned_to: U.outsider }), 'VALIDATION_ERROR', 400);
  assertCode(() => act(log, id, U.alice, 'assign_followup', { ...FU, due_date: 'tomorrow' }), 'VALIDATION_ERROR', 400);
  assertCode(() => act(log, id, U.alice, 'assign_followup', { ...FU, priority: 'urgent' }), 'VALIDATION_ERROR', 400);
  assertCode(() => act(log, id, U.outsider, 'assign_followup', FU), 'FORBIDDEN', 403);
  const r = act(log, id, U.alice, 'assign_followup', { title: 'x', assigned_to: U.bob });
  assert.equal(r.data.followup.priority, 'medium');
});

test('todo list is per user with decision context, filters, sorting and paging', () => {
  const { log } = setup();
  const id = proposed(log);
  const mk = (over) => act(log, id, U.alice, 'assign_followup', { ...FU, ...over }).data.followup;
  const a = mk({ title: 'A', due_date: '2024-05-01', priority: 'low' });
  const b = mk({ title: 'B', due_date: '2024-04-10', priority: 'high' });
  const c = mk({ title: 'C', due_date: '2024-04-20', priority: 'medium' });
  mk({ title: 'Carol only', assigned_to: U.carol });
  log.updateTodo(c.id, U.bob, { status: 'in_progress' });

  const all = log.listTodos({ user: U.bob });
  assert.equal(all.total, 3);
  assert.ok(all.items.every((t) => t.assigned_to === U.bob && t.decision_title === 'Migrate to new database'));
  assert.deepEqual(log.listTodos({ user: U.bob, sort: 'due_date' }).items.map((t) => t.title), ['B', 'C', 'A']);
  assert.deepEqual(log.listTodos({ user: U.bob, sort: 'priority' }).items.map((t) => t.title), ['B', 'C', 'A']);
  assert.deepEqual(log.listTodos({ user: U.bob, status: 'in_progress' }).items.map((t) => t.title), ['C']);
  assert.equal(log.listTodos({ user: U.bob, project: 'NOPE' }).total, 0);
  const page = log.listTodos({ user: U.bob, sort: 'due_date', limit: 1, offset: 1 });
  assert.equal(page.total, 3);
  assert.deepEqual(page.items.map((t) => t.title), ['C']);
  assert.ok(a && b);
});

test('assignees update status/notes; completion syncs to the decision', () => {
  const { log, clock } = setup();
  const id = proposed(log);
  const f = act(log, id, U.alice, 'assign_followup', FU).data.followup;
  assertCode(() => log.updateTodo(f.id, U.carol, { status: 'completed' }), 'FORBIDDEN', 403);
  assertCode(() => log.updateTodo(f.id, U.bob, { status: 'overdue' }), 'VALIDATION_ERROR', 400);
  assertCode(() => log.updateTodo(f.id, U.bob, { status: 'done' }), 'VALIDATION_ERROR', 400);
  assertCode(() => log.updateTodo('followup-999', U.bob, { status: 'completed' }), 'NOT_FOUND', 404);
  clock.advanceDays(1);
  const done = log.updateTodo(f.id, U.bob, { status: 'completed', notes: 'results in comments' });
  assert.equal(done.status, 'completed');
  assert.equal(done.assignee_notes, 'results in comments');
  assert.equal(done.completed_at, '2024-03-21T10:00:00.000Z');
  assert.equal(log.getDecision(id, U.alice).followups[0].status, 'completed');
});

test('overdue is derived from the due date and never applies to completed items', () => {
  const { log, clock } = setup();
  const id = proposed(log);
  const late = act(log, id, U.alice, 'assign_followup', { ...FU, title: 'late', due_date: '2024-03-25' }).data.followup;
  const ok = act(log, id, U.alice, 'assign_followup', { ...FU, title: 'ok', due_date: '2024-03-25' }).data.followup;
  log.updateTodo(ok.id, U.bob, { status: 'completed' });
  assert.equal(log.listTodos({ user: U.bob, status: 'overdue' }).total, 0);
  clock.advanceDays(10);
  const od = log.listTodos({ user: U.bob, status: 'overdue' });
  assert.deepEqual(od.items.map((t) => t.id), [late.id]);
  assert.equal(od.items[0].status, 'overdue');
  assert.equal(log.listTodos({ user: U.bob, status: 'completed' }).items[0].id, ok.id);
});

test('todo stats summarise completion', () => {
  const { log, clock } = setup();
  const id = proposed(log);
  const mk = (due) => act(log, id, U.alice, 'assign_followup', { ...FU, due_date: due }).data.followup;
  const a = mk('2024-03-25'); mk('2024-03-26'); mk('2024-06-01'); mk('2024-06-02');
  log.updateTodo(a.id, U.bob, { status: 'completed' });
  clock.advanceDays(10);
  assert.deepEqual(log.todoStats(U.bob), { total: 4, completed: 1, completion_rate: 0.25, overdue: 1, on_track: 2 });
});
