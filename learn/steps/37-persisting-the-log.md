# 37 · The whole log, persisted

## Goal

Run the whole log on SQLite and the JSON snapshot: counters, the audit chain and webhooks survive a restart; failed commits roll back.

## You'll learn

- End-to-end persistence
- Atomic commits

## Where

- `src/storage/sqlite-store.ts`
- `src/storage/store.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

If a collection is missing after reopening, check `collections.spec` first: it names the collection.

### Hint 2

Write each commit inside one transaction so a failure (an unserialisable value) writes nothing.
