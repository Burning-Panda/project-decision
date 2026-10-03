import { describe, it, expect, beforeEach } from 'bun:test';
import { OwnersService, TeamsService, ProjectsService, partsSetup, expectCode, U } from './support/index';

/** Registers a beforeEach that boots owner acme, a default team with alice (member) and bob (admin). */
function acme() {
  const h = {} as { projects: ProjectsService };
  beforeEach(async () => {
    const { get } = await partsSetup();
    get(OwnersService).create({ identifier: 'acme' });
    const teams = get(TeamsService);
    teams.addMember({ owner: 'acme', user: U.alice, role: 'member', actor: U.org });
    teams.addMember({ owner: 'acme', user: U.bob, role: 'admin', actor: U.org });
    h.projects = get(ProjectsService);
  });
  return h;
}
const input = (over: Record<string, any> = {}) => ({ owner: 'acme', identifier: 'PRJ', title: 'Platform', actor: U.org, ...over });

describe('ProjectsService.create', () => {
  describe('GIVEN owner acme with a default team', () => {
    const h = acme();

    describe('WHEN the org admin creates PRJ', () => {
      let project: any;
      beforeEach(() => { project = h.projects.create(input()); });

      it('THEN it is stored and readable', () => {
        expect(project.identifier).toBe('PRJ');
        expect(h.projects.get('PRJ')).toEqual(project);
      });
    });

    describe('WHEN a team admin (not the org) creates a project', () => {
      it('THEN it is allowed', () => {
        expect(h.projects.create(input({ actor: U.bob })).identifier).toBe('PRJ');
      });
    });

    describe('WHEN a plain member creates a project', () => {
      it('THEN FORBIDDEN 403', () => {
        expectCode(() => h.projects.create(input({ actor: U.alice })), 'FORBIDDEN', 403);
      });
    });

    describe('WHEN the identifier is invalid', () => {
      it('THEN VALIDATION_ERROR 400 (rules live in Project.create)', () => {
        expectCode(() => h.projects.create(input({ identifier: '1x' })), 'VALIDATION_ERROR', 400);
      });
    });

    describe('WHEN the team does not exist', () => {
      it('THEN NOT_FOUND 404', () => {
        expectCode(() => h.projects.create(input({ team: 'nope' })), 'NOT_FOUND', 404);
      });
    });
  });

  describe('GIVEN project PRJ exists', () => {
    const h = acme();
    beforeEach(() => { h.projects.create(input()); });

    describe('WHEN PRJ is created again', () => {
      it('THEN CONFLICT 409', () => {
        expectCode(() => h.projects.create(input({ title: 'dup' })), 'CONFLICT', 409);
      });
    });
  });
});

describe('ProjectsService.get', () => {
  describe('GIVEN no projects', () => {
    const h = acme();

    describe('WHEN PRJ is fetched', () => {
      it('THEN NOT_FOUND 404', () => {
        expectCode(() => h.projects.get('PRJ'), 'NOT_FOUND', 404);
      });
    });
  });
});

describe('ProjectsService.updateSettings', () => {
  describe('GIVEN project PRJ in single_approval', () => {
    const h = acme();
    beforeEach(() => { h.projects.create(input()); });

    describe('WHEN the org admin switches it to consensus_voting', () => {
      let project: any;
      beforeEach(() => { project = h.projects.updateSettings('PRJ', U.org, { approval_settings: { mode: 'consensus_voting' } }); });

      it('THEN the new mode is stored and voting is enabled', () => {
        expect(h.projects.get('PRJ').approval_settings.mode).toBe('consensus_voting');
        expect(project.approval_settings.enabled_voting).toBe(true);
      });
    });

    describe('WHEN a plain member changes settings', () => {
      it('THEN FORBIDDEN 403', () => {
        expectCode(() => h.projects.updateSettings('PRJ', U.alice, { approval_settings: { allow_abstain: false } }), 'FORBIDDEN', 403);
      });
    });

    describe('WHEN the settings are invalid', () => {
      it('THEN VALIDATION_ERROR and the stored settings are unchanged', () => {
        expectCode(() => h.projects.updateSettings('PRJ', U.org, { approval_settings: { mode: 'bogus' as any } }), 'VALIDATION_ERROR', 400);
        expect(h.projects.get('PRJ').approval_settings.mode).toBe('single_approval');
      });
    });
  });
});
