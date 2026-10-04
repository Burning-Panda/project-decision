import { describe, it, expect, beforeEach } from 'bun:test';
import {
  AccessService, OwnersService, TeamsService, partsSetup, freshLog, proposedIn, draft, act, attempt, expectCode, U,
} from '../support/index';

const REASON = 'Too risky without rollback plan';

describe('AccessService.check loads the facts from the team and asks the policy', () => {
  /** Owner acme, default team with bob (member), lead and carol (admin). */
  function team() {
    const h = {} as { access: AccessService; team: any };
    beforeEach(async () => {
      const { get } = await partsSetup();
      get(OwnersService).create({ identifier: 'acme' });
      const teams = get(TeamsService);
      teams.addMember({ owner: 'acme', user: U.bob, role: 'member', actor: U.org });
      teams.addMember({ owner: 'acme', user: U.lead, role: 'lead', actor: U.org });
      teams.addMember({ owner: 'acme', user: U.carol, role: 'admin', actor: U.org });
      h.access = get(AccessService);
      h.team = teams.get('acme', 'default');
    });
    return h;
  }

  const cases: Array<[string, string, Parameters<AccessService['check']>[2], unknown]> = [
    ['the lead approves alice\'s decision', U.lead, 'decision:approve', { allow: true }],
    ['bob, a member, approves it', U.bob, 'decision:approve', { allow: false, reason: 'missing_permission' }],
    ['the org admin approves it', U.org, 'decision:approve', { allow: true }],
    ['an outsider approves it', U.outsider, 'decision:approve', { allow: false, reason: 'not_a_member' }],
    ['a team admin manages members', U.carol, 'team:manage_members', { allow: true }],
    ['the lead manages members', U.lead, 'team:manage_members', { allow: false, reason: 'missing_permission' }],
    ['the org admin manages members', U.org, 'team:manage_members', { allow: true }],
  ];

  for (const [name, actor, action, expected] of cases) {
    describe('GIVEN a team with a member, a lead and a team admin', () => {
      const h = team();

      describe(`WHEN ${name}`, () => {
        let verdict: unknown;
        beforeEach(() => { verdict = h.access.check(actor, h.team, action, U.alice); });

        it('THEN the verdict matches', () => {
          expect(verdict).toEqual(expected);
        });
      });
    });
  }
});

describe('DecisionLog.can answers the question without doing anything', () => {
  describe('GIVEN a decision proposed by alice', () => {
    const h = proposedIn();

    describe('WHEN each person is asked whether they may approve it', () => {
      it('THEN the lead may', () => {
        expect(h.log.can(h.id, U.lead, 'decision:approve')).toEqual({ allow: true });
      });
      it('THEN alice may not: it is her own decision', () => {
        expect(h.log.can(h.id, U.alice, 'decision:approve')).toEqual({ allow: false, reason: 'own_decision' });
      });
      it('THEN bob may not: members lack the permission', () => {
        expect(h.log.can(h.id, U.bob, 'decision:approve')).toEqual({ allow: false, reason: 'missing_permission' });
      });
      it('THEN an outsider may not, and learns only that they are not a member', () => {
        expect(h.log.can(h.id, U.outsider, 'decision:approve')).toEqual({ allow: false, reason: 'not_a_member' });
      });
    });

    describe('WHEN the question is asked', () => {
      let auditBefore: number;
      let before: unknown;
      beforeEach(() => {
        auditBefore = h.log.auditTrail().length;
        before = structuredClone(h.log.getDecision(h.id, U.org));
        h.log.can(h.id, U.lead, 'decision:approve');
      });

      it('THEN the audit trail and the decision are unchanged', () => {
        expect(h.log.auditTrail().length).toBe(auditBefore);
        expect(h.log.getDecision(h.id, U.org)).toEqual(before);
      });
    });

    describe('WHEN the decision does not exist', () => {
      it('THEN NOT_FOUND 404', () => {
        expectCode(() => h.log.can('PRJ-999', U.lead, 'decision:approve'), 'NOT_FOUND', 404);
      });
    });
  });
});

