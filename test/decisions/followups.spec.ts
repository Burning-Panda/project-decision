import { describe, it, expect, beforeEach } from 'bun:test';
import { proposedIn, act, expectCode, U, FOLLOWUP as FU } from '../support/index';

// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.
// Actions expected to fail are captured as a thunk in WHEN and invoked by expectCode in THEN.
// THEN may call read-only queries (getDecision, listTodos, ...) to observe the outcome.

type Handle = ReturnType<typeof proposedIn>;

/** Alice assigns a follow-up on the handle's decision (FOLLOWUP, to bob, unless overridden) and returns it. */
const assign = (h: Handle, over: Record<string, unknown> = {}) =>
  act(h.log, h.id, U.alice, 'assign_followup', { ...FU, ...over }).data.followup;

/** Call inside a describe(): a proposed decision with FOLLOWUP assigned to bob; `f` is set before each test. */
function assignedToBob() {
  const h = proposedIn() as Handle & { f: any };
  beforeEach(() => { h.f = assign(h); });
  return h;
}

describe('assign_followup creates a pending follow-up/todo and notifies the assignee', () => {
  describe('GIVEN a proposed decision', () => {
    const h = proposedIn();

    describe('WHEN alice assigns a follow-up to bob', () => {
      let r: any;
      beforeEach(() => { r = act(h.log, h.id, U.alice, 'assign_followup', FU); });

      it('THEN 201 with a pending followup-NNN owned by bob', () => {
        expect(r.status_code).toBe(201);
        const f = r.data.followup;
        expect(f.id).toMatch(/^followup-\d{3}$/);
        expect(f.decision_id).toBe(h.id);
        expect(f.assigned_to).toBe(U.bob);
        expect(f.created_by).toBe(U.alice);
        expect(f.status).toBe('pending');
        expect(f.completed_at).toBe(null);
      });

      it('THEN bob has a followup_assigned notification', () => {
        expect(h.log.listNotifications(U.bob).some((n: any) => n.type === 'followup_assigned')).toBe(true);
      });

      it('THEN the decision lists the follow-up', () => {
        expect(h.log.getDecision(h.id, U.alice).followups.length).toBe(1);
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
    describe('GIVEN a proposed decision', () => {
      const h = proposedIn();

      describe(`WHEN a follow-up is assigned with ${label}`, () => {
        let assignInvalid: () => unknown;
        beforeEach(() => { assignInvalid = () => assign(h, over); });

        it('THEN VALIDATION_ERROR 400', () => {
          expectCode(assignInvalid, 'VALIDATION_ERROR', 400);
        });
      });
    });
  }

  describe('GIVEN a proposed decision', () => {
    const h = proposedIn();

    describe('WHEN an outsider assigns a follow-up', () => {
      let assignAsOutsider: () => unknown;
      beforeEach(() => { assignAsOutsider = () => act(h.log, h.id, U.outsider, 'assign_followup', FU); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(assignAsOutsider, 'FORBIDDEN', 403);
      });
    });

    describe('WHEN a follow-up is assigned without a priority', () => {
      let f: any;
      beforeEach(() => { f = act(h.log, h.id, U.alice, 'assign_followup', { title: 'x', assigned_to: U.bob }).data.followup; });

      it('THEN it defaults to medium', () => {
        expect(f.priority).toBe('medium');
      });
    });
  });
});

describe('todo list is per user with decision context, filters, sorting and paging', () => {
  // Due-date order is B, C, A; priority order (high to low) is A, C, B.
  describe('GIVEN bob has todos A, B and C (C in progress) and carol has one', () => {
    const h = proposedIn();
    beforeEach(() => {
      assign(h, { title: 'A', due_date: '2024-05-01', priority: 'high' });
      assign(h, { title: 'B', due_date: '2024-04-10', priority: 'low' });
      const c = assign(h, { title: 'C', due_date: '2024-04-20', priority: 'medium' });
      assign(h, { title: 'Carol only', assigned_to: U.carol });
      h.log.updateTodo(c.id, U.bob, { status: 'in_progress' });
    });
    const titles = (page: any) => page.items.map((t: any) => t.title);

    describe('WHEN bob lists his todos', () => {
      let page: any;
      beforeEach(() => { page = h.log.listTodos({ user: U.bob }); });

      it('THEN he gets only his three, each with the decision title', () => {
        expect(page.total).toBe(3);
        expect(page.items.every((t: any) => t.assigned_to === U.bob && t.decision_title === 'Migrate to new database')).toBe(true);
      });
    });

    describe('WHEN sorted by due_date', () => {
      let page: any;
      beforeEach(() => { page = h.log.listTodos({ user: U.bob, sort: 'due_date' }); });

      it('THEN B, C, A', () => {
        expect(titles(page)).toEqual(['B', 'C', 'A']);
      });
    });

    describe('WHEN sorted by priority', () => {
      let page: any;
      beforeEach(() => { page = h.log.listTodos({ user: U.bob, sort: 'priority' }); });

      it('THEN high to low: A, C, B (the reverse of due order)', () => {
        expect(titles(page)).toEqual(['A', 'C', 'B']);
      });
    });

    describe('WHEN filtered by status in_progress', () => {
      let page: any;
      beforeEach(() => { page = h.log.listTodos({ user: U.bob, status: 'in_progress' }); });

      it('THEN only C returns', () => {
        expect(titles(page)).toEqual(['C']);
      });
    });

    describe('WHEN filtered by an unknown project', () => {
      let page: any;
      beforeEach(() => { page = h.log.listTodos({ user: U.bob, project: 'NOPE' }); });

      it('THEN none return', () => {
        expect(page.total).toBe(0);
      });
    });

    describe('WHEN paged with limit 1 offset 1 sorted by due_date', () => {
      let page: any;
      beforeEach(() => { page = h.log.listTodos({ user: U.bob, sort: 'due_date', limit: 1, offset: 1 }); });

      it('THEN total stays 3 and the page is C', () => {
        expect(page.total).toBe(3);
        expect(titles(page)).toEqual(['C']);
      });
    });
  });
});

describe('assignees update status/notes; completion syncs to the decision', () => {
  describe('GIVEN bob\'s todo', () => {
    const h = assignedToBob();

    describe('WHEN carol completes it', () => {
      let update: () => unknown;
      beforeEach(() => { update = () => h.log.updateTodo(h.f.id, U.carol, { status: 'completed' }); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(update, 'FORBIDDEN', 403);
      });
    });

    describe('WHEN bob sets the derived status overdue', () => {
      let update: () => unknown;
      beforeEach(() => { update = () => h.log.updateTodo(h.f.id, U.bob, { status: 'overdue' }); });

      it('THEN VALIDATION_ERROR 400', () => {
        expectCode(update, 'VALIDATION_ERROR', 400);
      });
    });

    describe('WHEN bob sets an unknown status', () => {
      let update: () => unknown;
      beforeEach(() => { update = () => h.log.updateTodo(h.f.id, U.bob, { status: 'done' }); });

      it('THEN VALIDATION_ERROR 400', () => {
        expectCode(update, 'VALIDATION_ERROR', 400);
      });
    });

    describe('WHEN bob updates followup-999', () => {
      let update: () => unknown;
      beforeEach(() => { update = () => h.log.updateTodo('followup-999', U.bob, { status: 'completed' }); });

      it('THEN NOT_FOUND 404', () => {
        expectCode(update, 'NOT_FOUND', 404);
      });
    });
  });

  describe('GIVEN bob\'s todo one day later', () => {
    const h = assignedToBob();
    beforeEach(() => { h.clock.advanceDays(1); });

    describe('WHEN bob completes it with notes', () => {
      let done: any;
      beforeEach(() => { done = h.log.updateTodo(h.f.id, U.bob, { status: 'completed', notes: 'results in comments' }); });

      it('THEN it is completed with notes and a completion timestamp', () => {
        expect(done.status).toBe('completed');
        expect(done.assignee_notes).toBe('results in comments');
        expect(done.completed_at).toBe('2024-03-21T10:00:00.000Z');
      });

      it('THEN the decision\'s follow-up shows completed', () => {
        expect(h.log.getDecision(h.id, U.alice).followups[0].status).toBe('completed');
      });
    });
  });
});

describe('overdue is derived from the due date and never applies to completed items', () => {
  /** Two todos for bob due 2024-03-25: `late` still pending, `ok` completed. */
  function lateAndDone() {
    const h = proposedIn() as Handle & { late: any; ok: any };
    beforeEach(() => {
      h.late = assign(h, { title: 'late', due_date: '2024-03-25' });
      h.ok = assign(h, { title: 'ok', due_date: '2024-03-25' });
      h.log.updateTodo(h.ok.id, U.bob, { status: 'completed' });
    });
    return h;
  }

  describe('GIVEN todos before their due date', () => {
    const h = lateAndDone();

    describe('WHEN bob lists overdue', () => {
      let page: any;
      beforeEach(() => { page = h.log.listTodos({ user: U.bob, status: 'overdue' }); });

      it('THEN none', () => {
        expect(page.total).toBe(0);
      });
    });
  });

  describe('GIVEN 10 days past due', () => {
    const h = lateAndDone();
    beforeEach(() => { h.clock.advanceDays(10); });

    describe('WHEN bob lists overdue', () => {
      let page: any;
      beforeEach(() => { page = h.log.listTodos({ user: U.bob, status: 'overdue' }); });

      it('THEN only the incomplete todo returns, reported as overdue', () => {
        expect(page.items.map((t: any) => t.id)).toEqual([h.late.id]);
        expect(page.items[0].status).toBe('overdue');
      });
    });

    describe('WHEN bob lists completed', () => {
      let page: any;
      beforeEach(() => { page = h.log.listTodos({ user: U.bob, status: 'completed' }); });

      it('THEN the completed todo is not overdue', () => {
        expect(page.items.map((t: any) => [t.id, t.status])).toEqual([[h.ok.id, 'completed']]);
      });
    });
  });
});

describe('todo stats summarise completion', () => {
  describe('GIVEN four todos for bob, ten days on (one completed, one past due, two on track)', () => {
    const h = proposedIn();
    beforeEach(() => {
      const first = assign(h, { due_date: '2024-03-25' });
      for (const due of ['2024-03-26', '2024-06-01', '2024-06-02']) assign(h, { due_date: due });
      h.log.updateTodo(first.id, U.bob, { status: 'completed' });
      h.clock.advanceDays(10);
    });

    describe('WHEN bob\'s stats are read', () => {
      let stats: any;
      beforeEach(() => { stats = h.log.todoStats(U.bob); });

      it('THEN totals, rate, overdue and on-track match', () => {
        expect(stats).toEqual({ total: 4, completed: 1, completion_rate: 0.25, overdue: 1, on_track: 2 });
      });
    });
  });
});
