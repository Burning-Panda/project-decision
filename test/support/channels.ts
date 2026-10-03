import type { ChannelName, DeliveryResult, NotificationChannel, NotificationPayload } from './target';
import { U } from './fixtures';

/** Test fixtures: delivery results a fake channel returns. */
export const sentResult = (providerId: string | null = null): DeliveryResult => ({ status: 'sent', provider_id: providerId });
export const failedResult = (error: string, { retryable = true } = {}): DeliveryResult => ({ status: 'failed', error, retryable });

/** Test fixtures: a scriptable channel and a complete notification. */
export type Script = (DeliveryResult | Error)[];

export class FakeChannel implements NotificationChannel {
  calls: { payload: NotificationPayload; addresses: string[] }[] = [];
  constructor(readonly name: ChannelName, public script: Script = []) {} // results (or Errors) of successive send() calls; last one repeats
  async send(payload: NotificationPayload, addresses: string[]): Promise<DeliveryResult> {
    this.calls.push({ payload, addresses });
    const next = this.script[Math.min(this.calls.length - 1, this.script.length - 1)] ?? sentResult(`${this.name}-${this.calls.length}`);
    if (next instanceof Error) throw next;
    return next;
  }
  /** Payloads received, in order. */
  get payloads() { return this.calls.map((c) => c.payload); }
}
export const email = (script?: Script) => new FakeChannel('email', script);
export const sms = (script?: Script) => new FakeChannel('sms', script);
export const push = (script?: Script) => new FakeChannel('push', script);

export const PAYLOAD: NotificationPayload = {
  id: 'notif-001', type: 'decision_proposed',
  recipient: { user: U.bob, addresses: { email: [U.bob] } },
  title: 'Decision proposed', body: 'PRJ-001 needs your review', link: null, data: {},
};

/** A browser push subscription as the client posts it to `PUT /profile`. */
export const SUBSCRIPTION = {
  endpoint: 'https://push.example.com/send/abc',
  expirationTime: null,
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
};
