# 36 · Evolving stored data: data migrations

## Goal

Data migrations: ordered upgrades for documents already stored, applied once each and recorded. The first one encrypts webhook secrets written in plain text. Then finish the secrets story: the log starts them, rotation works, and a persistent store refuses to run without a real key.

## You'll learn

- Schema migrations change tables; data migrations change what is inside them
- Recording what ran, refusing data from the future
- Running upgrades when the application starts
- Key rotation as a data migration you can run again

## Where

- `src/storage/data-migrations.ts` (`applyDataMigrations`, `DATA_MIGRATIONS`)
- `src/decision-log/decision-log.ts` (the constructor)
- `src/decision-log/webhooks/webhooks.service.ts` (`secret`, `rotateSecrets`)
- New RECORD collection `data_migrations` in `src/storage/store.ts` and a new SQLite migration

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: the data migration list is numbered 1..n

#### What the test wants

The versions in `DATA_MIGRATIONS` are 1, 2, ... n with no gaps or repeats (an empty list passes). You add the first real one in the secrets sections below.

#### Where to look

`src/storage/data-migrations.ts`: `DATA_MIGRATIONS` is an array of `{ version, name, up(store, ctx) }`. Append only: never renumber or edit a migration that has shipped.

#### Plan

1. Keep the list append-only, with versions in order.

#### Almost the answer

```ts
export const DATA_MIGRATIONS: DataMigration[] = [
  { version: 1, name: 'encrypt plaintext webhook secrets', up(store, ctx) { /* later section */ } },
  // { version: 2, ... } next time the stored shape changes
];
```

### Section: a data migration upgrades stored documents once and is recorded

#### What the test wants

With two projects stored before `description` existed and a migration that defaults it, `applyDataMigrations(store, ctx, [migration])` returns `[1]`, the old document gets `description: ''`, an existing value is kept, and `store.data_migrations['1']` is `{ name, applied_at }` with the context's time. Applying again returns `[]` and does not run the migration again.

#### Where to look

`applyDataMigrations` in `src/storage/data-migrations.ts`. What ran is remembered in the store itself, so it is saved and restored with the data: add `data_migrations` to `RECORD_COLLECTIONS` (an object keyed by version) in `src/storage/store.ts`, and a migration for its table.

#### Plan

1. For each migration: if `store.data_migrations[version]` exists, skip it.
2. Otherwise run `m.up(store, ctx)`, then record `{ name, applied_at: ctx.now() }`.
3. Collect the versions that ran and return them.

#### Almost the answer

```ts
export function applyDataMigrations(store, ctx, migrations = DATA_MIGRATIONS): number[] {
  const done = store.data_migrations;
  const applied: number[] = [];
  for (const m of migrations) {
    if (done[m.version]) continue;
    m.up(store, ctx);
    done[m.version] = { name: m.name, applied_at: ____ };
    applied.push(m.version);
  }
  return applied;
}
```

### Section: data migrations run in version order and only the new ones run

#### What the test wants

Given a store that already has migration 1 and a list given as 2, 1, 3: only 2 then 3 run, in that order.

#### Where to look

The loop from the previous section. The list may arrive in any order; the order of execution is the version order.

#### Plan

