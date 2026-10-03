# 24 · Revisions: immutable versions

## Goal

Requesting a revision now leaves a record: the version is closed with the reason, the answer says which revision it was, and re-proposing creates the next version. Votes belong to a revision.

## You'll learn

- Versioned history
- Resetting or carrying state across versions

## Where

- `src/decision-log/decisions/decisions.service.ts` (`perform`: `request_revision` and `propose`)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: request_revision needs a reason and a proposed decision; returns 201 with a draft

#### What the test wants

On a draft: `INVALID_STATE`. Without a reason: `VALIDATION_ERROR`. An outsider or the owner: `FORBIDDEN`. The lead with a reason: 201, the decision is a draft, and `data.revision` has `revision_number: 1`, the `reason` and `requested_by`.

#### Where to look

Your `request_revision` branch from step 20. Permission and state checks already happen in `perform`; what is new is `data.revision` and closing the version.

#### Plan

1. Close the current version: `outcome: 'revision_requested'`, `reason`, `requested_by`.
2. Return `data: { revision: { revision_number, reason, suggested_changes, requested_by } }` with the current revision number.

#### Almost the answer

```ts
const version = this.ctx.store.revisions.get(`${d.id}/v${d.current_revision}`);
Object.assign(version, { outcome: 'revision_requested', reason: payload.reason, requested_by: actor });
d.status = 'draft';
statusCode = 201;
data = { revision: { revision_number: ____, reason: payload.reason, suggested_changes: payload.suggested_changes ?? null, requested_by: ____ } };
```

### Section: revision cycle keeps every version immutable and reachable

#### What the test wants

After a revision request, reworking and re-proposing gives `current_revision: 2` and a new hash. Version 1 keeps the original content and hash, `outcome: 'revision_requested'`, its reason and `current: false`. Version 2 has the new content, `outcome: null` and `current: true`.

#### Where to look

Your step 16 `propose` already stores one version per proposal and `versions()` marks the current one. If this fails, check that version 1's content is a string copy (not the decision object) and that `current_revision` increases.

#### Plan

1. `propose` from a draft that was proposed before: `current_revision + 1`, store the new version.
2. `versions()`: sorted by number, `current` only on the latest.

#### Almost the answer

```ts
d.current_revision = (d.current_revision ?? 0) + 1;
this.ctx.store.revisions.set(`${d.id}/v${d.current_revision}`, { decision_id: d.id, version: d.current_revision, content: d.content, content_hash: d.content_hash, outcome: null, reason: ____ });
```

### Section: votes are scoped to a revision and reset on re-proposal by default

#### What the test wants

Two approvals, a revision request, then re-proposing: `getDecision(...).votes` is empty and `vote_tally.approve` is 0.

#### Where to look

In `propose`: when this is a re-proposal and `revision_vote_resets_count` is true (the default), clear `d.votes` and recount the tally.

#### Plan

1. A re-proposal is one where `current_revision` is already above 0.
2. If the setting is on, `d.votes = []`.
3. Recount `d.vote_tally`.

#### Almost the answer

```ts
if ((d.current_revision ?? 0) > 0 && settings.revision_vote_resets_count) d.votes = ____;
// ...after the other changes
d.vote_tally = this.tally(d);
```

### Section: with revision_vote_resets_count=false approvals carry over

#### What the test wants

With the setting off, both approvals are still counted after re-proposing, and one more approval (the third) approves the decision.

#### Where to look

The same line: only clear the votes when the setting is on. The votes from revision 1 then count for revision 2.

#### Plan

1. Keep `d.votes` when `revision_vote_resets_count` is false.

#### Almost the answer

```ts
if ((d.current_revision ?? 0) > 0 && settings.____) d.votes = [];
```

## Common mistakes

- Clearing the votes on the revision request instead of on re-proposal.
- Storing the decision object as the version: reworking it would rewrite history.
