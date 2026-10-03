# 09 · Permissions: teams and members

## Goal

Implement `TeamsService.create` and `addMember`, and the two permission rules in `AccessService` they rely on.

## You'll learn

- Permission rules as small functions → `learn/concepts/permissions.md`
- Update-or-insert (adding a member twice changes the role)
- Checking against a fixed set of values

## Where

- `src/decision-log/teams/teams.service.ts`
- `src/decision-log/core/access.service.ts`
- `src/decision-log/teams/team.ts` (roles: `member`, `lead`, `admin`)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: TeamsService.create

#### What the test wants

The org admin (the owner identifier itself, `acme`) creates team `payments`: a team of `acme` with no members. Anyone else: `FORBIDDEN` 403. An empty name: `VALIDATION_ERROR` 400. Creating `default` again: `CONFLICT` 409. An owner that does not exist: `NOT_FOUND` 404.

#### Where to look

`TeamsService.create`, plus `AccessService.isOrgAdmin`: the owner identifier acts as organisation admin, so the rule is simply "the actor equals the owner". Use `this.owners.require(owner)` from step 08 for the 404.

#### Plan

1. `this.owners.require(input.owner)` (404).
2. Not org admin: `FORBIDDEN`.
3. Empty name: `VALIDATION_ERROR`.
4. Key already in `store.teams`: `CONFLICT`.
5. Store `{ owner, name, members: [], created_at, updated_at }`, audit, return it.

#### Almost the answer

```ts
// AccessService
isOrgAdmin(actor: string, owner: string) { return actor === ____; }

// TeamsService
create(input) {
  this.owners.require(input.owner);
  if (!this.access.isOrgAdmin(input.actor, input.owner)) throw new DecisionLogError('FORBIDDEN', 'only the org admin creates teams', 403);
  if (!input.name?.trim()) throw ____;
  const key = `${input.owner}/${input.name}`;
  if (this.ctx.store.teams.has(key)) throw ____;
  // build, store, audit, return
}
```

### Section: TeamsService.addMember

#### What the test wants

The org admin adds alice without a role: she is a `member` of `default`. Adding her again as `lead` changes her role instead of adding a second entry. An unknown role or an empty user: `VALIDATION_ERROR`. A plain member adding someone: `FORBIDDEN`. A team that does not exist: `NOT_FOUND`. Members are exactly `{ user, role }`, nothing more.

#### Where to look

`TeamsService.addMember`, plus `AccessService.isTeamAdmin`: the org admin, or a member of that team whose role is `admin`. The team defaults to `default`, the role to `member`.

#### Plan

1. `this.get(owner, team ?? 'default')` (404).
2. Not team admin: `FORBIDDEN`.
3. Check the user and role.
4. If the user is already a member, change the role; otherwise push `{ user, role }`.
5. Update `updated_at`, audit, return the team.

#### Almost the answer

```ts
// AccessService
isTeamAdmin(actor: string, team: Team) {
  return this.isOrgAdmin(actor, team.owner) || team.members.some((m) => m.user === actor && m.role === ____);
}

// TeamsService
addMember(input) {
  const team = this.get(input.owner, input.team ?? 'default');
  if (!this.access.isTeamAdmin(input.actor, team)) throw ____;
  const role = input.role ?? 'member';
  if (!input.user?.trim()) throw ____;
  if (!['member', 'lead', 'admin'].includes(role)) throw ____;
  const existing = team.members.find((m) => m.user === input.user);
  if (existing) existing.role = role; else team.members.push({ user: input.user, role });
  team.updated_at = this.ctx.now();
  return team;
}
```

## Common mistakes

- Adding extra fields to member objects: the spec compares them exactly.
- Validating before checking permission: a non-admin should get `FORBIDDEN`.
- Pushing a duplicate member instead of updating the role.
