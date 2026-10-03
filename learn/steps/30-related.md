# 30 · Related decisions and superseding

## Goal

Find related decisions: a pluggable finder (with a default text-similarity one), mentions of other ids, review of suggestions, and the superseding flow.

## You'll learn

- Text similarity (shared words)
- Injectable strategies (`relatedFinder` option)
- Not resurrecting dismissed suggestions

## Where

- `src/decision-log/related/related.service.ts`
- `src/decision-log/decisions/decisions.service.ts`
- New collection `relationships` (ARRAY)

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Run the finder on create, draft save and propose. Keep results scoring at least the threshold (default 60).

### Hint 2

Key links by (decision, related decision): a rescan updates instead of duplicating, and a dismissed link stays dismissed.

### Hint 3

A simple default finder: compare word sets of title+content (Jaccard similarity × 100).

### Hint 4

Superseding: `create_superseding_decision` creates a linked draft; approving it marks the original and adds a `supersedes` link.
