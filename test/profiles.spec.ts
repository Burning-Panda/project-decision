import { describe, it, expect } from 'bun:test';
import { setup, expectCode, SUBSCRIPTION, U } from './support/index';

describe('profiles default sensibly: email derives from the user id, email is the only channel on', () => {
  describe('GIVEN bob without a stored profile', () => {
    describe('WHEN he reads it', () => {
      it('THEN email derives from his id and email is the only enabled channel', async () => {
        const { log } = await setup();
        const p = log.getProfile(U.bob, U.bob);
        expect(p.email).toBe(U.bob);
        expect(p.phone).toBe(null);
        expect(p.push_subscriptions).toEqual([]);
        expect(p.preferences).toEqual({ channels: { email: true, sms: false, push: false }, muted_types: [] });
      });
    });
  });

  describe('GIVEN a member whose id is not an address', () => {
    describe('WHEN the org reads the profile', () => {
      it('THEN email is null', async () => {
        const { log } = await setup();
        log.addTeamMember({ owner: 'acme', user: 'acme-bot', actor: 'acme' });
        expect(log.getProfile('acme-bot', 'acme').email).toBe(null);
      });
    });
  });
});

describe('profile updates merge, validate and respect permissions', () => {
  describe('GIVEN bob', () => {
    describe('WHEN he sets a phone, enables sms and mutes vote_received', () => {
      it('THEN the profile reflects it', async () => {
        const { log } = await setup();
        const p = log.setProfile(U.bob, U.bob, { phone: '+14155550123', preferences: { channels: { sms: true }, muted_types: ['vote_received'] } });
        expect(p.phone).toBe('+14155550123');
        expect(p.preferences.channels).toEqual({ email: true, sms: true, push: false });
      });
    });
  });

  describe('GIVEN a stored phone', () => {
    describe('WHEN bob later adds a push subscription and enables push', () => {
      it('THEN earlier fields are kept and new ones merged', async () => {
        const { log } = await setup();
        log.setProfile(U.bob, U.bob, { phone: '+14155550123', preferences: { channels: { sms: true }, muted_types: ['vote_received'] } });
        const again = log.setProfile(U.bob, U.bob, { push_subscriptions: [SUBSCRIPTION], preferences: { channels: { push: true } } });
        expect(again.phone).toBe('+14155550123');
        expect(again.push_subscriptions).toEqual([SUBSCRIPTION]);
        expect(again.preferences.muted_types).toEqual(['vote_received']);
        expect(again.preferences.channels).toEqual({ email: true, sms: true, push: true });
      });
    });
  });

  const invalid: Array<[string, Record<string, unknown>]> = [
    ['a malformed email', { email: 'not-an-email' }],
    ['an email with an injected header', { email: 'a@b.co\r\nBcc: evil@x.io' }],
    ['a non-E.164 phone', { phone: '555-1234' }],
    ['push_subscriptions that is not a list', { push_subscriptions: 'abc' }],
    ['more than ten push subscriptions', { push_subscriptions: Array(11).fill(SUBSCRIPTION) }],
    ['a push subscription without keys', { push_subscriptions: [{ endpoint: SUBSCRIPTION.endpoint }] }],
    ['a push subscription with a non-https endpoint', { push_subscriptions: [{ ...SUBSCRIPTION, endpoint: 'http://push.example.com/x' }] }],
    ['an unknown channel', { preferences: { channels: { fax: true } } }],
    ['a non-boolean channel flag', { preferences: { channels: { sms: 'yes' } } }],
    ['muted_types that is not a list', { preferences: { muted_types: 'all' } }],
  ];
  for (const [label, input] of invalid) {
    describe(`GIVEN bob`, () => {
      describe(`WHEN he saves a profile with ${label}`, () => {
        it(`THEN VALIDATION_ERROR 400`, async () => {
          const { log } = await setup();
          expectCode(() => log.setProfile(U.bob, U.bob, input), 'VALIDATION_ERROR', 400);
        });
      });
    });
  }

  describe('GIVEN bob\'s profile', () => {
    describe('WHEN carol reads it', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup();
        expectCode(() => log.getProfile(U.bob, U.carol), 'FORBIDDEN', 403);
      });
    });
    describe('WHEN carol edits it', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup();
        expectCode(() => log.setProfile(U.bob, U.carol, { phone: '+14155550123' }), 'FORBIDDEN', 403);
      });
    });
    describe('WHEN the org admin edits his email', () => {
      it('THEN the change is applied', async () => {
        const { log } = await setup();
        expect(log.setProfile(U.bob, U.org, { email: 'bob@personal.example' }).email).toBe('bob@personal.example');
      });
    });
  });

  describe('GIVEN a stored phone', () => {
    describe('WHEN bob sets phone to null', () => {
      it('THEN it is cleared', async () => {
        const { log } = await setup();
        log.setProfile(U.bob, U.bob, { phone: '+14155550123' });
        expect(log.setProfile(U.bob, U.bob, { phone: null }).phone).toBe(null);
      });
    });
  });
});

