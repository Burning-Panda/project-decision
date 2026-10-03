# 04 · A pure function: building a project record

## Goal

Implement `Project.create` and `Project.resolveSettings`: pure functions that validate input and build a project record. No store, no clock: everything they need is passed in.

## You'll learn

- Pure functions: same input, same output, nothing else touched
- Validation with a typed error: `DecisionLogError(code, message, status)`
- Defaults and merging objects without mutating the input

## Where

- `src/decision-log/projects/project.ts`
- `src/common/errors.ts` (`DecisionLogError`)
- `src/admin/dto/approval-settings.dto.ts` (every setting and its allowed values)

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Invalid input throws `new DecisionLogError('VALIDATION_ERROR', message, 400)`. Every rejection case is a GIVEN in "Project.create rejects invalid input".

### Hint 2

Collect the defaults from the THENs: mode `single_approval`, team `default`, description `''`, active, counts 0, `consensus_approval_threshold` 0.8, `consensus_min_votes` 3, `allow_abstain`, `require_reason_on_revision`, `notification_on_vote` and `revision_vote_resets_count` true, `auto_approve_after_days` null, every role weighing 1.

### Hint 3

`enabled_voting` follows the mode (false only for `single_approval`). Recompute it whenever the mode is set, unless the same input sets `enabled_voting` explicitly: switching consensus back to single approval must turn voting off.

### Hint 4

In `resolveSettings`, build a new object `{ ...defaults, ...current, ...patch }` (vote_weights merged the same way), then validate it. Never assign into `current`.
