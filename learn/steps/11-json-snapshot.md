# 11 · Serialising the store to JSON

## Goal

Implement `toJSON` and `MemoryStore.fromJSON`: a plain-JSON copy of the whole store, and back. This is the first form of persistence: anything you can turn into JSON, you can save.

## You'll learn

- What survives JSON and what does not → `learn/concepts/json.md`
- Copies vs shared references → `learn/concepts/objects-and-copies.md`
- Loading data written by an older version

## Where

- `src/storage/store.ts`
- `test/storage/memory-store.spec.ts` and `test/storage/collections.spec.ts` (what is checked)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: the JSON snapshot is plain JSON and round-trips

#### What the test wants

`toJSON()` turns Maps into plain objects keyed by id (`json.owners.acme`), keeps arrays as arrays, and the result survives `JSON.stringify` unchanged. `MemoryStore.fromJSON(json)` gives a store whose Maps are Maps again with the same documents. Changing the restored copy must not change the original. A snapshot without some collection (written before it existed) loads with that collection empty.

#### Where to look

`toJSON` and `static fromJSON` in `src/storage/store.ts`. `Object.fromEntries(map)` turns a Map into an object; `new Map(Object.entries(obj))` turns it back; `structuredClone(x)` makes an independent copy.

#### Plan

1. `toJSON`: build an object with one entry per collection (Map → object, array and record as they are), and return a `structuredClone` of it.
2. `fromJSON`: start from `new MemoryStore()` (every collection empty), then fill only the collections present in the snapshot, from a `structuredClone` of it.

#### Almost the answer

```ts
toJSON() {
  const json: Record<string, unknown> = {};
  for (const name of MAP_COLLECTIONS) json[name] = Object.fromEntries((this as any)[name]);
  for (const name of ARRAY_COLLECTIONS) json[name] = (this as any)[name];
  for (const name of RECORD_COLLECTIONS) json[name] = ____;
  return structuredClone(json);
}

static fromJSON(json: any) {
  const store: any = new MemoryStore();
  const data = structuredClone(json ?? {});
  for (const name of MAP_COLLECTIONS) if (data[name]) store[name] = new Map(Object.entries(data[name]));
  for (const name of ARRAY_COLLECTIONS) if (data[name]) store[name] = ____;
  for (const name of RECORD_COLLECTIONS) if (data[name]) store[name] = ____;
  return store;
}
```

### Section: every collection round-trips through the JSON snapshot

#### What the test wants

For every collection in the lists, two documents survive a snapshot and restore, and array documents keep their order. When you add collections later, this section checks them automatically.

#### Where to look

The same two methods. If the previous section passes and this one fails, a kind of collection (array or record) is not handled.

#### Plan

1. Make sure each of the three loops in both methods covers its list.
2. Arrays: keep them as arrays (their order is their meaning).

#### Almost the answer

```ts
// each list needs its loop in toJSON and in fromJSON:
for (const name of ARRAY_COLLECTIONS) json[name] = (this as any)[name];
for (const name of RECORD_COLLECTIONS) json[name] = (this as any)[name];
```

## Common mistakes

- Returning the live Maps or objects: a caller changing the snapshot would change the store.
- `JSON.stringify` of a Map gives `{}`: convert Maps before they reach JSON.
- Failing on a snapshot that lacks a collection instead of leaving it empty.
