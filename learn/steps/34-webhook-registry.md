# 34 · Registering webhooks safely

## Goal

Register webhooks: org admins only, a signing secret shown exactly once (stored encrypted), event filters validated, and URLs checked so a webhook cannot be pointed at a private or internal address.

## You'll learn

- Never returning a secret after creation
- SSRF: why the server must not call `http://169.254.169.254` for a user
- Soft deletes (again) and admin-only rules

## Where

- `src/decision-log/webhooks/webhooks.service.ts` (`create`, `list`, `remove`)
- New `src/webhooks/targets.ts` (the URL check; step 43 reuses it at delivery time)
- `src/decision-log/core/log-context.ts` (a `secretBox` getter)
- New collection `webhooks` (ARRAY) in `src/storage/store.ts` and a new SQLite migration

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: org admins register webhooks; the secret is shown once and never listed

#### What the test wants

The org admin creates a webhook: the answer has a `whsec_` + 48 hex characters `secret`, the `events` (default `["*"]`) and `active: true`. The lead creating one is `FORBIDDEN`, and a plain member listing them is `FORBIDDEN`. Listing shows the webhook without any secret.

#### Where to look

`src/decision-log/webhooks/webhooks.service.ts` `create` and `list`. "Org admin" is `this.access.isOrgAdmin(actor, owner)` (`AccessService` is already injected). The secret is stored **encrypted**, with the webhook's id as the record id, so add a `secretBox` getter to `LogContext` that returns `options.secretBox` or, when none was given, a random box that lives as long as the process (`new SecretBox({ keys: [32 random bytes] })`). Step 36 refuses that fallback for persistent stores.

#### Plan

1. Add `webhooks` to `ARRAY_COLLECTIONS` and a **new** migration for its table.
2. `create`: owner must exist (`NOT_FOUND`), actor must be the org admin (`FORBIDDEN`), then validate (next section).
3. Id `webhook-001`, `webhook-002`, ... Secret: `whsec_` + 24 random bytes as hex.
4. Store `{ id, owner, url, events, secret_enc, active: true, created_by, created_at, deleted_at: null }`. The plaintext is never stored.
5. Return the stored fields **plus** `secret` once. `list` returns the owner's webhooks (org admin only) without `secret_enc`.

#### Almost the answer

```ts
// log-context.ts
get secretBox(): SecretBox {
  return this.options.secretBox ?? (this.ephemeral ??= new SecretBox({ keys: [Buffer.from(crypto.getRandomValues(new Uint8Array(32)))] }));
}

// webhooks.service.ts
private view({ secret_enc: _enc, ...rest }: any) { return structuredClone(rest); }

create(input) {
  /* owner exists, actor is org admin, url and events valid */
  const id = `webhook-${String(hooks.length + 1).padStart(3, '0')}`;
  const secret = `whsec_${Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('hex')}`;
  const hook = { id, owner: input.owner, url: input.url, events, secret_enc: this.ctx.secretBox.encrypt(secret, ____),
    active: true, created_by: input.actor, created_at: this.ctx.now(), deleted_at: null };
  hooks.push(hook);
  return { ...this.view(hook), secret };
}
```

### Section: webhook URLs and event filters are validated

#### What the test wants

These URLs are `VALIDATION_ERROR` 400: `ftp://...`, `not a url`, a URL with `user:pw@`, `127.0.0.1`, `localhost`, `10.1.2.3`, `192.168.0.5`, `172.16.0.1`, `[::1]`, `169.254.169.254` and `service.internal`. These event lists are too: an unknown event (`decision.exploded`), an unknown family (`nope.*`), an empty list, a bare string. With `allowPrivateTargets` switched on, `http://localhost:9000/hook` is accepted.

#### Where to look

Put the URL check in its own file, `src/webhooks/targets.ts`, as plain functions: step 43 needs the same rule again at delivery time. The events: `*`, an exact event name, or a family wildcard (`decision.*`). The known events are in the README's webhook section and below.

#### Plan

1. `assertAllowedUrl(text, allowPrivate)`: parse with `new URL` (a failure is a `VALIDATION_ERROR`); protocol must be `http:` or `https:`; no username or password.
2. Unless `allowPrivate`: refuse the host `localhost`, names ending `.internal`, and private addresses: IPv4 `0.x`, `10.x`, `127.x`, `169.254.x`, `172.16-31.x`, `192.168.x`; IPv6 `::1`, `::`, `fe80:`, `fc..`/`fd..`. For `[::1]` the parsed `hostname` still has its brackets: strip them.
3. `allowPrivate` is `this.ctx.options.allowPrivateTargets` (the facade's `allowPrivateTargets` setter writes it).
4. Events: must be a non-empty array; each is `*`, in the known list, or `<family>.*` for a known family (`decision`, `comment`, `followup`, `meeting`).

#### Almost the answer

```ts
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase();
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === ____ && b === 168);
  }
  return ip === '::1' || ip === '::' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd');
}

export function assertAllowedUrl(text: string, allowPrivate: boolean): URL {
  let url: URL;
  try { url = new URL(text); } catch { throw invalid('url is not valid'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid('url must be http or https');
  if (url.username || url.password) throw invalid('url must not contain credentials');
  const host = url.hostname.toLowerCase();
  if (!allowPrivate && (host === 'localhost' || host.endsWith('.internal') || isPrivateAddress(host))) throw invalid('private target');
  return url;
}

// events: decision.created, decision.proposed, decision.vote_received, decision.approved, decision.declined,
// decision.revision_requested, decision.returned_to_draft, decision.superseded, comment.created,
// followup.assigned, followup.completed, meeting.recorded
const EVENT_TYPES = [/* the twelve above */];
```

### Section: webhooks can be removed by admins only; removed hooks disappear from listings

#### What the test wants

The lead deleting a webhook is `FORBIDDEN`. After the org admin deletes it, `listWebhooks` is empty. Deleting `webhook-999` is `NOT_FOUND`.

#### Where to look

`remove`. Do not delete the row: later steps keep its events and deliveries, and the legacy record shape already has a `deleted_at` field. Mark it instead.

#### Plan

1. Find the webhook that is not already deleted (404).
2. Org admin of its owner only (403).
3. Set `active = false` and `deleted_at = now`; return it without secrets.
4. `list` skips rows with `deleted_at`.

#### Almost the answer

```ts
remove(id: string, actor: string) {
  const hook = this.ctx.store.webhooks.find((h) => h.id === id && !h.deleted_at);
  if (!hook) throw new DecisionLogError('NOT_FOUND', `webhook ${id} not found`, 404);
  if (!this.access.isOrgAdmin(actor, hook.owner)) throw new DecisionLogError('FORBIDDEN', 'only the org admin manages webhooks', 403);
  hook.active = false;
  hook.deleted_at = ____;
  return this.view(hook);
}
```

## Common mistakes

- Returning `secret_enc` (or the plaintext) from `list`: the test here only checks `secret`, step 36 checks `secret_enc` too.
- Storing the plaintext "just for now". Encrypt from the first commit; step 36 only has to migrate data written before you did.
- Forgetting the brackets on IPv6 hosts (`[::1]`), or that `172.16.0.0/12` means 16 to 31, not just 16.
- Validating the URL before checking the actor: a non-admin should get `FORBIDDEN` whatever the URL.
- Hard-deleting the webhook.
- Missing migration for the new `webhooks` collection.
