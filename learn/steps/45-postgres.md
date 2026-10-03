# 45 · PostgreSQL: transactions, locks and incremental writes

## Goal

Optional: the same store on PostgreSQL, with an advisory lock (one writer), incremental commits, and reporting a lost connection. Needs `TEST_DATABASE_URL`.

## You'll learn

- Advisory locks
- Incremental writes
- jsonb
- Connection loss

## Where

- `src/storage/postgres-store.ts`
- `src/storage/migrations/postgres.ts`
- `docs/POSTGRES.md`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Port your SQLite store: same collections, tables in a schema, `data jsonb`.

### Hint 2

Take `pg_try_advisory_lock` on open and refuse when it is held. Compare canonical JSON so key reordering by jsonb does not look like a change.
