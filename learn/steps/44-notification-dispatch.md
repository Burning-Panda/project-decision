# 44 · Dispatching notifications through channels

## Goal

Dispatch in-app notifications through the Notifier: plan payloads from profiles, send, retry with backoff, skip the stale backlog.

## You'll learn

- Queues and planning
- Retry policies as injectable objects
- Not blasting old notifications

## Where

- `src/decision-log/notifications/notification-dispatcher.ts`
- `src/decision-log/notifications/retry-policy.ts`
- New collection `channel_deliveries` (ARRAY)

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Plan once per notification (mark it `planned`); create one channel delivery per channel the user has enabled.

### Hint 2

Notifications older than 24 hours are marked planned without sending.

### Hint 3

Reuse the backoff idea from step 43 through `RetryPolicy`.
