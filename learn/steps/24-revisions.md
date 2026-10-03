# 24 · Revisions: immutable versions

## Goal

Request a revision (201, back to draft, revision 1 records why), re-propose as revision 2, and handle votes across revisions.

## You'll learn

- Versioned history
- Resetting vs carrying state across versions

## Where

- `src/decision-log/decisions/decisions.service.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Requesting a revision closes the current version with `outcome: 'revision_requested'` and the reason.

### Hint 2

Votes belong to a revision: with `revision_vote_resets_count` (default) only the current revision counts; otherwise approvals carry over.
