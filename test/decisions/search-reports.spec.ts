import { describe, it, expect, beforeEach } from 'bun:test';
import { freshLog, draft, act, expectCode, U, type LogHandle } from '../support/index';

// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.
// Actions expected to fail are captured as a thunk in WHEN and invoked by expectCode in THEN.

type Seeded = LogHandle & { a: string; b: string; c: string };

/**
 * Call inside a describe(): consensus mode plus project WEB and three drafts created a day apart:
 *   a  PRJ-001  alice  'Migrate to PostgreSQL'        2024-03-20
 *   b  PRJ-002  bob    'API rate limiting strategy'   2024-03-21
 *   c  WEB-001  alice  'Frontend framework'           2024-03-22
 */
function seeded(): Seeded {
  const h = freshLog({ mode: 'consensus_voting' }) as Seeded;
  beforeEach(() => {
    const { log, clock } = h;
    log.createProject({ owner: 'acme', identifier: 'WEB', title: 'Web', actor: U.org });
    h.a = draft(log, { title: 'Migrate to PostgreSQL', content: 'Move the primary database to Postgres.' }).id;
    clock.advanceDays(1);
    h.b = draft(log, { actor: U.bob, title: 'API rate limiting strategy', content: 'Token bucket per customer.' }).id;
    clock.advanceDays(1);
    h.c = draft(log, { project: 'WEB', title: 'Frontend framework', content: 'Adopt a component framework.' }).id;
  });
  return h;
}

const listedIds = (page: any) => page.items.map((d: any) => d.id);
const hitIds = (result: any) => result.items.map((r: any) => r.decision_id);

describe('listDecisions filters, sorts and paginates', () => {
  describe('GIVEN three decisions', () => {
    const h = seeded();

    describe('WHEN alice lists all', () => {
      let page: any;
      beforeEach(() => { page = h.log.listDecisions({ actor: U.alice }); });

      it('THEN the total is 3', () => {
        expect(page.total).toBe(3);
      });

      it('THEN the page size defaults to 25', () => {
        expect(page.limit).toBe(25);
      });
    });

    describe('WHEN filtered by project PRJ', () => {
      let page: any;
      beforeEach(() => { page = h.log.listDecisions({ actor: U.alice, project: 'PRJ' }); });

      it('THEN newest first by default', () => {
        expect(listedIds(page)).toEqual([h.b, h.a]);
      });
    });

    describe('WHEN sorted +created_at', () => {
      let page: any;
      beforeEach(() => { page = h.log.listDecisions({ actor: U.alice, sort: '+created_at' }); });

      it('THEN oldest first', () => {
        expect(listedIds(page)).toEqual([h.a, h.b, h.c]);
      });
    });

    describe('WHEN filtered by team with limit 1 offset 1 sorted +created_at', () => {
      let page: any;
      beforeEach(() => { page = h.log.listDecisions({ actor: U.alice, team: 'default', sort: '+created_at', limit: 1, offset: 1 }); });

      it('THEN the second one returns', () => {
        expect(listedIds(page)).toEqual([h.b]);
      });
    });

    describe('WHEN listed with a limit of 500', () => {
      let page: any;
      beforeEach(() => { page = h.log.listDecisions({ actor: U.alice, limit: 500 }); });

      it('THEN the page size is capped at 100', () => {
        expect(page.limit).toBe(100);
      });
    });

    describe('WHEN an outsider lists', () => {
      let page: any;
      beforeEach(() => { page = h.log.listDecisions({ actor: U.outsider }); });

      it('THEN the total is 0', () => {
        expect(page.total).toBe(0);
      });
    });
  });

  describe('GIVEN one proposed decision', () => {
    const h = seeded();
    beforeEach(() => { act(h.log, h.a, U.alice, 'propose'); });

    describe('WHEN filtered by status proposed', () => {
      let page: any;
      beforeEach(() => { page = h.log.listDecisions({ actor: U.alice, status: 'proposed' }); });

      it('THEN only it returns', () => {
        expect(listedIds(page)).toEqual([h.a]);
      });
    });
  });
});

