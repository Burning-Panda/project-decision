# 29 · Follow-ups and todo lists

## Goal

Follow-ups become todos: assignment, validation, per-user lists with filters, sorting and paging, completion, and the derived `overdue` status.

## You'll learn

- Derived state (overdue is computed, never stored)
- Sorting by different keys
- Paging with a total

## Where

- `src/decision-log/followups/followups.service.ts`
- New collection `followups` (ARRAY)

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

A todo is overdue when `due_date < today` and it is not completed. Compute it when listing; reject it as an input status.

### Hint 2

Priority order is high, medium, low. Page after filtering and sorting; `total` counts before paging.
