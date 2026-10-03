# 01 · Worked example: the Notifier

## Goal

Read a finished feature next to its spec: `src/notifications/index.ts` (the Notifier) and `test/notifications/notifications.spec.ts`. Notice how each THEN maps to a few lines of code.

## You'll learn

- Interfaces as contracts (`NotificationChannel`)
- Test doubles: `FakeChannel` in `test/support/channels.ts` scripts results so the spec controls every outcome
- Reporting failures as data instead of throwing

## Where

- `src/notifications/index.ts`
- `test/notifications/notifications.spec.ts`
- `test/support/channels.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Pick one THEN, break the line of code that satisfies it, run `bun test test/notifications/notifications.spec.ts`, read the failure, undo.

### Hint 2

Why does `send` validate the payload before calling any channel? Find the spec that would fail if it did not.
