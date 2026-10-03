# 06 · Implementing an interface: the push channel

## Goal

Implement `PushChannel.send`: push to every subscription and turn the outcomes into one `DeliveryResult`.

## You'll learn

- Implementing an interface (`NotificationChannel`)
- Async loops and per-item error handling
- Classifying failures: permanent vs retryable

## Where

- `src/notifications/push.ts`
- `src/notifications/index.ts` (the `DeliveryResult` shapes)
- Compare with `EmailChannel` from step 02

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

The body is `JSON.stringify({ id, type, title, body, link })` taken from the payload.

### Hint 2

Send to each address with `parseSubscription(address)`; catch each failure separately.

### Hint 3

Any success → `{ status: 'sent', provider_id: null }`. All failed with statusCode 404/410 → failed, `retryable: false`. Otherwise failed, `retryable: true`.
