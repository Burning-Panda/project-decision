# Notifications

```
 in-app notification ──► NotificationManager ──► NotificationChannel(s)
 (created by the log)      plan · prefs · retry      email ✔   sms ✗   push ✗
                           fallback · persistence
```

* **`NotificationPayload`** (`src/notifications/payload.js`) is the one standard, channel-agnostic structure every
  channel receives: `{ version, id, type, priority, recipient{user,email,phone,push_tokens}, content{title,body,html,link}, context{decision_id,project,actor}, data, created_at, dedupe_key }`.
  It is validated (`validateNotificationPayload`), frozen, and header-injection safe.
* **`NotificationChannel`** (`src/notifications/channel.js`) is the interface a delivery service implements.
* **`NotificationManager`** (`src/notifications/manager.js`) owns everything else: turning notifications into payloads,
  respecting each user's preferences, per-channel retries with backoff (1m, 5m, 30m, 2h, 5 attempts), fallback order,
  persistence of every attempt, and ignoring notifications older than `maxAgeHours` (24) so a newly enabled channel never
  blasts the backlog.

## What you implement to connect a new service (SMS, push, chat...)

Extend `NotificationChannel` and implement three members:

```js
import { NotificationChannel, sent, failed } from './src/notifications/index.js';

export class SmsChannel extends NotificationChannel {
  constructor({ client, from }) { super(); this.client = client; this.from = from; }

  get name() { return 'sms'; }                          // unique lower_snake_case id; users enable channels by this name

  supports(payload) { return Boolean(payload.recipient.phone); }   // sync, no side effects; false => recorded as "skipped: no_address"

  async send(payload) {                                 // deliver ONE payload; never mutate it
    try {
      const res = await this.client.messages.create({ to: payload.recipient.phone, from: this.from, body: `${payload.content.title}\n${payload.content.link ?? ''}`, idempotencyKey: payload.dedupe_key });
      return sent(res.sid);                             // provider id
    } catch (e) {
      return failed(e.message, { retryable: !e.permanent });   // retryable:false for bad numbers, blocked content...
    }
  }
}
```

Contract details:

| Member | Rules |
|--------|-------|
| `name` | `/^[a-z][a-z0-9_]*$/`, unique per manager. Must be one of `email`, `sms`, `push` to be selectable in user preferences today (extend `known` in `DecisionLog.setProfile` for new names). |
| `supports(payload)` | Synchronous, pure. Return `true` only if the recipient has the address this channel needs. |
| `send(payload)` | Resolve with `sent(providerId?)`, `failed(error, { retryable })` or `skipped(reason)`. A throw counts as a retryable failure. Must be idempotent for a given `payload.dedupe_key` (a crash between sending and bookkeeping re-sends). |

Then:

1. **Test it with the conformance kit**: `assert.deepEqual(await checkChannelConformance(channel, { payload, unaddressable }), [])`
   (see `test/email.test.js`; `test/notifications.test.js` shows fake SMS/push channels driving the manager).
2. **Store the address**: SMS needs `phone` (E.164) and push needs `push_tokens`; both already exist on the user profile
   (`PUT /profile`). A new kind of address needs a field in `setProfile` + `normalizePayload`/`validateNotificationPayload`.
3. **Register it** in `src/server.js`: `notifications.register(new SmsChannel({...}))`. Nothing else changes: preferences
   (`enabled`, `order`, `mode: all|fallback`, `muted_types`), retries and persistence apply automatically.

Other services can reuse the channels without the queue: `await manager.deliver(payloadInput, { channels: ['sms'] })`
resolves with `[{ channel, result }]` (one-shot, not persisted or retried).

## Email (built)

`EmailChannel` renders a multipart text + HTML message (HTML is escaped; supply `content.html` yourself to override) and hands it to a
`MailTransport` (`send(message) -> { id, accepted, rejected }`, throwing errors with `.retryable`). Two transports ship:
`SmtpTransport` (production) and `MemoryMailTransport` (tests).

`SmtpTransport` is a dependency-free SMTP submission client: STARTTLS (`auto` | `required` | `never`) or implicit TLS (`smtps://`),
AUTH PLAIN/LOGIN, certificate verification on by default, **credentials never sent over an unencrypted non-loopback connection**
(unless `allowInsecureAuth`), strict address validation (no CRLF/command injection), RFC 2047 subjects, dot-stuffing, and
4xx = retry / 5xx = permanent classification. The `Message-ID` is derived from the notification id, so retries are recognisable duplicates.

Configuration (environment):

| Variable | Meaning |
|----------|---------|
| `SMTP_URL` | `smtp://user:pass@host:587?starttls=required` or `smtps://user:pass@host:465` (URL-encode credentials). Unset = email disabled. |
| `EMAIL_FROM` | Required with `SMTP_URL`, e.g. `Decision Log <noreply@example.com>` (must be allowed by your provider/SPF/DKIM). |
| `EMAIL_REPLY_TO`, `APP_NAME`, `APP_URL` | Optional. `APP_URL` makes emails link back to the decision. |

SMTP credentials live only in the environment (never in the database). Users manage addresses and preferences with
`GET/PUT /profile` (own profile, or an org admin for members): `email` (defaults to the user id when it is an address), `phone`, `push_tokens`,
`preferences { channels: {email,sms,push}, order, mode, muted_types }`. Email is on by default.
