# PostgreSQL storage

```
DATABASE_URL=postgres://user:pass@host:5432/dbname   # enables PostgreSQL
DATABASE_SCHEMA=decision_log                          # optional, default "decision_log"
SECRETS_KEY=...                                       # required (see README, "Secrets at rest")
npm install                                           # installs the optional `pg` driver
npm start
```

Use `sslmode=require` (or stricter) in the URL for remote databases. The role needs `CREATE` on the database for the first start
(it creates the schema and tables) and plain read/write afterwards.

## How it works

The service keeps its working set in memory and persists changes through a store. `PostgresStore` (`src/postgres-store.js`) writes
**only the rows that changed since the last commit, in one transaction**, as `jsonb` in one table per collection
(`decisions`, `comments`, `audit`, `webhooks`, ...; each is `k text primary key, data jsonb, updated_at timestamptz`) with a few
indexes for reporting (`decisions.status`, `followups.assigned_to`, `audit.decision_id`, ...). Everything is plain SQL-queryable:

```sql
SELECT k, data->>'title' FROM decision_log.decisions WHERE data->>'status' = 'proposed';
```

* **Durable before acknowledged.** The HTTP API awaits the commit before it responds. If the commit fails the client gets a 500
  and the change stays in memory, to be retried by the next commit; a retry of the same request will then see the new state
  (for example `409 INVALID_STATE`), so treat a 500 on a write as "check before retrying".
* **Single writer.** Because the working set is in memory, two instances on one schema would overwrite each other. `open()` takes a
  session-level advisory lock and a second instance **refuses to start**. If the connection (and so the lock) is lost, the process
  exits so its supervisor can restart it; it reloads from the database on start. Run one replica, or use separate schemas per tenant.
* **Migrations.** `src/migrations/postgres.js` is an append-only, versioned list applied on startup under the lock and recorded in
  `<schema>.schema_migrations`. A database with a *newer* version than the application is refused (upgrade the application first).
  Never edit a released migration; add a new one.
* **Graceful shutdown.** `SIGTERM`/`SIGINT` flush pending changes and release the lock.
* **Capacity.** The whole data set is loaded into memory at start, which is fine for the decision-log use case (tens of thousands of
  records) but is not designed for millions.
* **Backups.** Standard `pg_dump -n decision_log`. The audit chain (`verifyAuditChain`) and content hashes (`verifyIntegrity`) can be
  re-checked after a restore. Webhook secrets are encrypted; keep `SECRETS_KEY` with your backups' secrets, not in the dump.

## Moving data between stores

The JSON snapshot format is the same for every store: `MemoryStore.fromJSON(json)` then commit to a `PostgresStore`
(or the reverse with `store.toJSON()`), keeping `SECRETS_KEY` unchanged.

## Running the PostgreSQL tests

The Postgres tests are skipped unless a database is provided; each test uses its own throw-away schema:

```
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
# e.g. docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
```
