# 08 · A service with state and typed errors: owners

## Goal

Implement `OwnersService.create` and `require`. Creating an owner also creates its empty `default` team, so implement `TeamsService.get` too, and the simplest `AuditService.record`.

## You'll learn

- A service that reads and writes shared state (`this.ctx.store`)
- Typed errors: VALIDATION_ERROR 400, CONFLICT 409, NOT_FOUND 404
- Timestamps from the injected clock (`this.ctx.now()`)

## Where

- `src/decision-log/owners/owners.service.ts`
- `src/decision-log/teams/teams.service.ts` (`get`)
- `src/decision-log/core/audit.service.ts` (`record`)
- `src/decision-log/core/log-context.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Store owners in `this.ctx.store.owners` keyed by identifier. Name falls back to the identifier, email to null; `created_at` and `updated_at` are the same `now`.

### Hint 2

Teams need a key that includes the owner, e.g. `` `${owner}/${name}` ``. `TeamsService.get` throws NOT_FOUND when absent.

### Hint 3

For now `AuditService.record` can just push `{ seq, at, actor, action, decision_id, before, after, ip, detail }` onto `store.audit`. Level 7 turns it into a hash chain.