describe('search finds content, ids, comments and transcripts, honouring access', () => {
  describe('GIVEN a Postgres decision with a pgbouncer meeting and a rate-limit decision with a sliding-windows comment', () => {
    const h = seeded();
    beforeEach(() => {
      h.log.addComment(h.b, U.carol, { content: 'What about sliding windows?' });
      act(h.log, h.a, U.alice, 'propose');
      act(h.log, h.a, U.bob, 'add_meeting', { segments: [{ start_seconds: 0, speaker: 'Bob', text: 'We discussed pgbouncer pooling' }] });
    });
    const search = (q: string, actor = U.alice) => h.log.search({ actor, q });

    describe('WHEN searching "postgres"', () => {
      let result: any;
      beforeEach(() => { result = search('postgres'); });

      it('THEN the Postgres decision is found by content/title', () => {
        expect(hitIds(result)).toEqual([h.a]);
      });
    });

    describe('WHEN searching the id PRJ-002', () => {
      let result: any;
      beforeEach(() => { result = search('PRJ-002'); });

      it('THEN the exact match ranks first, ahead of fuzzy id matches', () => {
        expect(hitIds(result)[0]).toBe(h.b);
      });
    });

    describe('WHEN searching "sliding"', () => {
      let result: any;
      beforeEach(() => { result = search('sliding'); });

      it('THEN the commented decision is found', () => {
        expect(hitIds(result)).toEqual([h.b]);
      });
    });

    describe('WHEN searching "pgbouncer"', () => {
      let result: any;
      beforeEach(() => { result = search('pgbouncer'); });

      it('THEN the decision is found', () => {
        expect(hitIds(result)).toEqual([h.a]);
      });

      it('THEN matched_in includes transcript', () => {
        expect(result.items[0].matched_in).toContain('transcript');
      });
    });

    describe('WHEN searching the misspelling "postgress"', () => {
      let result: any;
      beforeEach(() => { result = search('postgress'); });

      it('THEN fuzzy matching finds it', () => {
        expect(hitIds(result)).toEqual([h.a]);
      });
    });

    describe('WHEN searching gibberish', () => {
      let result: any;
      beforeEach(() => { result = search('zzzzzz'); });

      it('THEN nothing is returned', () => {
        expect(hitIds(result)).toEqual([]);
      });
    });

    describe('WHEN an outsider searches "postgres"', () => {
      let result: any;
      beforeEach(() => { result = search('postgres', U.outsider); });

      it('THEN nothing is returned', () => {
        expect(result.items).toEqual([]);
      });
    });
  });
});

describe('search filters by status, owner, project, approver and date range', () => {
  const filtered = (h: Seeded, f: Record<string, unknown>) =>
    hitIds(h.log.search({ actor: U.alice, q: '', ...f })).sort();

  describe('GIVEN decisions by alice and bob in PRJ and WEB, created on three consecutive days', () => {
    const h = seeded();

    describe('WHEN filtered by owner bob', () => {
      let ids: string[];
      beforeEach(() => { ids = filtered(h, { owner: U.bob }); });

      it('THEN only his return', () => {
        expect(ids).toEqual([h.b]);
      });
    });

    describe('WHEN filtered by project WEB', () => {
      let ids: string[];
      beforeEach(() => { ids = filtered(h, { project: 'WEB' }); });

      it('THEN only the WEB decision returns', () => {
        expect(ids).toEqual([h.c]);
      });
    });

    describe('WHEN filtered to 2024-03-21', () => {
      let ids: string[];
      beforeEach(() => { ids = filtered(h, { from: '2024-03-21', to: '2024-03-21' }); });

      it('THEN only that day\'s decision returns', () => {
        expect(ids).toEqual([h.b]);
      });
    });
  });

  describe('GIVEN PRJ-001 approved by bob, carol and david (not the lead)', () => {
    const h = seeded();
    beforeEach(() => {
      act(h.log, h.a, U.alice, 'propose');
      for (const u of [U.bob, U.carol, U.david]) act(h.log, h.a, u, 'vote', { vote: 'approve' });
    });

    describe('WHEN filtered by status approved', () => {
      let ids: string[];
      beforeEach(() => { ids = filtered(h, { status: 'approved' }); });

      it('THEN only it returns', () => {
        expect(ids).toEqual([h.a]);
      });
    });

    describe('WHEN filtered by approver carol', () => {
      let ids: string[];
      beforeEach(() => { ids = filtered(h, { approver: U.carol }); });

      it('THEN the approved decision returns', () => {
        expect(ids).toEqual([h.a]);
      });
    });

    describe('WHEN filtered by approver lead', () => {
      let ids: string[];
      beforeEach(() => { ids = filtered(h, { approver: U.lead }); });

      it('THEN none return', () => {
        expect(ids).toEqual([]);
      });
    });
  });
});

