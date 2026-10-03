# 15 · Editing and deleting drafts

## Goal

Let the owner edit and delete drafts.

## You'll learn

- Ownership checks
- Deciding which timestamps a change moves

## Where

- `src/decision-log/decisions/decisions.service.ts` (`updateDraft`, `deleteDraft`)

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Only the owner (FORBIDDEN otherwise). Content edits do not move `updated_at`; state changes do (see step 16).

### Hint 2

Deleting removes the decision, so `get` then throws NOT_FOUND.
