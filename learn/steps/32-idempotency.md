# 32 · Idempotency: safe retries

## Goal

Make retries safe: an action sent again with the same idempotency key returns the stored result instead of acting twice.

## You'll learn

- Idempotency keys
- Detecting a key reused for a different request

## Where

- `src/decision-log/decisions/decisions.service.ts` (`perform` with `opts.idempotencyKey`)
- New collection `idempotency` (RECORD)

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Store `{ request fingerprint, response }` under the key; on a repeat with the same fingerprint return the response with `idempotent_replay: true`.

### Hint 2

Same key, different fingerprint: CONFLICT 409, and nothing changes.
