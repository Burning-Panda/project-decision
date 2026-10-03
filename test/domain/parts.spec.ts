import { describe, it, expect, beforeEach } from 'bun:test';
import {
  DecisionLog, OwnersService, TeamsService, ProjectsService, DecisionsService, CommentsService,
  FollowupsService, RelatedService, ProfilesService, WebhooksService, InsightsService, buildLog, buildModule,
} from '../support/index';

// Wiring only: every part is provided by the module and the facade is built from them.
// Behaviour of each part is specified in its own spec (owners, teams, projects, project) and,
// for the rest, through the facade in the feature specs (lifecycle, collaboration, webhooks, ...).
const PARTS: Array<new (...args: any[]) => object> = [
  OwnersService, TeamsService, ProjectsService, DecisionsService, CommentsService,
  FollowupsService, RelatedService, ProfilesService, WebhooksService, InsightsService,
];

describe('the module provides every part', () => {
  for (const part of PARTS) {
    describe(`GIVEN a booted module`, () => {
      let get: Awaited<ReturnType<typeof buildModule>>['get'];
      beforeEach(async () => { ({ get } = await buildModule()); });

      describe(`WHEN ${part.name} is requested`, () => {
        it('THEN an instance is returned', () => {
          expect(get(part)).toBeInstanceOf(part);
        });
      });
    });
  }
});

describe('the facade is built from the module', () => {
  describe('GIVEN a log built with a custom clock', () => {
    let log: any;
    const fixed = () => new Date('2024-03-20T10:00:00Z');
    beforeEach(async () => { log = await buildLog({ clock: fixed }); });

    describe('WHEN the facade is inspected', () => {
      it('THEN it is a DecisionLog exposing its options and clock', () => {
        expect(log).toBeInstanceOf(DecisionLog);
        expect(log.options.clock).toBe(fixed);
        expect(log.clock()).toEqual(fixed());
      });
    });
  });
});
