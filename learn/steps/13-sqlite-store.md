# 13 · Saving and loading documents in SQLite

## Goal

Make SQLite actually store documents: `commit()` writes changes in one transaction, `open()` loads every table back into the collections.

## You'll learn

- Transactions
- Loading and saving documents as JSON text
- Detecting what changed since the last commit

## Where

- `src/storage/sqlite-store.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

On open, for each collection: `SELECT k, data FROM "<name>"`, `JSON.parse(data)`, and put it back into the Map, array (keep the order) or record.

### Hint 2

The simplest correct `commit`: in one transaction, write every document of every collection (`INSERT ... ON CONFLICT(k) DO UPDATE`) and delete rows whose key is no longer present.

### Hint 3

Array documents need a key: use their `id`, `seq`, or position, and keep order by sorting on it when loading.

### Hint 4

Later you can make commit incremental by remembering the JSON last written per key and only writing what differs.
