# 30 · Related decisions and superseding

## Goal

Find related decisions: a pluggable finder (with a default text-similarity one), mentions of other ids, review of suggestions, and the superseding flow.

## You'll learn

- Text similarity: cosine similarity over word counts, and why stop words matter
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

The default finder: lowercase title + content, split into words, drop stop words (`the`, `and`, `for`, ...), count each word. Score = cosine similarity of the two count vectors × 100: the sum of products of shared counts divided by the product of both vectors' lengths. Without the stop words, unrelated decisions score 15-20% similar; with them, 0.

### Hint 4

Superseding: `create_superseding_decision` creates a linked draft; approving it marks the original and adds a `supersedes` link.
