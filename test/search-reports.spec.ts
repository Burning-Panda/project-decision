import { describe, it, expect } from 'bun:test';
import { setup, draft, act, expectCode, U } from './support/index';

async function seed() {
  const ctx = await setup({ mode: 'consensus_voting' });
  const { log, clock } = ctx;
  log.createProject({ owner: 'acme', identifier: 'WEB', title: 'Web', actor: U.org });
  const a = draft(log, { title: 'Migrate to PostgreSQL', content: 'Move the primary database to Postgres.' });
  clock.advanceDays(1);
  const b = draft(log, { actor: U.bob, title: 'API rate limiting strategy', content: 'Token bucket per customer.' });
  clock.advanceDays(1);
  const c = draft(log, { project: 'WEB', title: 'Frontend framework', content: 'Adopt a component framework.' });
  return { ...ctx, a: a.id as string, b: b.id as string, c: c.id as string };
}

describe('listDecisions filters, sorts and paginates', () => {
  const ids = (r: any) => r.items.map((d: any) => d.id);

  describe('GIVEN three decisions', () => {
    describe('WHEN alice lists all', () => {
      it('THEN the total is 3', async () => {
        const { log } = await seed();
        expect(log.listDecisions({ actor: U.alice }).total).toBe(3);
      });
    });
  });

  describe('GIVEN decisions in PRJ', () => {
    describe('WHEN filtered by project', () => {
      it('THEN newest first by default', async () => {
        const { log, a, b } = await seed();
        expect(ids(log.listDecisions({ actor: U.alice, project: 'PRJ' }))).toEqual([b, a]);
      });
    });
  });

  describe('GIVEN one proposed decision', () => {
    describe('WHEN filtered by status proposed', () => {
      it('THEN only it returns', async () => {
        const { log, a } = await seed();
        act(log, a, U.alice, 'propose');
        expect(ids(log.listDecisions({ actor: U.alice, status: 'proposed' }))).toEqual([a]);
      });
    });
  });

  describe('GIVEN three decisions', () => {
    describe('WHEN sorted +created_at', () => {
      it('THEN oldest first', async () => {
        const { log, a, b, c } = await seed();
        expect(ids(log.listDecisions({ actor: U.alice, sort: '+created_at' }))).toEqual([a, b, c]);
      });
    });
    describe('WHEN filtered by team with limit 1 offset 1 sorted +created_at', () => {
      it('THEN the second one returns', async () => {
        const { log, b } = await seed();
        expect(ids(log.listDecisions({ actor: U.alice, team: 'default', sort: '+created_at', limit: 1, offset: 1 }))).toEqual([b]);
      });
    });
  });

  describe('GIVEN a limit of 500', () => {
    describe('WHEN listing', () => {
      it('THEN the page size is capped at 100', async () => {
        const { log } = await seed();
        expect(log.listDecisions({ actor: U.alice, limit: 500 }).limit).toBe(100);
      });
    });
  });

  describe('GIVEN no limit', () => {
    describe('WHEN listing', () => {
      it('THEN the page size defaults to 25', async () => {
        const { log } = await seed();
        expect(log.listDecisions({ actor: U.alice }).limit).toBe(25);
      });
    });
  });

  describe('GIVEN three decisions', () => {
    describe('WHEN an outsider lists', () => {
      it('THEN the total is 0', async () => {
        const { log } = await seed();
        expect(log.listDecisions({ actor: U.outsider }).total).toBe(0);
      });
    });
  });
});

