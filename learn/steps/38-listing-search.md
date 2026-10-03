# 38 · Filtering, sorting, paging and fuzzy search

## Goal

List decisions with filters, sorting and paging, and search content, ids, comments and transcripts with tolerance for typos.

## You'll learn

- Query parameters to filters
- Fuzzy matching (edit distance)
- Ranking exact matches first

## Where

- `src/decision-log/decisions/decisions.service.ts` (`list`)
- `src/decision-log/insights/insights.service.ts` (`search`)

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Default page size 25, maximum 100; newest first unless `sort` says `+created_at`.

### Hint 2

Fuzzy: a query word matches a text word within edit distance 1 (Levenshtein). An exact id match ranks first.

### Hint 3

Only decisions the actor can read appear (step 19).
