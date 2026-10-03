import { describe, it, expect, beforeEach } from 'bun:test';
import { Project, expectCode } from './support/index';

// Project is pure domain: no store, clock or audit. Everything it needs is passed in.
const NOW = '2024-03-20T10:00:00.000Z';
const input = (over: Record<string, any> = {}) => ({ owner: 'acme', identifier: 'PRJ', title: 'Platform', ...over });

describe('Project.create builds a valid record', () => {
  describe('GIVEN owner, identifier and title only', () => {
    describe('WHEN the project is created', () => {
      let project: any;
      beforeEach(() => { project = Project.create(input(), NOW); });

      it('THEN it is active, empty, in team default and stamped with the given time', () => {
        expect(project).toMatchObject({
          owner: 'acme', team: 'default', identifier: 'PRJ', title: 'Platform', description: '',
          active: true, decision_count: 0, last_number: 0, created_at: NOW, updated_at: NOW,
        });
      });
      it('THEN approval uses single_approval with voting disabled', () => {
        expect(project.approval_settings.mode).toBe('single_approval');
        expect(project.approval_settings.enabled_voting).toBe(false);
      });
    });
  });

  describe('GIVEN consensus_voting settings', () => {
    describe('WHEN the project is created', () => {
      let project: any;
      beforeEach(() => { project = Project.create(input({ settings: { approval_settings: { mode: 'consensus_voting' } } }), NOW); });

      it('THEN voting is enabled and unspecified settings keep their defaults', () => {
        expect(project.approval_settings.enabled_voting).toBe(true);
        expect(project.approval_settings.consensus_min_votes).toBe(3);
      });
    });
  });
});

describe('Project.create rejects invalid input', () => {
  const cases: Array<[string, Record<string, any>]> = [
    ['an empty identifier', { identifier: '' }],
    ['an identifier starting with a digit', { identifier: '1PRJ' }],
    ['an identifier with a dash', { identifier: 'A-B' }],
    ['an empty title', { title: '' }],
    ['an unknown mode', { settings: { approval_settings: { mode: 'bogus' } } }],
    ['a quorum_percentage above 100', { settings: { approval_settings: { quorum_percentage: 101 } } }],
  ];
  for (const [name, over] of cases) {
    describe(`GIVEN ${name}`, () => {
      describe('WHEN the project is created', () => {
        it('THEN VALIDATION_ERROR 400', () => {
          expectCode(() => Project.create(input(over), NOW), 'VALIDATION_ERROR', 400);
        });
      });
    });
  }
});

describe('Project.resolveSettings merges a patch over current settings', () => {
  describe('GIVEN current settings in consensus_voting', () => {
    let current: any;
    beforeEach(() => { current = Project.create(input({ settings: { approval_settings: { mode: 'consensus_voting' } } }), NOW).approval_settings; });

    describe('WHEN only allow_abstain is patched', () => {
      let next: any;
      beforeEach(() => { next = Project.resolveSettings({ allow_abstain: false }, current); });

      it('THEN allow_abstain changes and the mode is kept', () => {
        expect(next.allow_abstain).toBe(false);
        expect(next.mode).toBe('consensus_voting');
      });
      it('THEN the current settings object is not mutated', () => {
        expect(current.allow_abstain).toBe(true);
      });
    });

    describe('WHEN the mode is patched to single_approval', () => {
      it('THEN voting is disabled', () => {
        expect(Project.resolveSettings({ mode: 'single_approval' }, current).enabled_voting).toBe(false);
      });
    });

    describe('WHEN vote_weights names an unknown role', () => {
      it('THEN VALIDATION_ERROR', () => {
        expectCode(() => Project.resolveSettings({ vote_weights: { wizard: 2 } }, current), 'VALIDATION_ERROR', 400);
      });
    });
  });
});
