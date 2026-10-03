# 07 · The in-memory store

## Goal

Implement the `MemoryStore` constructor: one empty collection for each name in the lists at the top of `src/storage/store.ts`. Every service keeps its data in this store.

## You'll learn

- Maps, arrays and records, and when to use which → `learn/concepts/maps-arrays-records.md`
- Constructors and creating properties from data → `learn/concepts/classes-and-this.md`

## Where

- `src/storage/store.ts`

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: a new memory store holds every collection, empty, and is not persistent

#### What the test wants

After `new MemoryStore()`, every name in `MAP_COLLECTIONS` is an empty `Map`, every name in `ARRAY_COLLECTIONS` an empty array, every name in `RECORD_COLLECTIONS` an empty object, and `persistent` is `false`. So `store.owners`, `store.teams`, `store.projects` (Maps) and `store.audit` (an array) must exist.

#### Where to look

The constructor in `src/storage/store.ts`. It currently throws; replace that. The lists are already imported at the top of the same file.

#### Plan

1. Loop over each list.
2. For each name, create the right empty collection and store it as a property named after it.
3. `persistent = false` is already declared above the constructor.

#### Almost the answer

```ts
constructor() {
  for (const name of MAP_COLLECTIONS) (this as any)[name] = new Map();
  for (const name of ARRAY_COLLECTIONS) (this as any)[name] = ____;
  for (const name of RECORD_COLLECTIONS) (this as any)[name] = ____;
}
```

## Common mistakes

- Leaving the `throw` in the constructor.
- Creating one empty array and assigning it to every collection: they would all share it.
