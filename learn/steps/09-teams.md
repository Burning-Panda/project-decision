# 09 · Permissions: teams and members

## Goal

Implement `TeamsService.create` and `addMember`, and the two rules in `AccessService` they rely on.

## You'll learn

- Authorization as small, pure rule functions
- Update-or-insert (a member added twice changes role, not duplicates)
- Validating against a fixed set of values

## Where

- `src/decision-log/teams/teams.service.ts`
- `src/decision-log/core/access.service.ts`
- `src/decision-log/teams/team.ts` (roles)

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

`isOrgAdmin(actor, owner)` is simply `actor === owner`: the owner identifier acts as organisation admin.

### Hint 2

`isTeamAdmin` is the org admin or a member whose role is `admin`. Check permission before validation where the spec expects FORBIDDEN.

### Hint 3

Use `this.owners.require(owner)` for NOT_FOUND on unknown owners; `team` defaults to `default`; `role` defaults to `member`.