describe('search finds content, ids, comments and transcripts, honouring access', () => {
  async function searchable() {
    const ctx = await seed();
    const { log, a, b } = ctx;
    log.addComment(b, U.carol, { content: 'What about sliding windows?' });
    act(log, a, U.alice, 'propose');
    act(log, a, U.bob, 'add_meeting', { segments: [{ start_seconds: 0, speaker: 'Bob', text: 'We discussed pgbouncer pooling' }] });
    return { ...ctx, ids: (q: string) => log.search({ actor: U.alice, q }).items.map((r: any) => r.decision_id) };
  }

  describe('GIVEN a decision about Postgres', () => {
    describe('WHEN searching "postgres"', () => {
      it('THEN it is found by content/title', async () => {
        const { ids, a } = await searchable();
        expect(ids('postgres')).toEqual([a]);
      });
    });
  });

  describe('GIVEN decision PRJ-002', () => {
    describe('WHEN searching its id', () => {
      it('THEN the exact match ranks first, ahead of fuzzy id matches', async () => {
        const { ids, b } = await searchable();
        expect(ids('PRJ-002')[0]).toBe(b);
      });
    });
  });

  describe('GIVEN a comment about sliding windows', () => {
    describe('WHEN searching "sliding"', () => {
      it('THEN the commented decision is found', async () => {
        const { ids, b } = await searchable();
        expect(ids('sliding')).toEqual([b]);
      });
    });
  });

  describe('GIVEN a meeting transcript mentioning pgbouncer', () => {
    describe('WHEN searching "pgbouncer"', () => {
      it('THEN the decision is found', async () => {
        const { ids, a } = await searchable();
        expect(ids('pgbouncer')).toEqual([a]);
      });
    });
  });

  describe('GIVEN a transcript match', () => {
    describe('WHEN the result is read', () => {
      it('THEN matched_in includes transcript', async () => {
        const { log } = await searchable();
        expect(log.search({ actor: U.alice, q: 'pgbouncer' }).items[0].matched_in.includes('transcript')).toBe(true);
      });
    });
  });

  describe('GIVEN a decision about Postgres', () => {
    describe('WHEN searching the misspelling "postgress"', () => {
      it('THEN fuzzy matching finds it', async () => {
        const { ids, a } = await searchable();
        expect(ids('postgress')).toEqual([a]);
      });
    });
  });

  describe('GIVEN no decision matches', () => {
    describe('WHEN searching gibberish', () => {
      it('THEN nothing is returned', async () => {
        const { ids } = await searchable();
        expect(ids('zzzzzz')).toEqual([]);
      });
    });
  });

  describe('GIVEN matching decisions', () => {
    describe('WHEN an outsider searches', () => {
      it('THEN nothing is returned', async () => {
        const { log } = await searchable();
        expect(log.search({ actor: U.outsider, q: 'postgres' }).items).toEqual([]);
      });
    });
  });
});

describe('search filters by status, owner, project, approver and date range', () => {
  const idsOf = (log: any) => (f: Record<string, unknown>) =>
    log.search({ actor: U.alice, q: '', ...f }).items.map((r: any) => r.decision_id).sort();

  async function approvedFirst() {
    const ctx = await seed();
    const { log, a } = ctx;
    act(log, a, U.alice, 'propose');
    for (const u of [U.bob, U.carol, U.david]) act(log, a, u, 'vote', { vote: 'approve' });
    return { ...ctx, ids: idsOf(log) };
  }

  describe('GIVEN decisions by alice and bob', () => {
    describe('WHEN filtered by owner bob', () => {
      it('THEN only his return', async () => {
        const ctx = await seed();
        expect(idsOf(ctx.log)({ owner: U.bob })).toEqual([ctx.b]);
      });
    });
  });

  describe('GIVEN decisions in PRJ and WEB', () => {
    describe('WHEN filtered by project WEB', () => {
      it('THEN only the WEB decision returns', async () => {
        const ctx = await seed();
        expect(idsOf(ctx.log)({ project: 'WEB' })).toEqual([ctx.c]);
      });
    });
  });

  describe('GIVEN one approved decision', () => {
    describe('WHEN filtered by status approved', () => {
      it('THEN only it returns', async () => {
        const { ids, a } = await approvedFirst();
        expect(ids({ status: 'approved' })).toEqual([a]);
      });
    });
  });

  describe('GIVEN carol approved', () => {
    describe('WHEN filtered by approver carol', () => {
      it('THEN the approved decision returns', async () => {
        const { ids, a } = await approvedFirst();
        expect(ids({ approver: U.carol })).toEqual([a]);
      });
    });
  });

  describe('GIVEN the lead approved nothing', () => {
    describe('WHEN filtered by approver lead', () => {
      it('THEN none return', async () => {
        const { ids } = await approvedFirst();
        expect(ids({ approver: U.lead })).toEqual([]);
      });
    });
  });

  describe('GIVEN decisions created on three consecutive days', () => {
    describe('WHEN filtered to 2024-03-21', () => {
      it('THEN only that day\'s decision returns', async () => {
        const ctx = await seed();
        expect(idsOf(ctx.log)({ from: '2024-03-21', to: '2024-03-21' })).toEqual([ctx.b]);
      });
    });
  });
});