1. Sort a copy of the list by `version` before looping (do not sort the caller's array).

#### Almost the answer

```ts
for (const m of [...migrations].sort((a, b) => a.version - ____)) {
```

### Section: a failing data migration is not recorded, so it runs again next time

#### What the test wants

Migration 1 succeeds and migration 2 throws: the error reaches the caller, 1 is recorded, 2 is not.

#### Where to look

The order of two lines in the loop. Record a migration only after `up` returned.

#### Plan

1. `m.up(...)` first, record second. When `up` throws, the record line never runs and the error propagates.

#### Almost the answer

```ts
m.up(store, ctx);                                   // may throw: nothing is recorded
done[m.version] = { name: m.name, applied_at: ctx.now() };
```

### Section: a store migrated by a newer application is refused

#### What the test wants

A store that records migration 3, given an application that knows 1 and 2: `applyDataMigrations` throws an error containing "newer".

#### Where to look

The top of `applyDataMigrations`. Data written by a newer version may have a shape this version does not understand, so running on would be unsafe.

#### Plan

1. `newest` = the highest recorded version (`Object.keys(store.data_migrations).map(Number)`).
2. `known` = the highest version in the list given.
3. `newest > known`: throw before running anything.

#### Almost the answer

```ts
const known = Math.max(0, ...migrations.map((m) => m.version));
const newest = Math.max(0, ...Object.keys(done).map(Number));
if (newest > known) throw new Error(`The stored data (data migration ${newest}) is newer than this application (${known})`);
```

### Section: applied data migrations are persisted with the data

#### What the test wants

After migration 1 ran on a SQLite store that was committed and closed, reopening the file and applying again runs nothing.

#### Where to look

Nothing new in the code: this passes once `data_migrations` is in `RECORD_COLLECTIONS` **and** has a table. The record is just another collection.

#### Plan

1. A new SQLite migration creating the `data_migrations` table (never edit an old one).

#### Almost the answer

```ts
{ version: 7, name: 'idempotency and data migrations', up: () => ['idempotency', 'data_migrations'].map(table).join('\n') },
```

### Section: webhook secrets are encrypted in the store and absent from every serialised form

#### What the test wants

With a secret box, a created webhook returns a `whsec_` secret once; the stored record has no `secret` property and a `secret_enc` starting `enc:v1:`; the plaintext appears nowhere in `JSON.stringify(store.toJSON())` or in the audit trail; listings expose neither `secret` nor `secret_enc`.

#### Where to look

This is what step 34 already does if you encrypted from the start. Check the audit trail: if you record the creation of a webhook, record `{ id, owner, url, events }`, never the object that carries the secret (audit entries are copied into the store, and the chain makes them permanent).

#### Plan

1. `create` stores `secret_enc` only.
2. Anything you pass to `audit.record` must be free of the secret.

#### Almost the answer

```ts
this.audit.record(input.actor, 'create_webhook', null, null, { id: hook.id, owner: hook.owner, url: hook.url, events: hook.events });   // no secret
```

### Section: legacy plaintext secrets are encrypted automatically when the log starts

#### What the test wants

A store holding a webhook with a plaintext `secret` field: when a log is built over it, the `secret` field is gone and `log.webhookSecret(hook)` still returns the original secret.

#### Where to look

Two places. The migration itself in `src/storage/data-migrations.ts`: for every webhook with a plaintext `secret`, store `secret_enc = ctx.secretBox.encrypt(secret, hook.id)` and delete `secret`. And a place that runs migrations when the application starts: the constructor of `DecisionLog` in `src/decision-log/decision-log.ts`. Nest builds it while the test module compiles, so by the time `buildLog` returns, the migrations have run. `webhookSecret(hook)` is `WebhooksService.secret(hook)`: decrypt `secret_enc` with the hook's id.

#### Plan

1. Migration 1: loop over `store.webhooks`, skip rows without a string `secret`.
2. `DecisionLog` constructor: `applyDataMigrations(ctx.store, { now: () => ctx.now(), secretBox: ctx.secretBox }, DATA_MIGRATIONS)`.
3. `WebhooksService.secret(hook)`: `this.ctx.secretBox.decrypt(hook.secret_enc, hook.id)`.

#### Almost the answer

```ts
// data-migrations.ts
up(store, ctx) {
  for (const hook of store.webhooks) {
    if (typeof hook.secret !== 'string') continue;
    hook.secret_enc = ctx.secretBox!.encrypt(hook.secret, hook.id);
    delete hook.____;
  }
}

// decision-log.ts, in the constructor body
applyDataMigrations(ctx.store, { now: () => ctx.now(), secretBox: ctx.secretBox });
```

### Section: rotation re-encrypts everything under the current key

#### What the test wants

A secret written under an old key is readable by a log whose box holds `[newKey, oldKey]`. `rotateSecrets()` returns `{ rotated: 1 }`; running it again returns `{ rotated: 0 }`; a log started with only the new key can still read it.

#### Where to look

`rotateSecrets` in `src/decision-log/webhooks/webhooks.service.ts`, using `needsRotation` from step 33.

#### Plan

1. For each webhook whose `secret_enc` needs rotation: decrypt it (with the hook's id) and encrypt it again (the current key encrypts).
2. Count the rewritten ones; return `{ rotated }`.
3. A second run finds nothing to do: that is what makes it safe to repeat.

#### Almost the answer

```ts
rotateSecrets() {
  const box = this.ctx.secretBox;
  let rotated = 0;
  for (const hook of this.ctx.store.webhooks) {
    if (!box.needsRotation(hook.secret_enc)) continue;
    hook.secret_enc = box.encrypt(box.decrypt(hook.secret_enc, hook.id), hook.id);
    rotated++;
  }
  return { rotated };
}
```

### Section: a persistent store requires an explicit secret box; memory stores get an ephemeral one

#### What the test wants

Building a log over a SQLite store without a `secretBox` is refused (the error mentions `SECRETS_KEY` or `secretBox`). With a box, the committed `webhooks` table never contains the plaintext secret. A log with no store and no box still works: creating a webhook returns a secret.

#### Where to look

The `DecisionLog` constructor again, before the migrations run. The ephemeral box for memory stores is the `LogContext.secretBox` getter from step 34. A random key that vanishes with the process would make a persisted secret unreadable after a restart, so persistent stores must bring their own.

#### Plan

1. In the constructor: `ctx.store.persistent && !ctx.options.secretBox` throws an `Error` naming `SECRETS_KEY` and `secretBox`.
2. Then the migrations.
3. The plaintext-in-file check passes by itself once secrets are stored encrypted.

#### Almost the answer

```ts
constructor(/* ... */) {
  if (ctx.store.persistent && !ctx.options.secretBox) {
    throw new Error('A persistent store needs a secret box: set SECRETS_KEY (or pass options.secretBox)');
  }
  applyDataMigrations(ctx.store, { now: () => ctx.now(), secretBox: ctx.secretBox });
}
```

## Common mistakes

- Recording a migration before running it: a failure then leaves it marked as done.
- Sorting the caller's array in place instead of a copy.
- Editing `DATA_MIGRATIONS[0]` after it shipped, instead of appending a version 2.
- Putting the secret into an audit entry: the audit trail is copied into every dump and is permanent.
- Running migrations before checking for the secret box: the migration needs the box.
- Forgetting the `data_migrations` table: the SQLite persistence section fails.
