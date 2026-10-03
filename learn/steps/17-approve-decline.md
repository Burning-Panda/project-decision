# 17 · A state machine: approve and decline

## Goal

Turn `perform` into a state machine: approve, decline, return to draft, and errors that tell the caller what is allowed instead.

## You'll learn

- State machines: which action is allowed in which state
- Errors with details (`allowed_actions`, `current_state`, `alternatives`)
- Role-based permissions

## Where

- `src/decision-log/decisions/decisions.service.ts` (`perform`)

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Write a table: state → allowed actions. Use it both to reject (`INVALID_STATE` with `details.allowed_actions`) and to suggest alternatives.

### Hint 2

An unknown action name is UNKNOWN_ACTION 400, before any state check.

### Hint 3

Only a lead or an admin may approve or decline, never the owner. In single approval the lead's approve sets `approved_at` and `approvers: [{ user, approved_at }]`.

### Hint 4

Decline needs a reason and stores it in `decision.decline`, not in the content. Only the owner may `return_to_draft`.
