# Decision Log

Immutable decision tracking with an approval workflow, voting modes, revisions/diffs, comments,
meeting transcripts, follow-up todos, related-decision discovery and a hash-chained audit trail.
Zero runtime dependencies (Node >= 22.13).

```
npm test                       # 170 tests (node:test)
PORT=3000 npm start                      # in-memory
PORT=3000 DATABASE_FILE=log.db npm start  # durable SQLite (recommended)
PORT=3000 DATA_FILE=data.json npm start   # JSON snapshot, rewritten per write
```

## Layout

| File | Purpose |
|------|---------|
| `src/decision-log.js` | Domain service: lifecycle, unified `perform()` action dispatcher, voting, revisions, comments, todos, audit |
| `src/queries.js` | List, search, dashboard, reports, export |
| `src/voting.js`, `src/settings.js` | Approval-mode evaluation and project settings |
| `src/diff.js`, `src/related.js`, `src/template.js` | Section-aware diff, pluggable related-decision finder, default template |
| `src/store.js`, `src/sqlite-store.js` | In-memory store with JSON snapshots; SQLite store that commits changed rows transactionally |
| `src/notifications/` | Standard `NotificationPayload`, `NotificationChannel` interface + conformance kit, `NotificationManager`, `EmailChannel`, MIME and SMTP client (see `docs/NOTIFICATIONS.md`) |
| `src/secrets.js` | AES-256-GCM `SecretBox` for secrets at rest |
| `src/webhooks.js`, `src/net.js` | Webhook dispatcher (signing, retries, SSRF guard), `verifySignature` for receivers |
| `public/` | Dependency-free web UI (list, detail, actions, comments, todos, dashboard) served at `/` |
| `src/api.js`, `src/server.js` | HTTP API (`POST /decisions/:id/actions` etc.) and entrypoint |

## Behaviour notes / decisions where the plan was ambiguous

- **Auth**: the caller is read from the `X-User` header. This is a placeholder; put real auth in front.
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

Webhook signing secrets are encrypted with AES-256-GCM (`src/secrets.js`) and bound to their record id, so a
ciphertext copied to another record will not decrypt. When data is persisted (`DATABASE_FILE` or `DATA_FILE`) the server
**refuses to start without `SECRETS_KEY`** (32 bytes, base64 or hex):

```
export SECRETS_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
```

Rotate by setting the new key as `SECRETS_KEY` and the old one(s) in `SECRETS_KEY_PREVIOUS` (comma separated); on
startup everything is re-encrypted under the new key and the old one can then be dropped. Plaintext secrets written
by earlier versions are encrypted automatically on first start. Losing the key makes stored secrets unrecoverable
(re-create the webhooks). The key itself must live in your secret manager, not in the database.

## Notifications

In-app notifications (mentions, proposals, votes, follow-ups...) are also delivered through pluggable channels according to each
user's preferences. **Email is built** (set `SMTP_URL` and `EMAIL_FROM`); SMS and push are defined by the same interface but not
implemented. How to add one, the payload structure and the email configuration: [`docs/NOTIFICATIONS.md`](docs/NOTIFICATIONS.md).

## Not built yet

Postgres storage/migrations (SQLite is the durable option for now), browser audio recording and the speech-to-text call (the service accepts
a finished transcript via `add_meeting`), SMS and push channels (interface and docs are in place), a UI for notification settings.
