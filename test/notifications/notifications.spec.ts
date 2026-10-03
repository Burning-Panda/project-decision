import { describe, it, expect, beforeEach } from 'bun:test';
import {
  Notifier, failedResult, FakeChannel, email, sms, push, PAYLOAD, U,
  type ChannelDelivery, type NotificationPayload,
} from '../support/index';

const reachable: NotificationPayload = {
  ...PAYLOAD,
  recipient: { user: U.bob, addresses: { email: [U.bob], sms: ['+14155550123'], push: ['{"endpoint":"https://push.example/1"}'] } },
};
const statuses = (deliveries: ChannelDelivery[]) => deliveries.map((d) => [d.channel, d.result.status]);

/** Registers every channel on a fresh notifier. */
const notifierWith = (...channels: FakeChannel[]) => channels.reduce((n, c) => n.register(c), new Notifier());

// ---------------------------------------------------------------- registration
describe('the notifier registers channels by unique name', () => {
  describe('GIVEN a notifier', () => {
    let notifier: Notifier;
    beforeEach(() => { notifier = new Notifier(); });

    describe('WHEN email and sms channels are registered', () => {
      beforeEach(() => { notifier.register(email()).register(sms()); });

      it('THEN their names are listed in registration order', () => {
        expect(notifier.channelNames).toEqual(['email', 'sms']);
      });
    });

    describe('WHEN a second email channel is registered', () => {
      let register: () => unknown;
      beforeEach(() => {
        notifier.register(email());
        register = () => notifier.register(email());
      });

      it('THEN it is rejected as already registered', () => {
        expect(register).toThrow(/already registered/i);
      });
    });
  });
});

// ---------------------------------------------------------------- payload
describe('send hands every channel the payload unchanged, with its own addresses', () => {
  describe('GIVEN an email channel', () => {
    let channel: FakeChannel;
    beforeEach(() => { channel = email(); });

    describe('WHEN a notification is sent', () => {
      beforeEach(async () => { await notifierWith(channel).send(PAYLOAD); });

      it('THEN the channel receives the payload as given', () => {
        expect(channel.payloads).toEqual([PAYLOAD]);
      });

      it('THEN the channel receives the recipient\'s email addresses', () => {
        expect(channel.calls[0]!.addresses).toEqual([U.bob]);
      });
    });
  });
});

describe('send rejects a notification missing a required field and delivers nothing', () => {
  const missing: Array<[string, NotificationPayload]> = [
    ['id', { ...PAYLOAD, id: '' }],
    ['type', { ...PAYLOAD, type: '' }],
    ['title', { ...PAYLOAD, title: '' }],
    ['body', { ...PAYLOAD, body: '' }],
    ['recipient.user', { ...PAYLOAD, recipient: { user: '', addresses: { email: [U.bob] } } }],
  ];
  for (const [field, payload] of missing) {
    describe('GIVEN an email channel', () => {
      let channel: FakeChannel;
      beforeEach(() => { channel = email(); });

      describe(`WHEN a notification without ${field} is sent`, () => {
        let error: unknown;
        beforeEach(async () => { error = await notifierWith(channel).send(payload).catch((e: unknown) => e); });

        it(`THEN it rejects naming ${field}`, () => {
          expect(String(error)).toContain(field);
        });

        it('THEN no channel was called', () => {
          expect(channel.calls).toEqual([]);
        });
      });
    });
  }
});

// ---------------------------------------------------------------- delivery
describe('send delivers through every registered channel the recipient can be reached on', () => {
  describe('GIVEN email and sms channels and a recipient with only an email', () => {
    let channels: FakeChannel[];
    beforeEach(() => { channels = [email(), sms()]; });

    describe('WHEN a notification is sent', () => {
      let deliveries: ChannelDelivery[];
      beforeEach(async () => { deliveries = await notifierWith(...channels).send(PAYLOAD); });

      it('THEN email is sent and sms is skipped for no_address', () => {
        expect(deliveries).toEqual([
          { channel: 'email', result: { status: 'sent', provider_id: 'email-1' } },
          { channel: 'sms', result: { status: 'skipped', reason: 'no_address' } },
        ]);
      });

      it('THEN the sms channel is not called', () => {
        expect(channels[1]!.calls).toEqual([]);
      });
    });
  });

  describe('GIVEN email, sms and push channels and a recipient reachable on all', () => {
    let channels: FakeChannel[];
    beforeEach(() => { channels = [email(), sms(), push()]; });

    describe('WHEN a notification is sent', () => {
      let deliveries: ChannelDelivery[];
      beforeEach(async () => { deliveries = await notifierWith(...channels).send(reachable); });

      it('THEN each channel receives exactly one payload', () => {
        expect(channels.map((c) => c.calls.length)).toEqual([1, 1, 1]);
      });

      it('THEN every channel reports sent, in registration order', () => {
        expect(statuses(deliveries)).toEqual([['email', 'sent'], ['sms', 'sent'], ['push', 'sent']]);
      });
    });
  });
});

// ---------------------------------------------------------------- preferences
describe('preferences: muted types and disabled channels are respected', () => {
  describe('GIVEN a recipient who muted the notification type', () => {
    let channel: FakeChannel;
    beforeEach(() => { channel = email(); });

    describe('WHEN it is sent', () => {
      let deliveries: ChannelDelivery[];
      beforeEach(async () => { deliveries = await notifierWith(channel).send(PAYLOAD, { muted_types: ['decision_proposed'] }); });

      it('THEN nothing is attempted or listed', () => {
        expect(deliveries).toEqual([]);
        expect(channel.calls).toEqual([]);
      });
    });
  });

  describe('GIVEN a recipient who disabled the sms channel', () => {
    let channels: FakeChannel[];
    beforeEach(() => { channels = [email(), sms()]; });

    describe('WHEN it is sent', () => {
      let deliveries: ChannelDelivery[];
      beforeEach(async () => { deliveries = await notifierWith(...channels).send(reachable, { channels: { sms: false } }); });

      it('THEN only email is used and listed', () => {
        expect(statuses(deliveries)).toEqual([['email', 'sent']]);
        expect(channels[1]!.calls).toEqual([]);
      });
    });
  });
});

// ---------------------------------------------------------------- failures
describe('channel failures are reported per channel, not as a crash', () => {
  describe('GIVEN a channel that throws and one that works', () => {
    let channels: FakeChannel[];
    beforeEach(() => { channels = [email([new Error('smtp down')]), sms()]; });

    describe('WHEN a notification is sent', () => {
      let deliveries: ChannelDelivery[];
      beforeEach(async () => { deliveries = await notifierWith(...channels).send(reachable); });

      it('THEN the throwing channel is a retryable failure carrying the message', () => {
        expect(deliveries[0]!.result).toEqual(failedResult('smtp down'));
      });

      it('THEN the other channel still sends', () => {
        expect(deliveries[1]!.result.status).toBe('sent');
      });
    });
  });

  describe('GIVEN a channel that fails permanently', () => {
    let channel: FakeChannel;
    beforeEach(() => { channel = email([failedResult('no such mailbox', { retryable: false })]); });

    describe('WHEN a notification is sent', () => {
      let deliveries: ChannelDelivery[];
      beforeEach(async () => { deliveries = await notifierWith(channel).send(PAYLOAD); });

      it('THEN its result is passed through unchanged', () => {
        expect(deliveries[0]!.result).toEqual(failedResult('no such mailbox', { retryable: false }));
      });
    });
  });
});
