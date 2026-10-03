# 23 · Time-based rules: veto windows and sweeps

## Goal

Veto mode: a proposal auto-approves after N days unless someone vetoes with a reason. `sweep()` applies the rule.

## You'll learn

- Time as an input (the injected clock)
- Idempotent background jobs

## Where

- `src/decision-log/decisions/decisions.service.ts` (`sweep`)

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

A veto is a `request_revision` vote with a reason; it sends the decision back to draft and records the reason on the version.

### Hint 2

`sweep` finds proposed veto-mode decisions older than `auto_approve_after_days` and approves them with no approvers; return their ids.

### Hint 3

Running it again finds nothing, because they are no longer proposed.
