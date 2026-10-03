# 12 · Schema migrations in SQLite

## Goal

Write the first SQLite migration (one table per collection) and make `SqliteStore.open` apply migrations once, record them, and refuse a database newer than the application.

## You'll learn

- Tables, SQL and migrations → `learn/concepts/sql-and-migrations.md`
- Classes that extend others (`SqliteStore extends MemoryStore`) → `learn/concepts/classes-and-this.md`

## Where

- `src/storage/migrations/sqlite.ts`
- `src/storage/sqlite-store.ts`
- `docs/POSTGRES.md` (the same design for PostgreSQL)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: SQLite migrations are numbered 1..n and together give every collection a table

#### What the test wants

`MIGRATIONS` has at least one migration, numbered 1, 2, 3 without gaps. Running all their SQL together creates a table for every collection in the lists (`CREATE TABLE ... "owners" (...)`).

#### Where to look

`src/storage/migrations/sqlite.ts`. Each migration is `{ version, name, up }`, where `up()` returns SQL text. Columns: `k TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT`.

#### Plan

1. Write a small helper that returns the `CREATE TABLE IF NOT EXISTS` statement for one name.
2. Migration 1 creates the tables for the collections that exist now, **listed by name** (`owners`, `teams`, `projects`, `audit`), not computed from the lists. Migrations must never change meaning later.
3. When a later step adds a collection, add migration 2, 3, ... for its table.

#### Almost the answer

```ts
const table = (name: string) => `CREATE TABLE IF NOT EXISTS "${name}" (k TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT);`;

export const MIGRATIONS: SqliteMigration[] = [
  { version: 1, name: 'first collections', up: () => [____].map(table).join('\n') },
];
```

### Section: opening a SQLite file applies migrations once, records them, and refuses a newer database

#### What the test wants

Opening a new file records every migration in `schema_migrations` (columns `version` and `name`, plus an optional `applied_at`). Opening it again applies nothing twice. A file whose `schema_migrations` records version 999 is refused with an error mentioning "newer". `close()` closes the file.

#### Where to look

`SqliteStore` in `src/storage/sqlite-store.ts`. Use Bun's SQLite: `import { Database } from 'bun:sqlite'`. Make `SqliteStore` extend `MemoryStore` so it has every collection, with `persistent = true`. `open` must be synchronous.

#### Plan

1. Open the database and create `schema_migrations` if it does not exist.
2. Read the highest recorded version; if it is above your newest migration, close and throw.
3. For each migration above it, in one transaction: run its SQL and insert its row.
4. Return a new store holding the database; `close()` closes it.

#### Almost the answer

```ts
import { Database } from 'bun:sqlite';

export class SqliteStore extends MemoryStore {
  persistent = true;
  private constructor(private readonly db: Database) { super(); }

  static open(file: string): SqliteStore {
    const db = new Database(file, { create: true });
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT)');
    const applied = (db.query('SELECT max(version) AS v FROM schema_migrations').get() as any)?.v ?? 0;
    const newest = MIGRATIONS.at(-1)?.version ?? 0;
    if (applied > newest) { db.close(); throw new Error(`The database (version ${applied}) is newer than this application (${newest})`); }
    for (const m of MIGRATIONS) {
      if (m.version <= applied) continue;
      db.transaction(() => {
        db.exec(m.up());
        db.query('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(____, ____, new Date().toISOString());
      })();
    }
    return new SqliteStore(db);
  }

  close() { this.db.close(); }
}
```

## Common mistakes

- Computing migration 1 from the collection lists: it would silently change when the lists grow.
- Editing a migration that already ran: add a new one instead.
- Making `applied_at` required: the spec inserts rows without it.
