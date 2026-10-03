# 19 · Who may see what

## Goal

Make reads respect teams: outsiders see nothing, members see their team's decisions, the org identifier sees everything.

## You'll learn

- Centralising a read rule so every read path uses it
- Default deny

## Where

- `src/decision-log/core/access.service.ts`
- `src/decision-log/decisions/decisions.service.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Write one helper that loads a decision for an actor and throws FORBIDDEN unless the actor is the org admin or a member of the decision's team. Use it in every read.

### Hint 2

Comments and versions are read paths too: `listComments` can check access and return `[]` until comments exist (step 26).
