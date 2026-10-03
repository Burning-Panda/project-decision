# 06 · Implementing an interface: the push channel

## Goal

Implement `PushChannel.send`: push the notification to every subscription and turn the outcomes into one `DeliveryResult`. Compare with `EmailChannel` from step 02: same interface, different transport.

## You'll learn

- Implementing an interface (`NotificationChannel`)
- Loops with `await` and per-item errors → `learn/concepts/async-await.md`
- Classifying failures: permanent or worth retrying

## Where

- `src/notifications/push.ts` (`PushChannel`)
- `src/notifications/index.ts` (the `DeliveryResult` shapes)
- `src/notifications/email.ts` (a finished channel to compare with)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: PushChannel sends the notification to every subscription

#### What the test wants

Sending to two subscriptions returns `{ status: 'sent' }`, the transport receives one push per subscription in order, and each push body is JSON with exactly `id`, `type`, `title`, `body` and `link` from the payload.

#### Where to look

`PushChannel.send` in `src/notifications/push.ts`. Each address is a JSON string: turn it into a subscription with `parseSubscription` (step 05). Send through `this.options.transport.send(subscription, body)`.

#### Plan

1. Build the body once with `JSON.stringify` and the five fields.
2. Loop over the addresses with `for ... of` and `await` each send (that keeps the order).
3. Return `{ status: 'sent', provider_id: null }` when at least one send worked.

#### Almost the answer

```ts
async send(payload, addresses) {
  const body = JSON.stringify({ id: payload.id, type: payload.type, title: ____, body: ____, link: payload.link });
  let sent = 0;
  for (const address of addresses) {
    await this.options.transport.send(parseSubscription(address), body);
    sent++;
  }
  return { status: 'sent', provider_id: null };
}
```

### Section: PushChannel classifies failures: a gone subscription is permanent, anything else retryable

#### What the test wants

A failed push has an error with a `statusCode`. If one of two subscriptions is gone (410) the result is still `sent`. If every subscription is gone, the result is `failed` with `retryable: false` (retrying cannot help). If the push service is unreachable, `failed` with `retryable: true`.

#### Where to look

Same method. Wrap each send in `try/catch`, so one failure does not stop the others, and count what happened.

#### Plan

1. Count successes and "gone" failures (status 404 or 410); remember the last error message.
2. Any success: `sent`.
3. Otherwise `failed`, with `retryable` false only when every failure was "gone".

#### Almost the answer

```ts
let sent = 0, gone = 0, lastError = '';
for (const address of addresses) {
  try {
    await this.options.transport.send(parseSubscription(address), body);
    sent++;
  } catch (e: any) {
    if (e?.statusCode === 404 || e?.statusCode === 410) gone++;
    lastError = e?.message ?? String(e);
  }
}
if (sent > 0) return { status: 'sent', provider_id: null };
return { status: 'failed', error: lastError, retryable: ____ };
```

## Common mistakes

- Returning `failed` when only some subscriptions are gone: one success means it was delivered.
- Forgetting `await`: the error then escapes your `try/catch`.
