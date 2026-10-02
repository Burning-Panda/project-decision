# Decision Log

Immutable decision tracking with an approval workflow, voting modes, revisions/diffs, comments,
meeting transcripts, follow-up todos, related-decision discovery and a hash-chained audit trail.
Zero runtime dependencies (Node >= 20).

```
npm test                       # 84 tests (node:test)
PORT=3000 DATA_FILE=data.json npm start
```

## Layout

| File | Purpose |
|------|---------|
| `src/decision-log.js` | Domain service: lifecycle, unified `perform()` action dispatcher, voting, revisions, comments, todos, audit |
| `src/queries.js` | List, search, dashboard, reports, export |
| `src/voting.js`, `src/settings.js` | Approval-mode evaluation and project settings |
| `src/diff.js`, `src/related.js`, `src/template.js` | Section-aware diff, pluggable related-decision finder, default template |
| `src/store.js` | In-memory store with JSON snapshots (plain data, swappable for a DB) |
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
- **Veto**: a `request_revision` vote (with reason) returns the decision to draft. `sweep()` auto-approves
  after `auto_approve_after_days`; the server runs it every minute.
- **Immutability**: content is hashed (SHA-256) on propose. `verifyIntegrity()` re-checks decision and all revisions.
- **Related decisions**: default finder is bag-of-words cosine similarity (no external model). Inject an
  embedding-based `relatedFinder(decision, candidates) => [{decision_id, type, score}]` to replace it.
  Scanning runs on create, draft save and propose. Links are shown from both sides (`direction`), explicit ids like `PRJ-012` in a document are linked automatically, and the owner of the linked decision is notified. The finder is synchronous.

## Not built yet

React UI, Postgres storage/migrations, browser audio recording and the speech-to-text call (the service accepts
a finished transcript via `add_meeting`), webhooks/email, weighted votes.
