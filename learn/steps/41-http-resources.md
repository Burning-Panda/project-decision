# 41 · The rest of the resources

## Goal

Expose the remaining resources: comments, participants, versions, diff, todos, search, reports, admin, owners, teams, projects, document, related, integrity, dashboard, notifications, export.

## You'll learn

- Consistent response shapes
- Non-JSON responses (markdown, CSV)

## Where

- `src/decisions/`, `src/todos/`, `src/insights/`, `src/admin/`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Collections come back under a named key (`{ comments }`), paged lists as `{ items, total }`.

### Hint 2

`/document` is `text/markdown`; `/export?format=csv` is `text/csv`.
