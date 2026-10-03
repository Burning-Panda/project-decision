# 39 · Aggregations: dashboard, reports, export

## Goal

Aggregate: the dashboard's four lists, reports (volume, approval metrics, revision cycles, participation, todos, audit) and export as JSON or CSV.

## You'll learn

- Group-by and averages
- CSV escaping
- Admin-only data

## Where

- `src/decision-log/insights/insights.service.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

CSV: quote a field containing a comma, quote or newline, and double the quotes inside it.

### Hint 2

Reports and export are for the org admin; an unknown report or format is VALIDATION_ERROR.
