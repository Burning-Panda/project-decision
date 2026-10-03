# 12 · Schema migrations in SQLite

## Goal

Write the first SQLite migration (one table per collection) and make `SqliteStore.open` apply migrations once, record them and refuse a newer database.

## You'll learn

- Schema migrations: an append-only, versioned list of schema changes
- Bun's built-in SQLite (`import { Database } from 'bun:sqlite'`)
- Refusing to run against data newer than the code

## Where

- `src/storage/migrations/sqlite.ts`
- `src/storage/sqlite-store.ts`
- `docs/POSTGRES.md` (the same design for PostgreSQL)

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Migration 1 returns SQL that creates `schema_migrations (version integer primary key, name text, applied_at text)` and, for every collection, `CREATE TABLE IF NOT EXISTS "<name>" (k text primary key, data text not null, updated_at text)`.

### Hint 2

In `open`: create `schema_migrations` if needed, read the highest version, throw an error mentioning "newer" if it exceeds your highest migration, then run each missing migration in a transaction and insert its row.

### Hint 3

Make `SqliteStore` extend `MemoryStore` so it has every collection, with `persistent = true`. Add `close()` (close the database).

### Hint 4

From now on, every feature that adds a collection adds a new migration here; never edit migration 1 once others depend on it.
