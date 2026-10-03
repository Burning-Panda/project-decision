# TODO: learning path (step-by-step TDD curriculum)

Goal: learners implement the stubbed `src/` one step at a time, easiest first. A runner runs one step's specs, stops when the step is green, and points to the next.

## Decided
- Implemented code stays as worked examples: `Notifier`, `EmailChannel`, `smtpTransport`, routing, `XUserGuard`.
- Reference solutions: separate branch, one tag per step (`step-NN`), written later. Do not use the deleted `backup/src` (git history before `ae08419`) as a source.
- Persistence comes early (level 3), not last. SQLite first (no server), Postgres last.
- SQLite mirrors Postgres: one table per collection (`k text primary key, data json, updated_at`) plus `schema_migrations`.
- Data migrations are a named mechanism (see 1.5).

## 1. Spec changes (do first)
1. `test/storage/postgres-store.spec.ts:73`: replace "migration 1 creates a table for every collection" with "after all migrations, every collection has a table", so each feature can add its own migration.
2. SQLite: same migration specs as Postgres (versions 1..n, recorded in `schema_migrations`, a newer database is refused). Add `src/storage/migrations/sqlite.ts`.
3. `test/storage/secrets.spec.ts:395`: `SELECT json FROM docs WHERE coll = 'webhooks'` → read the `webhooks` table.
4. New early specs using owners/teams/projects only: `MemoryStore` collections, JSON round trip, SQLite reopen. The existing persistence specs need decisions/comments, so they stay as later regression steps.
5. Data migrations: an ordered list of document upgrades, applied once on open and recorded like schema migrations. Spec it with a fake upgrade, then move the two legacy cases onto it: audit entries without `hv` (`audit-security.spec`), plaintext webhook `secret` → `secret_enc` (`secrets.spec`).
6. Generic spec: every name in `MAP/ARRAY/RECORD_COLLECTIONS` survives a round trip in every store. Adding a collection makes it fail until save/load and the migration exist.
7. Convention per feature, taught in step briefs: a record type plus a formatter (record → API response). The specs already check outputs (e.g. webhook list hides `secret`, profile defaults).

## 2. Runner
- `learn/steps.ts`: ordered `{ id, level, title, concepts[], edit[] (src files), specs: [{ file, pattern? }] }`. `pattern` is a regex over the top-level describe title (bun `-t`). A step groups ~3–8 of the 207 top-level sections.
- `learn/steps/NN-<slug>.md`: goal, concept, files, hints in increasing detail, separated by `---`.
- `scripts/learn.ts` + `"learn"` script in `package.json`:
  - `bun run learn`: re-run earlier steps quietly (report regressions), then the first failing step with `--bail`; print the step header and the first failing GIVEN > WHEN > THEN. When green: print the next step and stop.
  - `learn status`: progress per level. `learn hint`: reveal the next hint (track in a gitignored file). `learn step N`: run step N only.
  - Progress comes from test results; never stored.
- Order check (`learn verify`, run on the solutions branch): at tag `step-NN`, steps 1..NN pass and NN+1 fails.

## 3. Levels (spec sources)
| L | Theme | Specs |
|---|---|---|
| 0 | Orientation | `http/routes`, `notifications/notifications`, `notifications/email` (already green) |
| 1 | Pure functions | `domain/project`, `notifications/push` |
| 2 | State, errors, permissions | `MemoryStore` basics (new), `domain/owners`, `teams`, `projects`, `parts` |
| 3 | Persistence I | new early round-trip/SQLite/migration specs (1.2, 1.4, 1.6) |
| 4 | Decision state machine | `decisions/lifecycle` (except the document-rendering and supersede sections that need related decisions) |
| 5 | Rules | `decisions/approval-modes`, `revisions` |
| 6 | Features | `collaboration`, `followups`, `related`, `notifications/profiles` |
| 7 | Evolving data, integrity | data migrations (1.5), `audit-security`, `storage/secrets`, `storage/sqlite-store` |
| 8 | Queries | `decisions/search-reports` |
| 9 | HTTP | `http/api` |
| 10 | Async and network | `webhooks/webhooks`, `notifications/notification-dispatch` |
| 11 | Production database (optional) | `storage/postgres-store` (needs `TEST_DATABASE_URL`) |

Cross-level dependencies: every mutation writes audit, so L2 asks for a plain append and L7 upgrades it to the hash chain. Split a spec file by section wherever it needs a later level; `learn verify` catches misses.

## Notes
- Locally, `.env` sets `TEST_DATABASE_URL` to a database `decisions_test` that does not exist yet; create it or the Postgres specs fail.
- Conventions: `test/http/routes.spec.ts` style, helpers in `test/support/setup.ts` (`freshLog`, `proposedIn`, `attempt`).
