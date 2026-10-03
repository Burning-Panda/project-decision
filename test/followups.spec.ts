import { describe, it, expect } from 'bun:test';
import { setup, proposed, act, expectCode, U, FOLLOWUP as FU } from './support/index.js';

describe('assign_followup creates a pending follow-up/todo and notifies the assignee', () => {
  async function assigned() {
    const { log } = await setup();
    const id = proposed(log);
    const r = act(log, id, U.alice, 'assign_followup', FU);
    return { log, id, r };
  }

  describe('GIVEN a proposed decision', () => {
    describe('WHEN alice assigns a follow-up to bob', () => {
      it('THEN 201 with a pending followup-NNN owned by bob', async () => {
        const { id, r } = await assigned();
        expect(r.status_code).toBe(201);
        const f = r.data.followup;
        expect(f.id).toMatch(/^followup-\d{3}$/);
        expect(f.decision_id).toBe(id);
        expect(f.assigned_to).toBe(U.bob);
        expect(f.created_by).toBe(U.alice);
        expect(f.status).toBe('pending');
        expect(f.completed_at).toBe(null);
      });
    });
  });

  describe('GIVEN a follow-up assigned to bob', () => {
    describe('WHEN bob lists notifications', () => {
      it('THEN he has followup_assigned', async () => {
        const { log } = await assigned();
        expect(log.listNotifications(U.bob).some((n: any) => n.type === 'followup_assigned')).toBe(true);
      });
    });
  });

  describe('GIVEN a follow-up assigned', () => {
    describe('WHEN the decision is read', () => {
      it('THEN it lists the follow-up', async () => {
        const { log, id } = await assigned();
        expect(log.getDecision(id, U.alice).followups.length).toBe(1);
      });
    });
  });
});

describe('assign_followup validation and permissions', () => {
  const invalid: Array<[string, Record<string, unknown>]> = [
    ['an empty title', { title: '' }],
    ['an assignee outside the team', { assigned_to: U.outsider }],
    ['a non-date due_date', { due_date: 'tomorrow' }],
    ['an unknown priority', { priority: 'urgent' }],
  ];

  for (const [label, over] of invalid) {
    describe(`GIVEN a proposed decision`, () => {
      describe(`WHEN a follow-up is assigned with ${label}`, () => {
        it(`THEN VALIDATION_ERROR 400`, async () => {
          const { log } = await setup();
          const id = proposed(log);
          expectCode(() => act(log, id, U.alice, 'assign_followup', { ...FU, ...over }), 'VALIDATION_ERROR', 400);
        });
      });
    });
  }

  describe('GIVEN a proposed decision', () => {
    describe('WHEN an outsider assigns a follow-up', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup();
        const id = proposed(log);
        expectCode(() => act(log, id, U.outsider, 'assign_followup', FU), 'FORBIDDEN', 403);
      });
    });
    describe('WHEN a follow-up is assigned without a priority', () => {
      it('THEN it defaults to medium', async () => {
        const { log } = await setup();
        const id = proposed(log);
        const r = act(log, id, U.alice, 'assign_followup', { title: 'x', assigned_to: U.bob });
        expect(r.data.followup.priority).toBe('medium');
      });
    });
  });
});

describe('todo list is per user with decision context, filters, sorting and paging', () => {
  async function todos() {
    const { log } = await setup();
    const id = proposed(log);
    const mk = (over: Record<string, unknown>) => act(log, id, U.alice, 'assign_followup', { ...FU, ...over }).data.followup;
    mk({ title: 'A', due_date: '2024-05-01', priority: 'low' });
    mk({ title: 'B', due_date: '2024-04-10', priority: 'high' });
    const c = mk({ title: 'C', due_date: '2024-04-20', priority: 'medium' });
    mk({ title: 'Carol only', assigned_to: U.carol });
    log.updateTodo(c.id, U.bob, { status: 'in_progress' });
    return log;
  }

  describe('GIVEN todos for bob and carol', () => {
    describe('WHEN bob lists his todos', () => {
      it('THEN he gets only his three, each with the decision title', async () => {
        const log = await todos();
        const all = log.listTodos({ user: U.bob });
        expect(all.total).toBe(3);
        expect(all.items.every((t: any) => t.assigned_to === U.bob && t.decision_title === 'Migrate to new database')).toBe(true);
      });
    });
  });

  describe('GIVEN bob\'s todos', () => {
    describe('WHEN sorted by due_date', () => {
      it('THEN B, C, A', async () => {
        const log = await todos();
        expect(log.listTodos({ user: U.bob, sort: 'due_date' }).items.map((t: any) => t.title)).toEqual(['B', 'C', 'A']);
      });
    });
    describe('WHEN sorted by priority', () => {
      it('THEN B, C, A', async () => {
        const log = await todos();
        expect(log.listTodos({ user: U.bob, sort: 'priority' }).items.map((t: any) => t.title)).toEqual(['B', 'C', 'A']);
      });
    });
  });

  describe('GIVEN one in-progress todo', () => {
    describe('WHEN filtered by status in_progress', () => {
      it('THEN only C returns', async () => {
        const log = await todos();
        expect(log.listTodos({ user: U.bob, status: 'in_progress' }).items.map((t: any) => t.title)).toEqual(['C']);
      });
    });
  });

  describe('GIVEN bob\'s todos', () => {
    describe('WHEN filtered by an unknown project', () => {
      it('THEN none return', async () => {
        const log = await todos();
        expect(log.listTodos({ user: U.bob, project: 'NOPE' }).total).toBe(0);
      });
    });
  });

  describe('GIVEN three todos', () => {
    describe('WHEN paged with limit 1 offset 1 sorted by due_date', () => {
      it('THEN total stays 3 and the page is C', async () => {
        const log = await todos();
        const page = log.listTodos({ user: U.bob, sort: 'due_date', limit: 1, offset: 1 });
        expect(page.total).toBe(3);
        expect(page.items.map((t: any) => t.title)).toEqual(['C']);
      });
    });
  });
});

