# Decision Log

Immutable decision tracking with an approval workflow, voting modes, revisions/diffs, comments,
meeting transcripts, follow-up todos, related-decision discovery and a hash-chained audit trail.

Built with [NestJS](https://nestjs.com) on [Bun](https://bun.sh). The original dependency-free Node
implementation was ported from `backup/` (kept for reference until the port is complete).

> **Status: migration in progress.** The Nest structure, routes, DTOs and test suite are in place, but
> the domain service, stores, webhook dispatcher and notification manager are still stubs
> (they throw `NOT_IMPLEMENTED` via `src/helpers/errors/todo.ts`). The specs are written first and
> fail until the matching piece is ported from `backup/src/`. `src/main.ts` is still the stock Nest
> bootstrap; wiring `ApiModule`, the store, `SECRETS_KEY` handling and the periodic `sweep()`/webhook
> outbox timers into it is part of the remaining work.

## Quick start

```
bun install
cp .env.example .env     # Bun loads .env automatically; see the file for every option
bun run start:dev        # watch mode
```

| Script | Purpose |
|--------|---------|
| `bun run start` / `start:dev` / `start:debug` | Run the app (`nest start`, optionally watch/debug) |
| `bun run build` / `start:prod` | Compile to `dist/` and run it |
| `bun test` | Specs in `test/` (bun:test). Run `bun test test/` to skip the old suite in `backup/` |
| `bun run test:cov` | Tests with coverage |
| `bun run test:parity` | Checks every test of the original suite has a counterpart in the new specs |
| `bun run lint` / `format` | oxlint (type-aware) / prettier |

Storage is chosen by environment variable (set at most one; none = in-memory):
`DATABASE_URL` (PostgreSQL, see [`docs/POSTGRES.md`](docs/POSTGRES.md)), `DATABASE_FILE` (SQLite) or
`DATA_FILE` (JSON snapshot). The PostgreSQL specs need `TEST_DATABASE_URL` and are skipped without it.

## Layout

Feature folders, each with a module, a controller and a `dto/` folder of validated request shapes.

| Path | Purpose |
|------|---------|
| `src/main.ts`, `src/app.module.ts` | Bootstrap and root module |
| `src/decision-log/` | `DecisionLog` domain service (lifecycle, unified `perform()` action dispatcher, voting, revisions, comments, todos, audit) and `DecisionLogModule.register(options)` |
| `src/api/` | `ApiModule.register({ log, onMutation? })` composes the feature modules plus the cross-cutting pieces: error filter, idempotency interceptor, durable-before-ack `onMutation` interceptor, route table |
| `src/decisions/` | `POST/GET /decisions`, `/:id`, `/:id/actions`, versions, diff, comments, participants, related, integrity |
| `src/admin/` | Owners, teams, team members, projects and project/approval settings |
| `src/todos/`, `src/profile/` | Follow-up todos; user profile and notification preferences |
| `src/insights/` | Search, dashboard, notifications feed, reports, export |
| `src/webhooks/` | Webhook endpoints/deliveries controller and `WebhookDispatcher` (signing, retries, SSRF guard), `verifySignature` for receivers |
| `src/storage/` | `MemoryStore` (JSON snapshots), `SqliteStore`, `PostgresStore` (+ `migrations/postgres.ts`), `SecretBox` (AES-256-GCM) |
| `src/notifications/` | `NotificationPayload`, `NotificationChannel` contract + conformance kit, `NotificationManager`, `EmailChannel`, MIME and SMTP client (see [`docs/NOTIFICATIONS.md`](docs/NOTIFICATIONS.md)) |
| `src/ui/` | Serves the dependency-free web UI from `public/` at `/` |
| `src/common/` | `DecisionLogError` and the `X-User` guard |
| `src/helpers/` | Small single-purpose helpers grouped by action (`auth/`, `errors/`, `files/`, `http/`, `routing/`) |
| `test/` | `*.spec.ts` (bun:test, nested GIVEN/WHEN/THEN). `test/support/` holds fixtures; `test/support/target.ts` is the only place specs import from `src/` |
| `scripts/check-parity.ts` | Original-vs-new test parity check |
| `backup/` | The original Node implementation, the porting reference |

## Behaviour notes / decisions where the plan was ambiguous

These describe the intended domain behaviour (taken from the original implementation and enforced by the specs).

- **Auth**: the caller is read from the `X-User` header (`XUserGuard`). This is a placeholder; put real auth in front.
  The owner/customer identifier acts as organisation admin.
- **Roles**: team roles are `member`, `lead`, `admin`. In `single_approval` and `veto` modes, leads/admins
  approve or decline; in `consensus_voting` and `quorum` every team member except the decision owner votes.
  Owners can never approve/vote/request a revision on their own decision.
- **Consensus**: approved when non-abstain votes >= `consensus_min_votes` **and** approve share >=
  `consensus_approval_threshold` (the plan's "80% OR 5 votes" was ambiguous; AND is the safer reading).
  A `request_revision` vote is counted, not an immediate veto; use the `request_revision` action to send it back.
- **Quorum weights**: `vote_weights` (per team role, default 1) weight turnout and majority in quorum mode only; reported tallies stay head-counts.
- **Veto**: a `request_revision` vote (with reason) returns the decision to draft. `sweep()` auto-approves
  after `auto_approve_after_days`; the server runs it every minute.
- **Immutability**: content is hashed (SHA-256) on propose. `verifyIntegrity()` re-checks decision and all revisions.
- **Related decisions**: default finder is bag-of-words cosine similarity (no external model). Inject an
  embedding-based `relatedFinder(decision, candidates) => [{decision_id, type, score}]` to replace it.
  Scanning runs on create, draft save and propose. Links are shown from both sides (`direction`), explicit ids like `PRJ-012` in a document are linked automatically, and the owner of the linked decision is notified. The finder is synchronous.

## Webhooks

Org admins register endpoints with `POST /webhooks {owner, url, events}` (events: `*`, a family such as
`decision.*`, or exact names). The signing secret is returned **once** and stored encrypted (see *Secrets at rest*). Events: `decision.created|proposed|vote_received|approved|declined|revision_requested|returned_to_draft|superseded`,
`comment.created`, `followup.assigned|completed`, `meeting.recorded`. Payloads carry ids and metadata, never document or comment bodies.

- **Outbox**: events and delivery rows are written in the same commit as the change, so nothing is lost on a crash.
  The server sends them every 5s and prunes finished ones after 30 days.
- **Delivery**: `POST` JSON with `X-Decision-Log-Event`, `-Delivery` (stable across retries; use it to de-duplicate),
  `-Timestamp` and `-Signature: sha256=<HMAC-SHA256 of "<timestamp>.<body>">`. Any 2xx is success. Failures retry
  after 1m, 5m, 30m, 2h, then are marked `failed` (5 attempts); redeliver with `POST /deliveries/:id/redeliver`.
  Redirects are never followed. Receivers should use `verifySignature` (5 minute replay window).
- **SSRF**: private, loopback, link-local and internal-looking targets are rejected at registration and again at
  delivery after DNS resolution. Set `WEBHOOK_ALLOW_PRIVATE=1` only for local development. DNS is resolved
  separately from the request, so use an egress proxy/firewall if rebinding is in your threat model.
- Endpoints: `GET /webhooks?owner=`, `DELETE /webhooks/:id`, `GET /webhooks/:id/deliveries?status=`.

## Secrets at rest

Webhook signing secrets are encrypted with AES-256-GCM (`src/storage/secrets.ts`) and bound to their record id, so a
ciphertext copied to another record will not decrypt. When data is persisted (`DATABASE_URL`, `DATABASE_FILE` or `DATA_FILE`)
the server **refuses to start without `SECRETS_KEY`** (32 bytes, base64 or hex):

```
export SECRETS_KEY=$(bun -e "console.log(crypto.getRandomValues(new Uint8Array(32)).toBase64())")
```

Rotate by setting the new key as `SECRETS_KEY` and the old one(s) in `SECRETS_KEY_PREVIOUS` (comma separated); on
startup everything is re-encrypted under the new key and the old one can then be dropped. Plaintext secrets written
by earlier versions are encrypted automatically on first start. Losing the key makes stored secrets unrecoverable
(re-create the webhooks). The key itself must live in your secret manager, not in the database.

## Notifications

In-app notifications (mentions, proposals, votes, follow-ups...) are also delivered through pluggable channels according to each
user's preferences. **Email is built in the original implementation** (set `SMTP_URL` and `EMAIL_FROM`); SMS and push are defined by the same interface but not
implemented. How to add one, the payload structure and the email configuration: [`docs/NOTIFICATIONS.md`](docs/NOTIFICATIONS.md).

## Not built yet

- Porting the remaining stubs from `backup/src/` (domain service, stores, webhook dispatcher, notification manager, profile and webhook endpoints) and wiring them into `src/main.ts`.
- Browser audio recording and the speech-to-text call (the service accepts a finished transcript via `add_meeting`).
- SMS and push channels (interface and docs are in place) and a UI for notification settings.

## Known doc/CI drift

`docs/*.md` and `.github/workflows/test.yml` still reference the old `.js` paths and `npm`/`node:test`; update them as each area is ported.
