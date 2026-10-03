# 25 · An algorithm: diffing markdown by section

## Goal

Diff two versions of a decision section by section: which lines were added and removed under which heading path.

## You'll learn

- Parsing markdown headings into a tree
- Set difference on lines

## Where

- `src/decision-log/decisions/decisions.service.ts` (`diff`)
- `src/decisions/dto/diff-query.dto.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Walk the lines keeping a heading stack; a line belongs to the path `Consequences > Negative`.

### Hint 2

For each path compare the line sets of both versions; leave out sections with no changes. `v1` and `1` both mean version 1.