describe('dashboard answers the four participation questions', () => {
  async function busy() {
    const ctx = await seed();
    const { log, a, b, c } = ctx;
    act(log, a, U.alice, 'propose');
    act(log, b, U.bob, 'propose');
    act(log, a, U.carol, 'vote', { vote: 'approve' });
    log.addComment(c, U.david, { content: 'thoughts' });
    return ctx;
  }

  describe('GIVEN bob owns a proposed decision', () => {
    describe('WHEN his dashboard is read', () => {
      it('THEN owned lists it', async () => {
        const { log, b } = await busy();
        expect(log.dashboard(U.bob).owned.map((d: any) => d.id)).toEqual([b]);
      });
    });
  });

  describe('GIVEN alice\'s proposal is open', () => {
    describe('WHEN bob\'s dashboard is read', () => {
      it('THEN it awaits his approval', async () => {
        const { log, a } = await busy();
        expect(log.dashboard(U.bob).awaiting_my_approval.map((d: any) => d.id)).toEqual([a]);
      });
    });
  });

  describe('GIVEN carol already voted on alice\'s proposal', () => {
    describe('WHEN carol\'s dashboard is read', () => {
      it('THEN only bob\'s proposal awaits her', async () => {
        const { log, b } = await busy();
        expect(log.dashboard(U.carol).awaiting_my_approval.map((d: any) => d.id)).toEqual([b]);
      });
    });
  });

  describe('GIVEN david commented on the WEB decision', () => {
    describe('WHEN his dashboard is read', () => {
      it('THEN contributed lists it', async () => {
        const { log, c } = await busy();
        expect(log.dashboard(U.david).contributed.map((d: any) => d.id)).toEqual([c]);
      });
    });
  });

  describe('GIVEN three decisions in alice\'s projects', () => {
    describe('WHEN her dashboard is read', () => {
      it('THEN in_my_projects has 3', async () => {
        const { log } = await busy();
        expect(log.dashboard(U.alice).in_my_projects.length).toBe(3);
      });
    });
  });
});

