import { describe, it, expect, beforeEach } from 'bun:test';
import { freshLog, expectCode, SUBSCRIPTION, U } from '../support/index';

// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.
// Actions expected to fail are captured as a thunk in WHEN and invoked by expectCode in THEN.

const PHONE = '+14155550123';
const SMS_AND_MUTE = { phone: PHONE, preferences: { channels: { sms: true }, muted_types: ['vote_received'] } };

describe('profiles default sensibly: email derives from the user id, email is the only channel on', () => {
  describe('GIVEN bob without a stored profile', () => {
    const h = freshLog();

    describe('WHEN he reads it', () => {
      let p: any;
      beforeEach(() => { p = h.log.getProfile(U.bob, U.bob); });

      it('THEN email derives from his id and email is the only enabled channel', () => {
        expect(p.email).toBe(U.bob);
        expect(p.phone).toBe(null);
        expect(p.push_subscriptions).toEqual([]);
        expect(p.preferences).toEqual({ channels: { email: true, sms: false, push: false }, muted_types: [] });
      });
    });
  });

  describe('GIVEN a member whose id is not an address', () => {
    const h = freshLog();
    beforeEach(() => { h.log.addTeamMember({ owner: 'acme', user: 'acme-bot', actor: 'acme' }); });

    describe('WHEN the org reads the profile', () => {
      let p: any;
      beforeEach(() => { p = h.log.getProfile('acme-bot', 'acme'); });

      it('THEN email is null', () => {
        expect(p.email).toBe(null);
      });
    });
  });
});

describe('profile updates merge, validate and respect permissions', () => {
  describe('GIVEN bob without a stored profile', () => {
    const h = freshLog();

    describe('WHEN he sets a phone, enables sms and mutes vote_received', () => {
      let p: any;
      beforeEach(() => { p = h.log.setProfile(U.bob, U.bob, SMS_AND_MUTE); });

      it('THEN the profile reflects it', () => {
        expect(p.phone).toBe(PHONE);
        expect(p.preferences.channels).toEqual({ email: true, sms: true, push: false });
      });
    });
  });

  describe('GIVEN bob\'s stored phone, sms and muted vote_received', () => {
    const h = freshLog();
    beforeEach(() => { h.log.setProfile(U.bob, U.bob, SMS_AND_MUTE); });

    describe('WHEN he later adds a push subscription and enables push', () => {
      let p: any;
      beforeEach(() => { p = h.log.setProfile(U.bob, U.bob, { push_subscriptions: [SUBSCRIPTION], preferences: { channels: { push: true } } }); });

      it('THEN earlier fields are kept and new ones merged', () => {
        expect(p.phone).toBe(PHONE);
        expect(p.push_subscriptions).toEqual([SUBSCRIPTION]);
        expect(p.preferences.muted_types).toEqual(['vote_received']);
        expect(p.preferences.channels).toEqual({ email: true, sms: true, push: true });
      });
    });

    describe('WHEN he sets phone to null', () => {
      let p: any;
      beforeEach(() => { p = h.log.setProfile(U.bob, U.bob, { phone: null }); });

      it('THEN it is cleared', () => {
        expect(p.phone).toBe(null);
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
    describe('GIVEN bob', () => {
      const h = freshLog();

      describe(`WHEN he saves a profile with ${label}`, () => {
        let save: () => unknown;
        beforeEach(() => { save = () => h.log.setProfile(U.bob, U.bob, input); });

        it('THEN VALIDATION_ERROR 400', () => {
          expectCode(save, 'VALIDATION_ERROR', 400);
        });
      });
    });
  }

  describe('GIVEN bob\'s profile', () => {
    const h = freshLog();

    describe('WHEN carol reads it', () => {
      let read: () => unknown;
      beforeEach(() => { read = () => h.log.getProfile(U.bob, U.carol); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(read, 'FORBIDDEN', 403);
      });
    });

    describe('WHEN carol edits it', () => {
      let edit: () => unknown;
      beforeEach(() => { edit = () => h.log.setProfile(U.bob, U.carol, { phone: PHONE }); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(edit, 'FORBIDDEN', 403);
      });
    });

    describe('WHEN the org admin edits his email', () => {
      let p: any;
      beforeEach(() => { p = h.log.setProfile(U.bob, U.org, { email: 'bob@personal.example' }); });

      it('THEN the change is applied', () => {
        expect(p.email).toBe('bob@personal.example');
      });
    });
  });
});
