# 35 · Events and the outbox

## Goal

Every lifecycle step records an event in an outbox and creates a delivery for every matching active webhook of the same org.

## You'll learn

- The outbox pattern
- Wildcard filters (`decision.*`)
- Payloads without sensitive content

## Where

- `src/decision-log/webhooks/webhooks.service.ts`
- `src/decision-log/decisions/decisions.service.ts`
- New collections `events` and `deliveries` (ARRAY)

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Add one `emit(type, payload)` helper and call it after each successful action, never before validation.

### Hint 2

Payloads carry ids, actors and outcomes, not document or comment content.
