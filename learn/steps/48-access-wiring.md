# 48 · One policy for every check

## Goal

Make the services use the policy instead of their own `role === 'lead'` checks, without changing any behaviour, and let callers ask "may I?" without doing the thing.

## You'll learn

- Refactoring under test: steps 09 and 17 stay green while their checks move
- Loading facts in a service, comparing them in a pure function → `learn/concepts/authorization-models.md`
- Errors that carry a machine-readable reason → `learn/concepts/errors.md`

## Where

- `src/decision-log/core/access.service.ts` (`check`)
- `src/decision-log/decisions/decisions.service.ts` (`can`, and the permission check inside `perform`)
- `src/decision-log/teams/teams.service.ts` (`addMember`)

Needs steps 09, 17 and 19 done; steps 46 and 47 give you the pieces.

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

`AccessService.check(actor, team, action, resourceOwner?)` only gathers the facts: the actor's role in `team` (or `null`), whether the actor is the org admin (`isOrgAdmin`), and the resource owner. Then it returns `authorize(...)`.

### Hint 2

In `perform`, map each action name to a policy action (`approve` to `decision:approve`, `decline` and `request_revision` to `decision:decline`, `propose` to `decision:propose`, and so on). Actions with no entry in the map keep their old behaviour. Voting-mode projects treat `approve` as a vote, so they map it to `decision:vote`.

### Hint 3

When the verdict is a refusal, throw `FORBIDDEN` 403 with `{ reason: verdict.reason }` as the details. `DecisionLogError` takes the details as its fourth argument. The check still comes **before** the state check.

### Hint 4

`can(id, actor, action)` is `load` (404), then `check`. It must not audit and must not change the decision. The "same answer" spec is your safety net: run it before and after the refactor.

## Common mistakes

- Putting the state in the policy. Permission is checked before state on purpose (a stranger learns nothing about the decision), so `INVALID_STATE` stays in `perform`.
- Leaving the old checks in place "just in case". Two sources of truth is what this step removes; delete them once the specs are green.
- Giving outsiders a more detailed reason than `not_a_member`.
- Changing what the org admin may do in voting modes. Existing specs for levels 5 and 6 must stay green.
