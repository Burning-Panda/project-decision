# 21 · Configurable thresholds

## Goal

Make the thresholds configurable and respect `require_reason_on_revision` and `enabled_voting`.

## You'll learn

- Reading behaviour from settings instead of constants

## Where

- `src/decision-log/decisions/decisions.service.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

If step 20 used literals (3, 0.8), read them from `project.approval_settings` now.

### Hint 2

With voting enabled in single approval, votes are counted but never approve: only a lead does.
