# 08 · A service with state and typed errors: owners

## Goal

Implement `OwnersService.create` and `require`. Creating an owner also creates its empty `default` team, so implement `TeamsService.get` too, and a first, simple `AuditService.record`.

## You'll learn

- A service that keeps state in the shared store → `learn/concepts/services-and-injection.md`
- Typed errors (`VALIDATION_ERROR`, `CONFLICT`, `NOT_FOUND`) → `learn/concepts/errors.md`
- Times from the injected clock → `learn/concepts/dates-and-clock.md`

## Where

- `src/decision-log/owners/owners.service.ts` and `owner.ts` (the `Owner` shape)
- `src/decision-log/teams/teams.service.ts` (`get`) and `team.ts`
- `src/decision-log/core/audit.service.ts` (`record`)
- `src/decision-log/core/log-context.ts` (`this.ctx.store`, `this.ctx.now()`)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: OwnersService.create

#### What the test wants

Creating `acme` with a name and email returns an owner with those fields and `created_at` equal to `updated_at`. Afterwards `TeamsService.get('acme')` returns a team with no members. With only an identifier, the name is the identifier and the email is `null`. No identifier: `VALIDATION_ERROR` 400. Creating `acme` twice: `CONFLICT` 409. `require('acme')` returns it; `require` of an unknown owner: `NOT_FOUND` 404.

#### Where to look

Owners go in `this.ctx.store.owners` (a Map keyed by identifier). `TeamsService` already depends on `OwnersService`, so `OwnersService` cannot use `TeamsService` (that would be a cycle): write the default team straight into `this.ctx.store.teams`. Teams need a key that includes the owner, such as `acme/default`, and `TeamsService.get` must use the same key.

#### Plan

1. `create`: check the identifier, check it is not taken, build the owner with `this.ctx.now()`, store it, store the default team, record an audit entry, return the owner.
2. `require`: look it up, throw `NOT_FOUND` when missing.
3. `TeamsService.get(owner, name)`: look up `` `${owner}/${name}` ``, throw `NOT_FOUND` when missing.
4. `AuditService.record`: for now just push an entry onto `this.ctx.store.audit` and return it (level 7 makes it a hash chain).

#### Almost the answer

```ts
create(input: CreateOwnerDto): Owner {
  const identifier = input.identifier?.trim();
  if (!identifier) throw new DecisionLogError('VALIDATION_ERROR', 'identifier is required', 400);
  const owners = this.ctx.store.owners;
  if (owners.has(identifier)) throw new DecisionLogError(____, `owner ${identifier} already exists`, ____);
  const now = this.ctx.now();
  const owner: Owner = { identifier, name: input.name ?? identifier, email: ____, created_at: now, updated_at: now };
  owners.set(identifier, owner);
  this.ctx.store.teams.set(`${identifier}/default`, { owner: identifier, name: 'default', members: [], created_at: now, updated_at: now });
  this.audit.record(identifier, 'create_owner', null, null, owner);
  return owner;
}

// AuditService
record(actor, action, decisionId, before, after, extra = {}) {
  const audit = this.ctx.store.audit;
  const entry = { seq: audit.length + 1, at: this.ctx.now(), actor, action, decision_id: decisionId, before, after, ip: extra.ip ?? null, detail: extra.detail ?? null, prev_hash: '', hash: '' };
  audit.push(entry);
  return entry;
}
```

## Common mistakes

- Using `new Date()` instead of `this.ctx.now()`: tests control the clock.
- Injecting `TeamsService` into `OwnersService`: Nest cannot build services that need each other.
- Different team keys in `create` and `TeamsService.get`.
- Forgetting to import `DecisionLogError` from `../../common/errors`.
