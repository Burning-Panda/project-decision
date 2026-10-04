import { describe, it, expect, beforeEach } from 'bun:test';
import { authorize, PERMISSIONS, type AccessRequest } from '../support/index';

// authorize is pure: the facts arrive in the request, nothing is loaded. Default deny; an explicit prohibition beats any grant.
const ALICE = 'alice@acme.com';
const BOB = 'bob@acme.com';

/** A request by bob, a member of the decision's team, on a decision alice owns. */
const request = (over: { subject?: Partial<AccessRequest['subject']>; action?: AccessRequest['action']; resource?: AccessRequest['resource'] } = {}): AccessRequest => ({
  subject: { id: BOB, role: 'member', orgAdmin: false, ...over.subject },
  action: over.action ?? 'decision:read',
  resource: over.resource ?? { owner: ALICE },
});

const ALLOW: unknown = { allow: true };
/** authorize, typed loosely so specs can compare against plain literals. */
const decide = (r: AccessRequest): unknown => authorize(r);
const deny = (reason: string) => ({ allow: false, reason });

describe('authorize: someone outside the team is refused everything', () => {
  for (const action of [...PERMISSIONS, 'decision:propose', 'decision:edit_draft', 'decision:return_to_draft'] as const) {
    describe(`GIVEN a person with no role in the team and no org admin rights`, () => {
      describe(`WHEN they ask for ${action}`, () => {
        let verdict: unknown;
        beforeEach(() => { verdict = authorize(request({ subject: { id: 'eve@other.com', role: null }, action })); });

        it('THEN the reason is not_a_member', () => {
          expect(verdict).toEqual(deny('not_a_member'));
        });
      });
    });
  }
});

describe('authorize: a role grants what the permission table says', () => {
  const cases: Array<[string, AccessRequest['subject']['role'], AccessRequest['action'], unknown]> = [
    ['a member may read', 'member', 'decision:read', ALLOW],
    ['a member may create decisions', 'member', 'decision:create', ALLOW],
    ['a member may vote on a colleague\'s decision', 'member', 'decision:vote', ALLOW],
    ['a member may not approve', 'member', 'decision:approve', deny('missing_permission')],
    ['a member may not decline', 'member', 'decision:decline', deny('missing_permission')],
    ['a member may not manage members', 'member', 'team:manage_members', deny('missing_permission')],
    ['a lead may approve a colleague\'s decision', 'lead', 'decision:approve', ALLOW],
    ['a lead may decline a colleague\'s decision', 'lead', 'decision:decline', ALLOW],
    ['a lead may not manage members', 'lead', 'team:manage_members', deny('missing_permission')],
    ['a team admin may manage members', 'admin', 'team:manage_members', ALLOW],
    ['a team admin may approve a colleague\'s decision', 'admin', 'decision:approve', ALLOW],
  ];

  for (const [name, role, action, expected] of cases) {
    describe(`GIVEN bob with the role ${role}`, () => {
      describe(`WHEN ${name}`, () => {
        let verdict: unknown;
        beforeEach(() => { verdict = authorize(request({ subject: { role }, action })); });

        it('THEN the verdict matches', () => {
          expect(verdict).toEqual(expected);
        });
      });
    });
  }
});

describe('authorize: the org admin needs no role', () => {
  // decision:vote is left out on purpose: voting is for people with a role in the team (see the brief).
  for (const action of [...PERMISSIONS.filter((p) => p !== 'decision:vote'), 'decision:propose'] as const) {
    describe('GIVEN the org admin, who has no role in the team', () => {
      describe(`WHEN they ask for ${action} on alice's decision`, () => {
        let verdict: unknown;
        beforeEach(() => { verdict = authorize(request({ subject: { id: 'acme', role: null, orgAdmin: true }, action })); });

        it(action === 'decision:propose' ? 'THEN not_owner: org admin does not override owner-only actions' : 'THEN allowed', () => {
          expect(verdict).toEqual(action === 'decision:propose' ? deny('not_owner') : ALLOW);
        });
      });
    });
  }
});

describe('authorize: nobody approves, declines or votes on their own decision (deny beats grant)', () => {
  const owners: Array<[string, Partial<AccessRequest['subject']>]> = [
    ['a lead', { role: 'lead' }],
    ['a team admin', { role: 'admin' }],
    ['the org admin', { role: null, orgAdmin: true }],
    ['a plain member', { role: 'member' }],
  ];
  const actions = ['decision:approve', 'decision:decline', 'decision:vote'] as const;

  for (const [who, subject] of owners) {
    for (const action of actions) {
      describe(`GIVEN ${who} who owns the decision`, () => {
        describe(`WHEN they ask for ${action}`, () => {
          let verdict: unknown;
          beforeEach(() => { verdict = authorize(request({ subject: { id: ALICE, ...subject }, action, resource: { owner: ALICE } })); });

          it('THEN own_decision, even where a plain member would only lack the permission', () => {
            expect(verdict).toEqual(deny('own_decision'));
          });
        });
      });
    }
  }

  describe('GIVEN an owner asking to read their own decision', () => {
    describe('WHEN the action is decision:read', () => {
      it('THEN allowed: the prohibition only covers deciding on your own work', () => {
        expect(decide(request({ subject: { id: ALICE }, action: 'decision:read', resource: { owner: ALICE } }))).toEqual(ALLOW);
      });
    });
  });
});

describe('authorize: propose, edit and return to draft belong to the owner alone', () => {
  const actions = ['decision:propose', 'decision:edit_draft', 'decision:return_to_draft'] as const;

  for (const action of actions) {
    describe('GIVEN alice, a member who owns the decision', () => {
      describe(`WHEN she asks for ${action}`, () => {
        it('THEN allowed', () => {
          expect(decide(request({ subject: { id: ALICE }, action }))).toEqual(ALLOW);
        });
      });
    });

    describe('GIVEN a lead who does not own the decision', () => {
      describe(`WHEN they ask for ${action}`, () => {
        it('THEN not_owner: a higher role does not unlock it', () => {
          expect(decide(request({ subject: { id: 'lead@acme.com', role: 'lead' }, action }))).toEqual(deny('not_owner'));
        });
      });
    });
  }
});

describe('authorize does not touch what it was given', () => {
  describe('GIVEN a deeply frozen request', () => {
    describe('WHEN it is authorized twice', () => {
      let first: unknown;
      let second: unknown;
      beforeEach(() => {
        const frozen = request({ subject: { role: 'lead' }, action: 'decision:approve' });
        Object.freeze(frozen); Object.freeze(frozen.subject); Object.freeze(frozen.resource);
        first = authorize(frozen);
        second = authorize(frozen);
      });

      it('THEN nothing throws, and the same facts give the same answer', () => {
        expect(first).toEqual(ALLOW);
        expect(second).toEqual(first);
      });
    });
  });
});
