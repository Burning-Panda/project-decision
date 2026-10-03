# 16 · Proposing: locking content with a hash

## Goal

Implement the first action, `propose`: lock the content with a SHA-256 hash, keep a snapshot as version 1, and move the decision to `proposed`. All actions go through `perform`, which answers with the same envelope every time.

## You'll learn

- Hashing → `learn/concepts/hashing.md`
- States and actions → `learn/concepts/state-machines.md`
- One response shape for every action

## Where

- `src/decision-log/decisions/decisions.service.ts` (`perform`, `versions`)
- `src/decisions/dto/perform-action.dto.ts` (action names and payloads)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: propose locks content, hashes it with sha256 and snapshots revision 1

#### What the test wants

Proposing answers `{ success: true, status_code: 200, action_performed: 'propose', decision, metadata, data }`. The decision is `proposed`, has a 64-character hex `content_hash`, `proposed_at`, `immutable_from` and `current_revision: 1`, and its `updated_at` moved. `metadata` has `previous_state: 'draft'`, `new_state: 'proposed'`. `getVersions` returns one version.

#### Where to look

`perform` and `versions` in `src/decision-log/decisions/decisions.service.ts`. Hash with `new Bun.CryptoHasher('sha256').update(text).digest('hex')`. Keep versions in a new Map collection `revisions` (add it, and migration 3).

#### Plan

1. `perform`: load the decision, then `switch (request.action)` with a `propose` case calling a private `propose` method; other names come in step 17.
2. `propose`: hash the content, set the new fields and status, store a version `{ decision_id, version, content, content_hash, outcome: null, reason: null }` in `revisions`.
3. Audit `propose` with `{ status: 'draft' }` before and `{ status: 'proposed' }` after, passing `{ ip: opts.ip }`.
4. Return the envelope.
5. `versions(id)`: the decision's versions sorted by number, each with `current: version === current_revision`.

#### Almost the answer

```ts
perform(id, actor, request, opts = {}) {
  const d = this.load(id);
  switch (request.action) {
    case 'propose': return this.propose(d, actor, request.payload ?? {}, opts);
    default: throw new DecisionLogError('UNKNOWN_ACTION', `unknown action ${request.action}`, 400);
  }
}

private propose(d, actor, payload, opts) {
  const previous = d.status;
  const now = this.ctx.now();
  d.content_hash = new Bun.CryptoHasher('sha256').update(d.content).digest('hex');
  d.status = 'proposed';
  d.proposed_at = now;
  d.immutable_from = ____;
  d.current_revision = (d.current_revision ?? 0) + 1;
  d.updated_at = now;
  this.ctx.store.revisions.set(`${d.id}/v${d.current_revision}`, { decision_id: d.id, version: d.current_revision, content: d.content, content_hash: d.content_hash, outcome: null, reason: null });
  this.audit.record(actor, 'propose', d.id, { status: previous }, { status: d.status }, { ip: opts.ip });
  return { success: true, status_code: 200, action_performed: 'propose', decision: d, metadata: { previous_state: previous, new_state: ____, timestamp: now }, data: {} };
}
```

### Section: propose may carry final content; only the owner may propose

#### What the test wants

Someone other than the owner proposing: `FORBIDDEN`. When the payload has `content`, the decision is proposed with that content (and that is what gets hashed).

#### Where to look

The private `propose` method.

#### Plan

1. First line: not the owner, `FORBIDDEN`.
2. If `payload.content` is given, set it **before** hashing.

#### Almost the answer

```ts
if (d.owner !== actor) throw ____;
if (payload.content !== undefined) d.content = payload.content;
// ...then hash
```

### Section: content cannot be edited or deleted once proposed

#### What the test wants

After proposing, editing the content is `IMMUTABLE_CONTENT` 409, and deleting is `INVALID_STATE` 409.

#### Where to look

`updateDraft` and `deleteDraft` from step 15: add a state check after the owner check.

#### Plan

1. `updateDraft`: status is not `draft`, throw `IMMUTABLE_CONTENT`.
2. `deleteDraft`: status is not `draft`, throw `INVALID_STATE`.

#### Almost the answer

```ts
// updateDraft
if (d.status !== 'draft') throw new DecisionLogError('IMMUTABLE_CONTENT', 'content is locked once proposed', ____);
// deleteDraft
if (d.status !== 'draft') throw new DecisionLogError(____, 'only drafts can be deleted', 409);
```

## Common mistakes

- "updated_at moves" fails although you set `updated_at`: `create` returned the stored object, so the test's copy moved too. Return `structuredClone(decision)` from `create` (step 14).
- Hashing before applying `payload.content`: the hash would not match the content.
- Storing a reference to the decision as the version: later edits would change history. Store the content string.
- Forgetting the `revisions` collection or its migration.
