import { describe, it, expect, beforeEach } from 'bun:test';
import {
  PushChannel, parseSubscription, PAYLOAD, SUBSCRIPTION,
  type DeliveryResult, type PushSubscription, type PushTransport,
} from '../support/index';

const OTHER = { ...SUBSCRIPTION, endpoint: 'https://push.example.com/send/def' };
const address = (subscription: unknown) => JSON.stringify(subscription);

/** Records every push; endpoints listed in `failures` reject with that error instead. */
class FakePushTransport implements PushTransport {
  sent: { subscription: PushSubscription; body: string }[] = [];
  constructor(readonly failures: Record<string, Error> = {}) {}
  async send(subscription: PushSubscription, body: string) {
    const failure = this.failures[subscription.endpoint];
    if (failure) throw failure;
    this.sent.push({ subscription, body });
  }
}
const gone = () => Object.assign(new Error('410 Gone'), { statusCode: 410 });

// ---------------------------------------------------------------- subscriptions
describe('parseSubscription accepts a browser subscription and rejects anything else', () => {
  describe('GIVEN a serialized subscription', () => {
    describe('WHEN parsed', () => {
      let parsed: PushSubscription;
      beforeEach(() => { parsed = parseSubscription(address(SUBSCRIPTION)); });

      it('THEN the endpoint and keys are returned', () => {
        expect(parsed).toEqual(SUBSCRIPTION);
      });
    });
  });

  const invalid: Array<[string, string]> = [
    ['text that is not JSON', 'tok-1'],
    ['a subscription without keys', address({ endpoint: SUBSCRIPTION.endpoint })],
    ['a subscription with a non-https endpoint', address({ ...SUBSCRIPTION, endpoint: 'http://push.example.com/x' })],
  ];
  for (const [label, input] of invalid) {
    describe(`GIVEN ${label}`, () => {
      describe('WHEN parsed', () => {
        let parse: () => unknown;
        beforeEach(() => { parse = () => parseSubscription(input); });

        it('THEN it throws an invalid push subscription error', () => {
          expect(parse).toThrow(/invalid push subscription/i);
        });
      });
    });
  }
});

// ---------------------------------------------------------------- PushChannel
describe('PushChannel sends the notification to every subscription', () => {
  describe('GIVEN a push channel', () => {
    let transport: FakePushTransport;
    let channel: PushChannel;
    beforeEach(() => {
      transport = new FakePushTransport();
      channel = new PushChannel({ transport });
    });

    describe('WHEN its name is read', () => {
      it('THEN it is push', () => {
        expect(channel.name).toBe('push');
      });
    });

    describe('WHEN a notification is sent to two subscriptions', () => {
      let result: DeliveryResult;
      beforeEach(async () => { result = await channel.send({ ...PAYLOAD, link: 'https://dl.example.com/#/d/PRJ-001' }, [address(SUBSCRIPTION), address(OTHER)]); });

      it('THEN the result is sent', () => {
        expect(result.status).toBe('sent');
      });

      it('THEN each subscription receives one push', () => {
        expect(transport.sent.map((s) => s.subscription.endpoint)).toEqual([SUBSCRIPTION.endpoint, OTHER.endpoint]);
      });

      it('THEN the body is the JSON the service worker shows', () => {
        expect(JSON.parse(transport.sent[0]!.body)).toEqual({
          id: 'notif-001', type: 'decision_proposed', title: 'Decision proposed', body: 'PRJ-001 needs your review', link: 'https://dl.example.com/#/d/PRJ-001',
        });
      });
    });
  });
});

describe('PushChannel classifies failures: a gone subscription is permanent, anything else retryable', () => {
  const cases: Array<[string, Record<string, Error>, Partial<DeliveryResult>]> = [
    ['one of two subscriptions is gone (410)', { [SUBSCRIPTION.endpoint]: gone() }, { status: 'sent' }],
    ['every subscription is gone (410)', { [SUBSCRIPTION.endpoint]: gone(), [OTHER.endpoint]: gone() }, { status: 'failed', retryable: false }],
    ['the push service is unreachable', { [SUBSCRIPTION.endpoint]: new Error('ECONNRESET'), [OTHER.endpoint]: new Error('ECONNRESET') }, { status: 'failed', retryable: true }],
  ];
  for (const [label, failures, expected] of cases) {
    describe(`GIVEN ${label}`, () => {
      let channel: PushChannel;
      beforeEach(() => { channel = new PushChannel({ transport: new FakePushTransport(failures) }); });

      describe('WHEN a notification is sent to both subscriptions', () => {
        let result: DeliveryResult;
        beforeEach(async () => { result = await channel.send(PAYLOAD, [address(SUBSCRIPTION), address(OTHER)]); });

        it(`THEN the result matches ${JSON.stringify(expected)}`, () => {
          expect(result).toMatchObject(expected);
        });
      });
    });
  }
});
