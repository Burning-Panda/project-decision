import { describe, it, expect, beforeEach } from 'bun:test';
import { OwnersService, TeamsService, partsSetup, expectCode, U } from '../support/index';

/** Registers a beforeEach that boots the parts with owner acme and exposes the teams service. */
function acme() {
  const h = {} as { teams: TeamsService; clock: Awaited<ReturnType<typeof partsSetup>>['clock'] };
  beforeEach(async () => {
    const { get, clock } = await partsSetup();
    get(OwnersService).create({ identifier: 'acme' });
    h.teams = get(TeamsService);
    h.clock = clock;
  });
  return h;
}

describe('TeamsService.create', () => {
  describe('GIVEN owner acme', () => {
    const h = acme();

    describe('WHEN the org admin creates team payments', () => {
      let team: any;
      beforeEach(() => { team = h.teams.create({ owner: 'acme', name: 'payments', actor: U.org }); });

      it('THEN it is an empty team of acme', () => {
        expect(team).toMatchObject({ owner: 'acme', name: 'payments', members: [] });
      });
    });

    describe('WHEN a non-admin creates a team', () => {
      it('THEN FORBIDDEN 403', () => {
        expectCode(() => h.teams.create({ owner: 'acme', name: 'x', actor: U.bob }), 'FORBIDDEN', 403);
      });
    });

    describe('WHEN the name is empty', () => {
      it('THEN VALIDATION_ERROR 400', () => {
        expectCode(() => h.teams.create({ owner: 'acme', name: '', actor: U.org }), 'VALIDATION_ERROR', 400);
      });
    });

    describe('WHEN the team default is created again', () => {
      it('THEN CONFLICT 409', () => {
        expectCode(() => h.teams.create({ owner: 'acme', name: 'default', actor: U.org }), 'CONFLICT', 409);
      });
    });

    describe('WHEN the owner does not exist', () => {
      it('THEN NOT_FOUND 404', () => {
        expectCode(() => h.teams.create({ owner: 'ghost', name: 'x', actor: 'ghost' }), 'NOT_FOUND', 404);
      });
    });
  });
});

describe('TeamsService.addMember', () => {
  describe('GIVEN owner acme with its default team', () => {
    const h = acme();

    describe('WHEN the org admin adds alice without a role', () => {
      let team: any;
      beforeEach(() => { team = h.teams.addMember({ owner: 'acme', user: U.alice, actor: U.org }); });

      it('THEN alice is a member of default', () => {
        expect(team.members).toEqual([{ user: U.alice, role: 'member' }]);
      });
    });

    describe('WHEN alice is added twice with different roles', () => {
      let team: any;
      beforeEach(() => {
        h.teams.addMember({ owner: 'acme', user: U.alice, role: 'member', actor: U.org });
        team = h.teams.addMember({ owner: 'acme', user: U.alice, role: 'lead', actor: U.org });
      });

      it('THEN her role is updated, not duplicated', () => {
        expect(team.members).toEqual([{ user: U.alice, role: 'lead' }]);
      });
    });

    describe('WHEN the role is unknown', () => {
      it('THEN VALIDATION_ERROR 400', () => {
        expectCode(() => h.teams.addMember({ owner: 'acme', user: U.alice, role: 'wizard', actor: U.org }), 'VALIDATION_ERROR', 400);
      });
    });

    describe('WHEN the user is empty', () => {
      it('THEN VALIDATION_ERROR 400', () => {
        expectCode(() => h.teams.addMember({ owner: 'acme', user: '', actor: U.org }), 'VALIDATION_ERROR', 400);
      });
    });

    describe('WHEN a plain member tries to add someone', () => {
      beforeEach(() => { h.teams.addMember({ owner: 'acme', user: U.alice, actor: U.org }); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(() => h.teams.addMember({ owner: 'acme', user: U.bob, actor: U.alice }), 'FORBIDDEN', 403);
      });
    });

    describe('WHEN the team does not exist', () => {
      it('THEN NOT_FOUND 404', () => {
        expectCode(() => h.teams.addMember({ owner: 'acme', team: 'nope', user: U.alice, actor: U.org }), 'NOT_FOUND', 404);
      });
    });
  });
});