describe('can and perform give the same answer (the refactor must not change behaviour)', () => {
  const decide: Array<[string, string, 'decision:approve' | 'decision:decline', 'approve' | 'decline']> = [
    ['the lead', U.lead, 'decision:approve', 'approve'],
    ['the org admin', U.org, 'decision:approve', 'approve'],
    ['a member', U.bob, 'decision:approve', 'approve'],
    ['its owner', U.alice, 'decision:approve', 'approve'],
    ['an outsider', U.outsider, 'decision:approve', 'approve'],
    ['the lead', U.lead, 'decision:decline', 'decline'],
    ['a member', U.bob, 'decision:decline', 'decline'],
    ['its owner', U.alice, 'decision:decline', 'decline'],
    ['an outsider', U.outsider, 'decision:decline', 'decline'],
  ];

  for (const [who, actor, permission, verb] of decide) {
    describe('GIVEN a proposed decision', () => {
      const h = proposedIn();

      describe(`WHEN ${who} is asked about, and then tries, to ${verb} it`, () => {
        let verdict: any;
        let error: any;
        beforeEach(() => {
          verdict = h.log.can(h.id, actor, permission);
          error = attempt(() => act(h.log, h.id, actor, verb, verb === 'decline' ? { reason: REASON } : {}));
        });

        it('THEN perform refuses with FORBIDDEN exactly when can says no', () => {
          if (verdict.allow) expect(error).toBeUndefined();
          else expect(error?.code).toBe('FORBIDDEN');
        });
      });
    });
  }

  const owning: Array<[string, string]> = [['alice, its owner', U.alice], ['bob, a member', U.bob], ['the lead', U.lead], ['the org admin', U.org]];
  for (const [who, actor] of owning) {
    describe('GIVEN alice\'s draft', () => {
      const h = freshLog();
      let id: string;
      beforeEach(() => { id = draft(h.log).id; });

      describe(`WHEN ${who} is asked about, and then tries, to propose it`, () => {
        let verdict: any;
        let error: any;
        beforeEach(() => {
          verdict = h.log.can(id, actor, 'decision:propose');
          error = attempt(() => act(h.log, id, actor, 'propose'));
        });

        it('THEN perform refuses with FORBIDDEN exactly when can says no', () => {
          if (verdict.allow) expect(error).toBeUndefined();
          else expect(error?.code).toBe('FORBIDDEN');
        });
      });
    });
  }
});

describe('a refused action says why', () => {
  describe('GIVEN a decision proposed by the lead', () => {
    const h = freshLog();
    let id: string;
    beforeEach(() => { id = draft(h.log, { actor: U.lead }).id; act(h.log, id, U.lead, 'propose'); });

    describe('WHEN the lead approves it', () => {
      let error: any;
      beforeEach(() => { error = attempt(() => act(h.log, id, U.lead, 'approve')); });

      it('THEN FORBIDDEN carries details.reason own_decision', () => {
        expect(error?.code).toBe('FORBIDDEN');
        expect(error?.details).toMatchObject({ reason: 'own_decision' });
      });
    });

    describe('WHEN a member approves it', () => {
      let error: any;
      beforeEach(() => { error = attempt(() => act(h.log, id, U.bob, 'approve')); });

      it('THEN FORBIDDEN carries details.reason missing_permission', () => {
        expect(error?.code).toBe('FORBIDDEN');
        expect(error?.details).toMatchObject({ reason: 'missing_permission' });
      });
    });
  });
});

describe('managing members goes through the same policy', () => {
  describe('GIVEN a default team with bob a member, the lead a lead and carol a team admin', () => {
    const h = freshLog();
    beforeEach(() => { h.log.addTeamMember({ owner: 'acme', team: 'default', user: U.carol, role: 'admin', actor: U.org }); });

    describe('WHEN the lead adds a member', () => {
      let error: any;
      beforeEach(() => { error = attempt(() => h.log.addTeamMember({ owner: 'acme', team: 'default', user: U.david, role: 'member', actor: U.lead })); });

      it('THEN FORBIDDEN with details.reason missing_permission', () => {
        expect(error?.code).toBe('FORBIDDEN');
        expect(error?.details).toMatchObject({ reason: 'missing_permission' });
      });
    });

    describe('WHEN the team admin adds a member', () => {
      let team: any;
      beforeEach(() => { team = h.log.addTeamMember({ owner: 'acme', team: 'default', user: U.outsider, role: 'member', actor: U.carol }); });

      it('THEN the member is added', () => {
        expect(team.members).toContainEqual({ user: U.outsider, role: 'member' });
      });
    });
  });
});
