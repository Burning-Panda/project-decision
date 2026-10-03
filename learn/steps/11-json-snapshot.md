# 11 · Serialising the store to JSON

## Goal

Implement `toJSON` and `MemoryStore.fromJSON`: a plain-JSON copy of the whole store and back.

## You'll learn

- Serialisation: Maps are not JSON, objects are
- Deep copies vs shared references
- Forward compatibility: snapshots from an older version still load

## Where

- `src/storage/store.ts`
- `test/storage/memory-store.spec.ts`, `test/storage/collections.spec.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

`Object.fromEntries(map)` turns a Map into an object; `new Map(Object.entries(obj))` turns it back.

### Hint 2

Return copies, not the live objects: `structuredClone` is the simplest way, and it is what the "shares no objects" THEN checks.

### Hint 3

`fromJSON` creates an empty store first and fills only the collections present in the snapshot, so missing ones stay empty.
