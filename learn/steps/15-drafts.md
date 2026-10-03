# 15 · Editing and deleting drafts

## Goal

Let the owner edit and delete drafts.

## You'll learn

- Ownership checks → `learn/concepts/permissions.md`
- Deciding which timestamps a change moves → `learn/concepts/dates-and-clock.md`

## Where

- `src/decision-log/decisions/decisions.service.ts` (`updateDraft`, `deleteDraft`)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: drafts are editable by the owner only; updated_at does not move on content edits

#### What the test wants

The owner edits title and content of a draft one hour old: both change, but `updated_at` stays the same (it moves on state changes, from step 16). Anyone else editing: `FORBIDDEN`.

#### Where to look

`updateDraft` in `src/decision-log/decisions/decisions.service.ts`. Write a small private helper that loads a decision or throws `NOT_FOUND`; you will use it everywhere.

#### Plan

1. Load the decision.
2. The actor is not the owner: `FORBIDDEN`.
3. Apply `title` and `content` when given. Leave `updated_at` alone.
4. Return the decision.

#### Almost the answer

```ts
private load(id: string) {
  const decision = this.ctx.store.decisions.get(id);
  if (!decision) throw new DecisionLogError('NOT_FOUND', `decision ${id} not found`, 404);
  return decision;
}

updateDraft(id, actor, patch) {
  const d = this.load(id);
  if (d.owner !== actor) throw ____;
  if (patch.title !== undefined) d.title = patch.title;
  if (patch.content !== undefined) d.content = ____;
  return d;
}
```

### Section: only drafts can be deleted, and only by their owner

#### What the test wants

Someone other than the owner deleting: `FORBIDDEN`. The owner deleting: afterwards `getDecision` throws `NOT_FOUND`.

#### Where to look

`deleteDraft`. Also lower the project's `decision_count` (a later persistence spec checks it); leave `last_number` alone, so numbers are never reused.

#### Plan

1. Load; not the owner: `FORBIDDEN`.
2. Delete it from `this.ctx.store.decisions`.
3. `decision_count -= 1` on its project, audit `delete`.

#### Almost the answer

```ts
deleteDraft(id, actor) {
  const d = this.load(id);
  if (d.owner !== actor) throw ____;
  this.ctx.store.decisions.delete(id);
  this.projects.get(d.project).decision_count -= ____;
  this.audit.record(actor, 'delete', id, d, null);
}
```

## Common mistakes

- Moving `updated_at` on content edits: the spec says it must stay.
- Reusing a number after a delete by lowering `last_number`.
