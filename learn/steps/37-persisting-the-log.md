# 37 · The whole log, persisted

## Goal

A check that the whole log survives a restart: the JSON snapshot and SQLite keep decisions, comments, counters, the audit chain and webhooks; uncommitted changes are dropped; a failed commit writes nothing. Most of it already works if every earlier step added its collection; this step finds what does not.

## You'll learn

- Where state must live: in the store, never in a variable of a service
- Atomic commits
- Using failing tests to find a collection that was forgotten

## Where

- `src/decision-log/decisions/decisions.service.ts` (`get`: a decision shows its comments)
- `src/storage/sqlite-store.ts` and `src/storage/store.ts` (only if a section names a missing collection)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: state survives a JSON round trip including id counters and audit chain

#### What the test wants

An approved decision is serialised with `store.toJSON()` and a new log is built from `MemoryStore.fromJSON(json)`: the decision is still approved, the audit chain and integrity verify, and a new decision is `PRJ-002`.

#### Where to look

`toJSON` / `fromJSON` in `src/storage/store.ts` loop over the three collection lists, so this passes when every collection is listed (the `collections` spec names a missing one). The counter works because it is stored: `project.last_number`. Anything numbered must be derived from stored data, never from a counter variable inside a service: a restarted service has empty variables.

#### Plan

1. If `PRJ-002` repeats, find where the number comes from: it must be `project.last_number`.
2. If the chain breaks after a round trip, check section 4 of step 31 (`canonical`) and that `before`/`after` were copied.

#### Almost the answer

```ts
// derive ids from the data you store
const number = project.last_number + 1;                         // not a `let counter` in the service
const id = `comment-${String(this.ctx.store.comments.length + 1).padStart(3, '0')}`;
```

### Section: state committed to SQLite survives reopening, including audit chain and counters

#### What the test wants

After an approved decision with a comment is committed and the file reopened: the status is `approved` and `getDecision(id).comments.length` is 1; the chain and integrity verify; a new decision is `PRJ-002`; a new comment is `comment-002`.

#### Where to look

This is the first test that reads `getDecision(id).comments`: a decision as a client sees it lists its comments (and, since step 29, its follow-ups). Fix `get` in `src/decision-log/decisions/decisions.service.ts`: return the stored decision plus the comments of that decision. Derived on read, so there is nothing extra to store or to keep in sync.

#### Plan

1. In `get`, after the access check: `{ ...d, comments: <this decision's comments>, followups: <as in step 29> }`.
2. The comments are copies (`structuredClone`).

#### Almost the answer

```ts
get(id: string, actor: string) {
  const d = this.load(id);
  /* access check */
  return {
    ...d,
    comments: this.ctx.store.comments.filter((c) => c.decision_id === id).map((c) => structuredClone(c)),
    followups: this.ctx.store.followups.filter((f) => f.decision_id === ____).map((f) => structuredClone(f)),
  };
}
```

### Section: uncommitted changes are not persisted; committing again changes nothing

#### What the test wants

A comment added after the last commit is gone after reopening (only the committed one exists). Committing twice in a row without changes does not throw.

#### Where to look

Your `commit` from step 13 writes every table in one transaction, so both already hold: nothing is written until `commit()`, and writing the same state twice changes nothing. A commit that writes only what changed would be faster, but no test needs it.

#### Plan

1. Nothing to do if this passes. If `commit` throws the second time, look for an `INSERT` of a key that already exists (you did not delete first).

#### Almost the answer

```ts
// the shape that is safe to repeat: delete, then insert, inside one transaction
this.db.transaction(() => {
  this.db.exec(`DELETE FROM "${name}"`);
  /* insert every document */
})();
```

### Section: deletions are persisted

#### What the test wants

A draft is created, committed, deleted (`deleteDraft`) and committed again. After reopening, the draft is `NOT_FOUND` and the project's `decision_count` is 1.

#### Where to look

`deleteDraft` in `src/decision-log/decisions/decisions.service.ts` (step 15) and `commit`. Deleting must remove the document from the Map **and** undo the project counter; `commit` then drops the row because it rewrites the table.

#### Plan

1. `this.ctx.store.decisions.delete(id)` and `project.decision_count -= 1` in `deleteDraft`.
2. `commit` deletes all rows before inserting, so the deleted decision does not come back.

#### Almost the answer

```ts
this.ctx.store.decisions.delete(id);
this.projects.get(d.project).decision_count -= ____;
```

### Section: a failed commit rolls back as a whole

#### What the test wants

A pending good comment and a row that cannot be serialised (`1n`, a BigInt): `commit()` throws. After the bad row is removed and the file reopened, none of the failed batch was written (still one comment).

#### Where to look

`commit` in `src/storage/sqlite-store.ts`. `bun:sqlite`'s `db.transaction(fn)` returns a function; calling it runs `fn` inside BEGIN/COMMIT and rolls back if `fn` throws. The unserialisable row throws inside `JSON.stringify`, so the serialising has to happen **inside** the transaction function, after earlier tables were already written, for the rollback to matter.

#### Plan

1. Wrap all writes in `this.db.transaction(() => { ... })()`.
2. Do the `JSON.stringify` calls inside it.
3. Do not catch the error inside; let it leave the transaction and `commit`.

#### Almost the answer

```ts
commit() {
  const now = new Date().toISOString();
  this.db.transaction(() => {
    /* every collection: DELETE, then INSERT ... JSON.stringify(doc) */
  })();            // a throw inside rolls everything back, then reaches the caller
}
```

### Section: webhooks, events and deliveries survive a SQLite round trip

#### What the test wants

A webhook and a delivery committed to a SQLite file: after reopening, the webhook is listed and its delivery is listed (total 1); a decision created afterwards emits `evt-002` after the stored `evt-001`.

#### Where to look

The collections `webhooks`, `events`, `deliveries` need to be in `src/storage/store.ts` and each needs a table (steps 34 and 35). `collections.spec` names any that is missing. The next event id continues because it is derived from the stored events.

#### Plan

1. If a list is empty after reopening, check the collection list and the migration for that name.
2. Ids derived from `events.length` (or the highest stored id) continue correctly after a reopen.

#### Almost the answer

```ts
export const ARRAY_COLLECTIONS = [/* ... */ 'webhooks', 'events', 'deliveries'];
// migration: { version: 6, name: 'webhooks and the outbox', up: () => ['webhooks', 'events', 'deliveries'].map(table).join('\n') }
```

## Common mistakes

- Keeping a counter in a service variable: it resets to zero on every restart.
- Adding a collection to `store.ts` without a SQLite migration (the `collections` spec fails for that name).
- Editing an old migration instead of adding a new one: files that already ran it never get the table.
- Serialising outside the transaction: a bad row then fails before anything is written and the rollback is never exercised.
- Forgetting that `getDecision` must list its comments.
