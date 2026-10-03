# 14 · Creating decisions: ids, defaults, validation

## Goal

Create decisions: per-project ids (`PRJ-001`), the default template, an owner participant, validation and team membership.

## You'll learn

- Counters that survive restarts
- Adding collections as the model grows (and their migration)
- Formatting ids

## Where

- `src/decision-log/decisions/decisions.service.ts` (`create`, `get`, `participants`)
- `src/storage/store.ts` and `src/storage/migrations/sqlite.ts`
- `src/decisions/dto/create-decision.dto.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Add the collections this needs: `decisions` and `revisions` (MAP), `participants` (ARRAY), `counters` (RECORD). Then add SQLite migration 2 creating their tables; `collections.spec` tells you if one is missing.

### Hint 2

The number comes from the project: increment `last_number` and `decision_count`, id is `` `${project}-${String(n).padStart(3, '0')}` ``.

### Hint 3

Only team members of the project's team may create (FORBIDDEN). Blank titles after `trim()` are VALIDATION_ERROR.

### Hint 4

The default template has the sections `## Context`, `## Decision`, `## Alternatives Considered`, `## Consequences`, `## Follow-up Actions`.
