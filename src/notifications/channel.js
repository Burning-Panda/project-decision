/**
 * Contract for a delivery channel (email, SMS, push, chat...). To connect another service, extend this class,
 * implement the three members below, run `checkChannelConformance` in your tests, and register it:
 *
 *     manager.register(new MyChannel(...));
 *
 * Channels are stateless with respect to the queue: the NotificationManager owns planning, retries, backoff,
 * preferences and fallback. A channel only knows how to deliver one payload.
 */
export class NotificationChannel {
  /** Unique lower_snake_case id, e.g. "email", "sms", "push". Users enable channels by this name. */
  get name() {
    throw new Error('NotificationChannel subclasses must implement the `name` getter');
  }

  /**
   * Can this channel reach the recipient at all? Return true only if the payload carries the address this
   * channel needs (email address, phone number, device token...). Must be synchronous and side-effect free.
   * When false the manager records a "skipped / no_address" result and never calls send().
   */
  supports(_payload) {
    throw new Error('NotificationChannel subclasses must implement supports(payload)');
  }

  /**
   * Deliver one frozen NotificationPayload. Resolve with `sent(providerId)`, `failed(error, { retryable })` or
   * `skipped(reason)`. Prefer returning `failed(...)` over throwing (a throw is treated as a retryable failure).
   * Mark `retryable: false` for permanent problems (bad address, rejected content) so the queue stops retrying.
   * Must be idempotent for a given `payload.dedupe_key`/`payload.id`: the same payload may be sent again after a
   * crash between delivery and bookkeeping.
   */
  async send(_payload) {
    throw new Error('NotificationChannel subclasses must implement send(payload)');
  }
}
