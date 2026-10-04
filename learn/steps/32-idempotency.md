# 32 · Idempotency: safe retries

## Goal

Make retries safe: a request sent twice with the same idempotency key is performed once and answered with the original response, and a key reused for a different request is refused.

## You'll learn

- Idempotency: why a network retry must not vote twice
- Fingerprinting a request
- Storing a response to replay it

## Where

- `src/decision-log/decisions/decisions.service.ts` (`perform`; the key arrives as `opts.idempotencyKey`)
- New RECORD collection `idempotency` in `src/storage/store.ts` and a new SQLite migration

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: idempotency keys make retries safe

#### What the test wants

Bob votes with key `K`; the same vote replayed with `K` answers the same tally with `idempotent_replay: true` (the first answer has no such field), and only one `vote` is audited. A follow-up assigned twice with the same key leaves carol one todo.

#### Where to look

`perform` in `src/decision-log/decisions/decisions.service.ts`: `opts` is the fourth argument and may hold `idempotencyKey`. You need somewhere to remember keys: a RECORD collection (an object, key to document) named `idempotency`. Add it to `RECORD_COLLECTIONS` and add a migration with its table (the storage specs fail until you do).

#### Plan

1. Rename today's `perform` to a private `execute` and write a small `perform` around it.
2. No key: just call `execute`.
3. With a key: look it up in `this.ctx.store.idempotency`. Found and the request is the same: return a **copy** of the stored response with `idempotent_replay: true`, without running anything (so nothing is audited or notified twice).
4. Not found: run `execute`, store `{ fingerprint, response: structuredClone(response) }`, return the response.
5. Errors are not stored: a refused request may be retried.
6. The lookup comes before every check: after the first call the state has moved on (a closed decision would answer 409), but a replay must answer what the first call answered.

#### Almost the answer

```ts
perform(id: string, actor: string, request: PerformActionDto, opts: Record<string, any> = {}) {
  const key: string | undefined = opts.idempotencyKey;
  if (!key) return this.execute(id, actor, request, opts);
  const fingerprint = sha256(JSON.stringify({ id, actor, action: request.action, payload: request.payload ?? {} }));
  const seen = this.ctx.store.idempotency[key];
  if (seen) {
    /* a different fingerprint: next section */
    return { ...structuredClone(seen.response), idempotent_replay: ____ };
  }
  const response = this.execute(id, actor, request, opts);
  this.ctx.store.idempotency[key] = { fingerprint, response: structuredClone(response), at: this.ctx.now() };
  return response;
}
```

### Section: an idempotency key cannot be reused for a different request

#### What the test wants

After bob's approve vote with key `K`, sending `K` again with a `request_revision` vote is `CONFLICT` 409, and the original vote still stands (tally approve 1).

#### Where to look

The `seen` branch you just wrote. A key identifies one request, so remember what the request was (the fingerprint: who, which decision, which action, which payload) and compare.

#### Plan

1. In the `seen` branch: when `seen.fingerprint !== fingerprint`, throw `CONFLICT` with status 409.
2. The new request is not executed, so the old vote stays.

#### Almost the answer

```ts
if (seen.fingerprint !== fingerprint) {
  throw new DecisionLogError('CONFLICT', `idempotency key ${key} was used for a different request`, ____);
}
```

## Common mistakes

- Storing the live response object: the decision inside it keeps changing; store `structuredClone(response)`.
- Doing the key lookup after the permission and state checks: the replay then answers 409 instead of the first response.
- Including a timestamp or the `ip` in the fingerprint: a genuine retry would then look like a different request.
- Storing failures: a request that was refused must be retryable.
- Forgetting the new collection's migration (the storage specs name it).