describe('assignees update status/notes; completion syncs to the decision', () => {
  async function assignedToBob() {
    const { log, clock } = await setup();
    const id = proposed(log);
    const f = act(log, id, U.alice, 'assign_followup', FU).data.followup;
    return { log, clock, id, f };
  }

  describe('GIVEN bob\'s todo', () => {
    describe('WHEN carol completes it', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log, f } = await assignedToBob();
        expectCode(() => log.updateTodo(f.id, U.carol, { status: 'completed' }), 'FORBIDDEN', 403);
      });
    });
    describe('WHEN bob sets the derived status overdue', () => {
      it('THEN VALIDATION_ERROR 400', async () => {
        const { log, f } = await assignedToBob();
        expectCode(() => log.updateTodo(f.id, U.bob, { status: 'overdue' }), 'VALIDATION_ERROR', 400);
      });
    });
    describe('WHEN bob sets an unknown status', () => {
      it('THEN VALIDATION_ERROR 400', async () => {
        const { log, f } = await assignedToBob();
        expectCode(() => log.updateTodo(f.id, U.bob, { status: 'done' }), 'VALIDATION_ERROR', 400);
      });
    });
  });

  describe('GIVEN no such todo', () => {
    describe('WHEN bob updates followup-999', () => {
      it('THEN NOT_FOUND 404', async () => {
        const { log } = await assignedToBob();
        expectCode(() => log.updateTodo('followup-999', U.bob, { status: 'completed' }), 'NOT_FOUND', 404);
      });
    });
  });

  describe('GIVEN bob\'s todo one day later', () => {
    describe('WHEN bob completes it with notes', () => {
      it('THEN it is completed with notes and a completion timestamp', async () => {
        // Given
        const { log, clock, f } = await assignedToBob();
        clock.advanceDays(1);
        // When
        const done = log.updateTodo(f.id, U.bob, { status: 'completed', notes: 'results in comments' });
        // Then
        expect(done.status).toBe('completed');
        expect(done.assignee_notes).toBe('results in comments');
        expect(done.completed_at).toBe('2024-03-21T10:00:00.000Z');
      });
    });
  });

  describe('GIVEN bob completed his todo', () => {
    describe('WHEN the decision is read', () => {
      it('THEN its follow-up shows completed', async () => {
        // Given
        const { log, clock, id, f } = await assignedToBob();
        clock.advanceDays(1);
        // When
        log.updateTodo(f.id, U.bob, { status: 'completed', notes: 'results in comments' });
        // Then
        expect(log.getDecision(id, U.alice).followups[0].status).toBe('completed');
      });
    });
  });
});

describe('overdue is derived from the due date and never applies to completed items', () => {
  async function lateAndDone() {
    const { log, clock } = await setup();
    const id = proposed(log);
    const late = act(log, id, U.alice, 'assign_followup', { ...FU, title: 'late', due_date: '2024-03-25' }).data.followup;
    const ok = act(log, id, U.alice, 'assign_followup', { ...FU, title: 'ok', due_date: '2024-03-25' }).data.followup;
    log.updateTodo(ok.id, U.bob, { status: 'completed' });
    return { log, clock, late, ok };
  }

  describe('GIVEN todos before their due date', () => {
    describe('WHEN bob lists overdue', () => {
      it('THEN none', async () => {
        const { log } = await lateAndDone();
        expect(log.listTodos({ user: U.bob, status: 'overdue' }).total).toBe(0);
      });
    });
  });

  describe('GIVEN 10 days past due', () => {
    describe('WHEN bob lists overdue', () => {
      it('THEN only the incomplete todo returns, reported as overdue', async () => {
        // Given
        const { log, clock, late } = await lateAndDone();
        clock.advanceDays(10);
        // When
        const od = log.listTodos({ user: U.bob, status: 'overdue' });
        // Then
        expect(od.items.map((t: any) => t.id)).toEqual([late.id]);
        expect(od.items[0].status).toBe('overdue');
      });
    });
    describe('WHEN bob lists completed', () => {
      it('THEN the completed todo is not overdue', async () => {
        const { log, clock, ok } = await lateAndDone();
        clock.advanceDays(10);
        expect(log.listTodos({ user: U.bob, status: 'completed' }).items[0].id).toBe(ok.id);
      });
    });
  });
});

describe('todo stats summarise completion', () => {
  describe('GIVEN four todos (one completed, one past due)', () => {
    describe('WHEN bob\'s stats are read', () => {
      it('THEN totals, rate, overdue and on-track match', async () => {
        // Given
        const { log, clock } = await setup();
        const id = proposed(log);
        const mk = (due: string) => act(log, id, U.alice, 'assign_followup', { ...FU, due_date: due }).data.followup;
        const a = mk('2024-03-25'); mk('2024-03-26'); mk('2024-06-01'); mk('2024-06-02');
        log.updateTodo(a.id, U.bob, { status: 'completed' });
        clock.advanceDays(10);
        // When
        const stats = log.todoStats(U.bob);
        // Then
        expect(stats).toEqual({ total: 4, completed: 1, completion_rate: 0.25, overdue: 1, on_track: 2 });
      });
    });
  });
});
