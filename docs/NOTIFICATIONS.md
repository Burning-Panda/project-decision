# Notifications

```
 DecisionLog ─► NotificationDispatcher ─► Notifier ─► EmailChannel ─► MailTransport (smtpTransport = nodemailer)
 (in-app rows,   (plan, persist, retry)    (preferences,  PushChannel  ─► PushTransport (webPushTransport, not built yet)
  profiles)                                 results)      (sms, webhook: add a channel)
```

| Piece | Does | File |
|-------|------|------|
| `Notifier` | Sends one `NotificationPayload` through every registered, enabled channel; returns one `DeliveryResult` per channel. No queue, retries or history. | `src/notifications/index.ts` |
| `EmailChannel`, `smtpTransport` | Renders text + escaped HTML and sends it with nodemailer. | `src/notifications/email.ts` |
| `PushChannel` (stub) | Browser notifications over Web Push. | `src/notifications/push.ts` |
| `NotificationDispatcher` | Turns the log's in-app notifications and profiles into `Notifier.send` calls; persistence, retries, backlog cutoff. | `src/decision-log/notifications/` |

**Payload**: `{ id, type, recipient: { user, addresses: { email?: [], sms?: [], push?: [] } }, title, body, link, data }`.
`id` doubles as the idempotency key. `data` carries domain extras (`decision_id`, `project`, `actor`) that channels may ignore.

**Preferences**: `{ channels: { sms: false, ... }, muted_types: [...] }`. Channels not listed are on. A muted type sends nothing.

**Results**: `{ status: 'sent', provider_id }`, `{ status: 'failed', error, retryable }` or `{ status: 'skipped', reason: 'no_address' }`.
A channel that throws is reported as a retryable failure. Whoever calls `send` decides whether to retry (the dispatcher does).

## Adding a channel (SMS, webhook, ...)

```ts
import type { DeliveryResult, NotificationChannel, NotificationPayload } from './index';

export class SmsChannel implements NotificationChannel {
  readonly name = 'sms';

  constructor(readonly options: { client: SmsClient; from: string }) {}

  async send(payload: NotificationPayload, addresses: string[]): Promise<DeliveryResult> {
    try {
      const res = await this.options.client.send({ to: addresses[0], from: this.options.from, body: `${payload.title}\n${payload.link ?? ''}` });
      return { status: 'sent', provider_id: res.id };
    } catch (e) {
      return { status: 'failed', error: (e as Error).message, retryable: !(e as { permanent?: boolean }).permanent };
    }
  }
}
```

1. `send` only runs when the recipient has at least one address for the channel's `name`.
2. Have the dispatcher put the address into `recipient.addresses[name]` (from the profile).
3. Register it where the app is composed: `notifier.register(new SmsChannel({ ... }))`.

## Email

`new EmailChannel({ transport: smtpTransport(process.env.SMTP_URL), from: process.env.EMAIL_FROM, replyTo? })`.
The Message-ID is `<notification id@from domain>`, so retries are recognisable duplicates. SMTP 5xx replies are permanent
failures, everything else is retryable. Swap in an HTTP API by implementing `MailTransport`.

| Variable | Meaning |
|----------|---------|
| `SMTP_URL` | `smtp://user:pass@host:587` or `smtps://user:pass@host:465`. Unset = email disabled. |
| `EMAIL_FROM` | e.g. `Decision Log <noreply@example.com>` |
| `EMAIL_REPLY_TO`, `APP_URL` | Optional. `APP_URL` makes emails link back to the decision. |

## Browser push (stub)

The browser subscribes with `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })`
and saves `subscription.toJSON()` through `PUT /profile` as one of `push_subscriptions` (max ten). The dispatcher passes each one
as a JSON string address; `PushChannel` sends `{ id, type, title, body, link }` to every subscription, and the page's service worker
shows it. A 404/410 from the push service means the subscription is gone (permanent failure).

To finish it: `bun add web-push`, implement `webPushTransport(vapid)`, `parseSubscription` and `PushChannel.send`
(specs in `test/notifications/push.spec.ts`), and add `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` to the environment.

## Profiles

`GET/PUT /profile`: `email` (defaults to the user id when it is an address), `phone` (E.164), `push_subscriptions`,
`preferences { channels: { email, sms, push }, muted_types }`. Email is on by default.