describe('dashboard answers the four participation questions', () => {
  describe('GIVEN alice\'s and bob\'s proposals open, carol voted on alice\'s, david commented on WEB-001', () => {
    const h = seeded();
    beforeEach(() => {
      act(h.log, h.a, U.alice, 'propose');
      act(h.log, h.b, U.bob, 'propose');
      act(h.log, h.a, U.carol, 'vote', { vote: 'approve' });
      h.log.addComment(h.c, U.david, { content: 'thoughts' });
    });
    const ids = (list: any[]) => list.map((d: any) => d.id);

    describe('WHEN bob\'s dashboard is read', () => {
      let dash: any;
      beforeEach(() => { dash = h.log.dashboard(U.bob); });

      it('THEN owned lists his proposal', () => {
        expect(ids(dash.owned)).toEqual([h.b]);
      });

      it('THEN alice\'s proposal awaits his approval', () => {
        expect(ids(dash.awaiting_my_approval)).toEqual([h.a]);
      });
    });

    describe('WHEN carol\'s dashboard is read', () => {
      let dash: any;
      beforeEach(() => { dash = h.log.dashboard(U.carol); });

      it('THEN only bob\'s proposal awaits her', () => {
        expect(ids(dash.awaiting_my_approval)).toEqual([h.b]);
      });
    });

    describe('WHEN david\'s dashboard is read', () => {
      let dash: any;
      beforeEach(() => { dash = h.log.dashboard(U.david); });

      it('THEN contributed lists the WEB decision', () => {
        expect(ids(dash.contributed)).toEqual([h.c]);
      });
    });

    describe('WHEN alice\'s dashboard is read', () => {
      let dash: any;
      beforeEach(() => { dash = h.log.dashboard(U.alice); });

      it('THEN in_my_projects has 3', () => {
        expect(dash.in_my_projects.length).toBe(3);
      });
    });
  });
});

