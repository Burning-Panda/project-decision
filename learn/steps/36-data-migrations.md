# 36 · Evolving stored data: data migrations

## Goal

Implement `applyDataMigrations`, run it when the log starts, and move "encrypt legacy plaintext webhook secrets" into it as data migration 1.

## You'll learn

- Data migrations vs schema migrations
- Running upgrades exactly once
- Startup checks (a persistent store requires a secret box)

## Where

- `src/storage/data-migrations.ts`
- `src/decision-log/decision-log.ts` (startup)
- New collection `data_migrations` (RECORD) and its migration

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Sort by version, skip recorded ones, run each, record `{ name, applied_at }` only after it succeeds.

### Hint 2

Throw "newer" when the store records a version above the highest you know.

### Hint 3

Data migration 1: for each webhook with a plaintext `secret`, write `secret_enc` and delete `secret`. It needs `ctx.secretBox`.
