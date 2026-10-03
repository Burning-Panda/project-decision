# 13 · Saving and loading documents in SQLite

## Goal

Make SQLite actually keep documents: `commit()` writes the store into its tables in one transaction, and `open()` loads them back.

## You'll learn

- Transactions → `learn/concepts/sql-and-migrations.md`
- Saving documents as JSON text → `learn/concepts/json.md`
- Keeping array order in a table

## Where

- `src/storage/sqlite-store.ts`

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: SQLite keeps one table per collection, each document as JSON

#### What the test wants

After committing owner `acme`, the `owners` table has one row: `k` is `acme` and `data` is the owner as JSON text.

#### Where to look

Add `commit()` to `SqliteStore`. The simplest correct version rewrites every table: delete all rows, then insert every document, inside one transaction.

#### Plan

1. In one transaction, for each Map collection: `DELETE FROM` its table, then insert each `[key, doc]` with `JSON.stringify(doc)`.
2. Do the same for arrays and records (next sections).

#### Almost the answer

```ts
commit() {
  const now = new Date().toISOString();
  this.db.transaction(() => {
    for (const name of MAP_COLLECTIONS) {
      this.db.exec(`DELETE FROM "${name}"`);
      const insert = this.db.query(`INSERT INTO "${name}" (k, data, updated_at) VALUES (?, ?, ?)`);
      for (const [k, doc] of (this as any)[name]) insert.run(k, ____, now);
    }
    // arrays and records next
  })();
}
```

### Section: committed documents survive reopening; uncommitted ones and deleted ones do not

#### What the test wants

Reopen a file and the committed owner is there; an owner added after the last commit is not; an owner deleted and committed stays gone. A reopened store reports `persistent: true`.

#### Where to look

`open()` must now load the tables back into the collections after running migrations. Because `commit` deletes before inserting, deletions persist on their own.

#### Plan

1. After the migrations in `open`, create the store, then for each Map collection read `SELECT k, data` and `set(k, JSON.parse(data))`.
2. Return the filled store.

#### Almost the answer

```ts
const store = new SqliteStore(db);
for (const name of MAP_COLLECTIONS) {
  for (const row of db.query(`SELECT k, data FROM "${name}"`).all() as any[]) {
    (store as any)[name].set(row.k, ____);
  }
}
return store;
```

### Section: every collection round-trips through SQLite

#### What the test wants

Every collection, including arrays (in order) and records, survives commit, close and reopen.

#### Where to look

Arrays have no keys, so give each document one that sorts in order: its position, padded with zeros (`0000000001`), so text sorting matches number order. Read them back with `ORDER BY k`. Records use their own keys.

#### Plan

1. In `commit`: arrays insert with key `String(i).padStart(10, '0')`; records insert each `[key, value]` of `Object.entries`.
2. In `open`: arrays load with `ORDER BY k` into a new array; records load into an object.

#### Almost the answer

```ts
// commit
for (const name of ARRAY_COLLECTIONS) {
  this.db.exec(`DELETE FROM "${name}"`);
  const insert = this.db.query(`INSERT INTO "${name}" (k, data, updated_at) VALUES (?, ?, ?)`);
  (this as any)[name].forEach((doc: unknown, i: number) => insert.run(String(i).padStart(10, '0'), JSON.stringify(doc), now));
}

// open
for (const name of ARRAY_COLLECTIONS) {
  (store as any)[name] = (db.query(`SELECT data FROM "${name}" ORDER BY ____`).all() as any[]).map((r) => JSON.parse(r.data));
}
```

## Common mistakes

- Writing without a transaction: a failure halfway leaves half the data (step 37 checks that).
- Numbering array keys without padding: `10` sorts before `2` as text.
- Only inserting, never deleting: deleted documents come back on reopen.