describe('reports: volume, approval metrics, revision cycles, participation, todos', () => {
  async function activity() {
    const ctx = await seed();
    const { log, clock, a, b } = ctx;
    act(log, a, U.alice, 'propose');
    clock.advanceHours(10);
    for (const u of [U.bob, U.carol, U.david]) act(log, a, u, 'vote', { vote: 'approve' });
    act(log, b, U.bob, 'propose');
    act(log, b, U.lead, 'request_revision', { reason: 'more detail' });
    act(log, a, U.alice, 'assign_followup', { title: 't', assigned_to: U.bob, due_date: '2024-09-01' });
    return ctx;
  }

  describe('GIVEN three decisions in March', () => {
    describe('WHEN decision_volume runs', () => {
      it('THEN by_month and by_team count them', async () => {
        const { log } = await activity();
        const vol = log.report('decision_volume', { actor: U.org });
        expect(vol.by_month['2024-03']).toBe(3);
        expect(vol.by_team.default).toBe(3);
      });
    });
  });

  describe('GIVEN one decision approved after 10 hours', () => {
    describe('WHEN approval_metrics runs', () => {
      it('THEN counts, rate and average hours match', async () => {
        const { log } = await activity();
        const m = log.report('approval_metrics', { actor: U.org });
        expect(m.approved).toBe(1);
        expect(m.declined).toBe(0);
        expect(m.approval_rate).toBe(1);
        expect(m.avg_hours_to_approval).toBe(10);
      });
    });
  });

  describe('GIVEN one of two proposals needed a revision', () => {
    describe('WHEN revision_cycles runs', () => {
      it('THEN the per-decision count and average match', async () => {
        const { log, b } = await activity();
        const r = log.report('revision_cycles', { actor: U.org });
        expect(r.by_decision[b]).toBe(1);
        expect(r.average).toBe(0.5);
      });
    });
  });

  describe('GIVEN bob voted', () => {
    describe('WHEN participation runs', () => {
      it('THEN bob appears among voters with a count of 1', async () => {
        const { log } = await activity();
        const p = log.report('participation', { actor: U.org });
        expect(p.voters.find((v: any) => v.user === U.bob).count).toBe(1);
      });
    });
  });

  describe('GIVEN one follow-up', () => {
    describe('WHEN todo_completion runs', () => {
      it('THEN the total is 1', async () => {
        const { log } = await activity();
        expect(log.report('todo_completion', { actor: U.org }).total).toBe(1);
      });
    });
  });

  describe('GIVEN activity during March', () => {
    describe('WHEN the audit report runs for March', () => {
      it('THEN it includes the three votes and the revision request', async () => {
        const { log } = await activity();
        const au = log.report('audit', { actor: U.org, from: '2024-03-01', to: '2024-03-31' });
        const actions = au.entries.map((e: any) => e.action);
        expect(actions.filter((a: string) => a === 'vote').length).toBe(3);
        expect(actions).toContain('request_revision');
      });
    });
    describe('WHEN the audit report runs for April', () => {
      it('THEN it is empty', async () => {
        const { log } = await activity();
        expect(log.report('audit', { actor: U.org, from: '2024-04-01', to: '2024-04-30' }).entries).toEqual([]);
      });
    });
  });

  describe('GIVEN an org admin', () => {
    describe('WHEN an unknown report is requested', () => {
      it('THEN VALIDATION_ERROR 400', async () => {
        const { log } = await activity();
        expectCode(() => log.report('nonsense', { actor: U.org }), 'VALIDATION_ERROR', 400);
      });
    });
  });

  describe('GIVEN a plain member', () => {
    describe('WHEN the audit report is requested', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await activity();
        expectCode(() => log.report('audit', { actor: U.bob }), 'FORBIDDEN', 403);
      });
    });
  });
});

describe('export as JSON includes votes; CSV escapes properly', () => {
  async function titled() {
    const ctx = await seed();
    ctx.log.updateDraft(ctx.a, U.alice, { title: 'Title, with "quotes"' });
    return ctx;
  }

  describe('GIVEN three decisions', () => {
    describe('WHEN exported as JSON', () => {
      it('THEN three rows include votes and content', async () => {
        const { log } = await titled();
        const json = log.exportDecisions({ actor: U.org, format: 'json' });
        expect(json.length).toBe(3);
        expect('votes' in json[0] && 'content' in json[0]).toBe(true);
      });
    });
  });

  describe('GIVEN a title with comma and quotes', () => {
    describe('WHEN exported as CSV', () => {
      it('THEN it starts with an id column and the title is escaped', async () => {
        const { log } = await titled();
        const csv = log.exportDecisions({ actor: U.org, format: 'csv' });
        expect(csv.trim().split('\n')[0].split(',')[0]).toBe('id');
        expect(csv.includes('"Title, with ""quotes"""')).toBe(true);
      });
    });
  });

  describe('GIVEN three decisions', () => {
    describe('WHEN exported as CSV', () => {
      it('THEN there is a header plus three rows', async () => {
        const { log } = await titled();
        expect(log.exportDecisions({ actor: U.org, format: 'csv' }).trim().split('\n').length).toBe(4);
      });
    });
  });
});
