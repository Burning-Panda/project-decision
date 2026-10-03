# SQL, transactions and migrations

A database keeps data in **tables** of rows and columns. SQL is the language to talk to it.

```sql
CREATE TABLE IF NOT EXISTS owners (k TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT);
INSERT INTO owners (k, data) VALUES ('acme', '{"identifier":"acme"}');
SELECT k, data FROM owners;
DELETE FROM owners WHERE k = 'acme';
```

This project stores each document as JSON text in a `data` column, keyed by `k`.

## SQLite in Bun

```ts
import { Database } from 'bun:sqlite';

const db = new Database('log.db', { create: true });
db.exec('CREATE TABLE ...');                                // run SQL, no result
db.query('SELECT k, data FROM owners').all();               // all rows
db.query('SELECT max(version) AS v FROM t').get();          // first row
db.query('INSERT INTO owners (k, data) VALUES (?, ?)').run('acme', json);  // ? are safe placeholders
db.close();
```

Never paste values into SQL text; use `?` placeholders.

## Transactions

A transaction groups statements: either all of them happen, or none.

```ts
db.transaction(() => {
  db.exec('DELETE FROM owners');
  insert.run('acme', json);
})();          // note the () at the end: it runs the transaction
```

If anything inside throws, everything inside is undone.

## Migrations

The database outlives your code: tomorrow's code meets yesterday's tables. A **migration** is one numbered, permanent change to the schema ("1: create these tables", "2: add the decisions table"). On start the app runs every migration the database has not seen yet and records it in `schema_migrations`.

Rules:

- Versions are 1, 2, 3, ... and never change.
- **Never edit a migration** once it may have run somewhere. Add a new one instead.
- List the tables each migration creates by name. If migration 1 computed its tables from today's collection list, it would mean something different tomorrow, and databases that already ran it would never get the new tables.
- If the database records a version newer than any migration you know, the database belongs to a newer version of the app: refuse to start.