describe('reports: volume, approval metrics, revision cycles, participation, todos', () => {
  describe('GIVEN March activity: PRJ-001 approved by three votes after 10 hours, PRJ-002 sent back for revision, one follow-up', () => {
    const h = seeded();
    beforeEach(() => {
      const { log, clock, a, b } = h;
      act(log, a, U.alice, 'propose');
      clock.advanceHours(10);
      for (const u of [U.bob, U.carol, U.david]) act(log, a, u, 'vote', { vote: 'approve' });
      act(log, b, U.bob, 'propose');
      act(log, b, U.lead, 'request_revision', { reason: 'more detail' });
      act(log, a, U.alice, 'assign_followup', { title: 't', assigned_to: U.bob, due_date: '2024-09-01' });
    });
    const report = (type: string, filters: Record<string, unknown> = {}) => h.log.report(type, { actor: U.org, ...filters });

    describe('WHEN decision_volume runs', () => {
      let vol: any;
      beforeEach(() => { vol = report('decision_volume'); });

      it('THEN by_month and by_team count the three decisions', () => {
        expect(vol.by_month['2024-03']).toBe(3);
        expect(vol.by_team.default).toBe(3);
      });
    });

    describe('WHEN approval_metrics runs', () => {
      let m: any;
      beforeEach(() => { m = report('approval_metrics'); });

      it('THEN counts, rate and average hours match', () => {
        expect(m.approved).toBe(1);
        expect(m.declined).toBe(0);
        expect(m.approval_rate).toBe(1);
        expect(m.avg_hours_to_approval).toBe(10);
      });
    });

    describe('WHEN revision_cycles runs', () => {
      let r: any;
      beforeEach(() => { r = report('revision_cycles'); });

      it('THEN the per-decision count and average match', () => {
        expect(r.by_decision[h.b]).toBe(1);
        expect(r.average).toBe(0.5);
      });
    });

    describe('WHEN participation runs', () => {
      let p: any;
      beforeEach(() => { p = report('participation'); });

      it('THEN bob appears among voters with a count of 1', () => {
        expect(p.voters.find((v: any) => v.user === U.bob).count).toBe(1);
      });
    });

    describe('WHEN todo_completion runs', () => {
      let t: any;
      beforeEach(() => { t = report('todo_completion'); });

      it('THEN the total is 1', () => {
        expect(t.total).toBe(1);
      });
    });

    describe('WHEN the audit report runs for March', () => {
      let actions: string[];
      beforeEach(() => { actions = report('audit', { from: '2024-03-01', to: '2024-03-31' }).entries.map((e: any) => e.action); });

      it('THEN it includes the three votes and the revision request', () => {
        expect(actions.filter((a) => a === 'vote').length).toBe(3);
        expect(actions).toContain('request_revision');
      });
    });

    describe('WHEN the audit report runs for April', () => {
      let au: any;
      beforeEach(() => { au = report('audit', { from: '2024-04-01', to: '2024-04-30' }); });

      it('THEN it is empty', () => {
        expect(au.entries).toEqual([]);
      });
    });

    describe('WHEN the org admin requests an unknown report', () => {
      let run: () => unknown;
      beforeEach(() => { run = () => report('nonsense'); });

      it('THEN VALIDATION_ERROR 400', () => {
        expectCode(run, 'VALIDATION_ERROR', 400);
      });
    });

    describe('WHEN a plain member requests the audit report', () => {
      let run: () => unknown;
      beforeEach(() => { run = () => h.log.report('audit', { actor: U.bob }); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(run, 'FORBIDDEN', 403);
      });
    });
  });
});

describe('export as JSON includes votes; CSV escapes properly', () => {
  describe('GIVEN three decisions, one titled with a comma and quotes', () => {
    const h = seeded();
    beforeEach(() => { h.log.updateDraft(h.a, U.alice, { title: 'Title, with "quotes"' }); });

    describe('WHEN exported as JSON', () => {
      let rows: any[];
      beforeEach(() => { rows = h.log.exportDecisions({ actor: U.org, format: 'json' }); });

      it('THEN three rows include votes and content', () => {
        expect(rows.length).toBe(3);
        expect(rows[0]).toHaveProperty('votes');
        expect(rows[0]).toHaveProperty('content');
      });
    });

    describe('WHEN exported as CSV', () => {
      let csv: string;
      beforeEach(() => { csv = h.log.exportDecisions({ actor: U.org, format: 'csv' }); });

      it('THEN it starts with an id column and the title is escaped', () => {
        expect(csv.trim().split('\n')[0].split(',')[0]).toBe('id');
        expect(csv).toContain('"Title, with ""quotes"""');
      });

      it('THEN there is a header plus three rows', () => {
        expect(csv.trim().split('\n').length).toBe(4);
      });
    });
  });
});

describe('export is for org admins, in json or csv only', () => {
  describe('GIVEN three decisions', () => {
    const h = seeded();

    for (const [who, actor] of [['a plain member', U.bob], ['an outsider', U.outsider]]) {
      describe(`WHEN ${who} exports`, () => {
        let run: () => unknown;
        beforeEach(() => { run = () => h.log.exportDecisions({ actor, format: 'json' }); });

        it('THEN FORBIDDEN 403', () => {
          expectCode(run, 'FORBIDDEN', 403);
        });
      });
    }

    describe('WHEN the org admin exports as xml', () => {
      let run: () => unknown;
      beforeEach(() => { run = () => h.log.exportDecisions({ actor: U.org, format: 'xml' }); });

      it('THEN VALIDATION_ERROR 400', () => {
        expectCode(run, 'VALIDATION_ERROR', 400);
      });
    });
  });
});
