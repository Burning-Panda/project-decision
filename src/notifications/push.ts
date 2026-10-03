import { NotImplementedError } from '../common/errors';
import type { DeliveryResult, NotificationChannel, NotificationPayload } from './index';

/** A browser's `PushSubscription.toJSON()`, stored on the profile and passed to the channel as a JSON string address. */
export interface PushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

/** VAPID identity of this server; `subject` is a `mailto:` or `https:` URL. */
export interface VapidKeys {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/** Carries one Web Push message. Rejects with `statusCode` on the error when the push service refuses it. */
export interface PushTransport {
  send(subscription: PushSubscription, body: string): Promise<void>;
}

/** Web Push via the `web-push` package (signs with VAPID, encrypts the body). Not built yet. */
export const webPushTransport = (_vapid: VapidKeys): PushTransport => {
  throw new NotImplementedError('webPushTransport');
};

/** Parses and checks a subscription address (endpoint is https, both keys present). Throws `Invalid push subscription: …` otherwise. */
export const parseSubscription = (_address: string): PushSubscription => {
  throw new NotImplementedError('parseSubscription');
};

export interface PushChannelOptions {
  transport: PushTransport;
}

/**
 * Browser notifications over Web Push. Sends `{ id, type, title, body, link }` as JSON to every subscription; the
 * page's service worker shows it. Sent when any subscription accepts it; a 404/410 (subscription gone) is permanent.
 */
export class PushChannel implements NotificationChannel {
  readonly name = 'push';

  constructor(readonly options: PushChannelOptions) {}

  async send(_payload: NotificationPayload, _addresses: string[]): Promise<DeliveryResult> {
    throw new NotImplementedError('PushChannel.send');
  }
}
