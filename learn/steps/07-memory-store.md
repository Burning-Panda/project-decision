# 07 · The in-memory store

## Goal

Implement the `MemoryStore` constructor: one empty collection per name in the lists at the top of `src/storage/store.ts`.

## You'll learn

- Maps vs arrays vs plain objects, and when to use which
- Building properties from data (the collection lists)

## Where

- `src/storage/store.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

A Map for each name in `MAP_COLLECTIONS`, an array for `ARRAY_COLLECTIONS`, `{}` for `RECORD_COLLECTIONS`.

### Hint 2

Assign them as properties on `this` (`(this as any)[name] = new Map()`), so `store.owners` works. Remove the `throw`.
