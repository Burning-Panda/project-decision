import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DecisionLog } from '../src/decision-log.js';
import { PostgresStore } from '../src/postgres-store.js';
import { MIGRATIONS } from '../src/migrations/postgres.js';
import { createApp } from '../src/api.js';
import { MemoryStore, MAP_COLLECTIONS, ARRAY_COLLECTIONS, RECORD_COLLECTIONS } from '../src/store.js';
import { makeClock, testBox, U, CONTENT_V1, act } from './helpers.js';

const URL_ = process.env.TEST_DATABASE_URL;
const SKIP = URL_ ? false : 'set TEST_DATABASE_URL to a PostgreSQL database to run these tests';

const pgmod = URL_ ? (await import('pg')).default : null;
const box = testBox();

/** Runs fn with a fresh, isolated schema that is dropped afterwards. */
function pgTest(name, fn) {
  test(`postgres: ${name}`, { skip: SKIP }, async () => {
    const schema = `dl_test_${randomBytes(5).toString('hex')}`;
    const admin = new pgmod.Client({ connectionString: URL_ });
    await admin.connect();
    const opened = [];
    const open = async (opts = {}) => { const s = await PostgresStore.open(URL_, { schema, ...opts }); opened.push(s); return s; };
    try {
      await fn({ schema, open, admin, q: (sql, params) => admin.query(sql, params).then((r) => r.rows) });
    } finally {
      for (const s of opened) await s.close().catch(() => {});
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });
}

function build(store, clock = makeClock()) {
  return { log: new DecisionLog({ store, clock: clock.now, secretBox: box }), clock };
}

function seed(log) {
  log.createOwner({ identifier: 'acme' });
  for (const u of [U.alice, U.bob]) log.addTeamMember({ owner: 'acme', user: u, actor: 'acme' });
  log.addTeamMember({ owner: 'acme', user: U.lead, role: 'lead', actor: 'acme' });
  log.createProject({ owner: 'acme', identifier: 'PRJ', title: 'P', actor: 'acme' });
  const d = log.createDecision({ project: 'PRJ', actor: U.alice, title: 'Persist me', content: CONTENT_V1 });
  act(log, d.id, U.alice, 'propose');
  log.addComment(d.id, U.bob, { content: 'looks fine' });
  return d.id;
}

// ---------------------------------------------------------------- pure checks (no database needed)
test('migrations are ordered, unique and cover every store collection', () => {
  assert.ok(MIGRATIONS.length >= 1);
  assert.deepEqual(MIGRATIONS.map((m) => m.version), MIGRATIONS.map((_, i) => i + 1));
  const sql = MIGRATIONS[0].up('s');
  for (const c of [...MAP_COLLECTIONS, ...ARRAY_COLLECTIONS, ...RECORD_COLLECTIONS]) assert.match(sql, new RegExp(`"s"\\."${c}"`), `table for ${c}`);
  assert.equal(new MemoryStore().persistent, false);
});

test('schema names are validated before they can reach SQL', async () => {
  await assert.rejects(PostgresStore.open('postgres://x', { schema: 'bad-name; drop table x' }), /schema name/i);
  await assert.rejects(PostgresStore.open('postgres://x', { schema: 'Upper' }), /schema name/i);
});

// ---------------------------------------------------------------- database tests
pgTest('opening applies migrations once and records them', async ({ open, schema, q }) => {
  const s1 = await open();
  const applied = await q(`SELECT version, name FROM "${schema}".schema_migrations ORDER BY version`);
  assert.deepEqual(applied.map((r) => r.version), MIGRATIONS.map((m) => m.version));
  await s1.close();
  const s2 = await open();
  assert.equal((await q(`SELECT count(*)::int AS n FROM "${schema}".schema_migrations`))[0].n, MIGRATIONS.length, 'not re-applied');
  assert.equal(s2.persistent, true);
});

pgTest('refuses a database whose schema is newer than the application', async ({ open, schema, admin }) => {
  const s = await open();
  await s.close();
  await admin.query(`INSERT INTO "${schema}".schema_migrations (version, name) VALUES (999, 'from the future')`);
  await assert.rejects(open(), /newer/i);
});

pgTest('state survives reopening, including audit chain, integrity and counters', async ({ open }) => {
  const s1 = await open();
  const { log } = build(s1);
  const id = seed(log);
  act(log, id, U.lead, 'approve');
  await s1.commit();
  await s1.close();

  const s2 = await open();
  const { log: again } = build(s2);
  const d = again.getDecision(id, U.alice);
  assert.equal(d.status, 'approved');
  assert.equal(d.comments.length, 1);
  assert.equal(again.verifyAuditChain().ok, true);
  assert.equal(again.verifyIntegrity(id).ok, true);
  assert.equal(again.createDecision({ project: 'PRJ', actor: U.alice, title: 'next' }).id, 'PRJ-002');
  assert.equal(again.addComment(id, U.bob, { content: 'second' }).id, 'comment-002');
});

pgTest('data is stored as queryable jsonb, one table per collection', async ({ open, q, schema }) => {
  const s = await open();
  const { log } = build(s);
  seed(log);
  await s.commit();
  const rows = await q(`SELECT k, data->>'status' AS status, data->>'title' AS title FROM "${schema}".decisions`);
  assert.deepEqual(rows.map((r) => [r.k, r.status, r.title]), [['PRJ-001', 'proposed', 'Persist me']]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM "${schema}".audit WHERE data->>'decision_id' = 'PRJ-001'`))[0].n, 4);
});

pgTest('commits are incremental: unchanged state writes nothing, a change touches only its table', async ({ open }) => {
  const s = await open();
  const { log } = build(s);
  const id = seed(log);
  await s.commit();
  const statements = [];
  const original = s.client.query.bind(s.client);
  s.client.query = (...a) => { statements.push(String(a[0]?.text ?? a[0])); return original(...a); };

  await s.commit();
  assert.deepEqual(statements, [], 'nothing changed, nothing sent');

  log.resolveComment(id, 'comment-001', U.alice);
  await s.commit();
  const writes = statements.filter((x) => /INSERT|DELETE|UPDATE/i.test(x));
  assert.ok(writes.some((x) => x.includes('"comments"')));
  assert.ok(!writes.some((x) => x.includes('"decisions"')), 'decisions table untouched');
});

pgTest('reopening does not rewrite rows just because jsonb reorders object keys', async ({ open }) => {
  const s1 = await open();
  seed(build(s1).log);
  await s1.commit();
  await s1.close();
  const s2 = await open();
  build(s2);
  const statements = [];
  const original = s2.client.query.bind(s2.client);
  s2.client.query = (...a) => { statements.push(String(a[0]?.text ?? a[0])); return original(...a); };
  await s2.commit();
  assert.deepEqual(statements.filter((x) => /INSERT|DELETE/i.test(x)), []);
});

pgTest('deletions are persisted', async ({ open }) => {
  const s1 = await open();
  const { log } = build(s1);
  seed(log);
  const draft = log.createDecision({ project: 'PRJ', actor: U.alice, title: 'throwaway' });
  await s1.commit();
  log.deleteDraft(draft.id, U.alice);
  await s1.commit();
  await s1.close();
  const { log: again } = build(await open());
  assert.throws(() => again.getDecision(draft.id, U.alice), { code: 'NOT_FOUND' });
  assert.equal(again.getProject('PRJ').decision_count, 1);
});

pgTest('a failing commit is atomic and the next commit recovers', async ({ open, q, schema }) => {
  const s = await open();
  const { log } = build(s);
  const id = seed(log);
  await s.commit();
  log.addComment(id, U.bob, { content: 'fine comment' });
  log.addComment(id, U.bob, { content: 'bad\u0000comment' }); // jsonb cannot store NUL
  await assert.rejects(s.commit(), /unicode|escape|\\u0000/i);
  assert.equal((await q(`SELECT count(*)::int AS n FROM "${schema}".comments`))[0].n, 1, 'nothing from the failed batch was written');

  s.comments.pop(); // remove the offending row; the earlier good one is still pending
  await s.commit();
  assert.equal((await q(`SELECT count(*)::int AS n FROM "${schema}".comments`))[0].n, 2);
});

pgTest('concurrent commits are serialised and converge on the in-memory state', async ({ open, q, schema }) => {
  const s = await open();
  const { log } = build(s);
  const id = seed(log);
  const jobs = [];
  for (let i = 0; i < 8; i++) { log.addComment(id, U.bob, { content: `c${i}` }); jobs.push(s.commit()); }
  await Promise.all(jobs);
  assert.equal((await q(`SELECT count(*)::int AS n FROM "${schema}".comments`))[0].n, 9);
});

pgTest('only one instance may use a database at a time', async ({ open }) => {
  const first = await open();
  await assert.rejects(open(), /another instance/i);
  await first.close();
  assert.ok(await open(), 'the lock is released on close');
});

pgTest('losing the connection (and with it the lock) is reported and stops further commits', async ({ open, admin }) => {
  let lost = null;
  const s = await open({ onConnectionLost: (e) => { lost = e; } });
  const { log } = build(s);
  seed(log);
  await s.commit();
  const [{ pid }] = (await admin.query('SELECT pg_backend_pid() AS pid')).rows;
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> $1 AND query LIKE \'%advisory%\' OR (pid <> $1 AND application_name = \'decision-log\')', [pid]);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(lost, 'callback fired');
  log.createDecision({ project: 'PRJ', actor: U.alice, title: 'after loss' });
  await assert.rejects(s.commit(), /connection|lost|terminated/i);
});

pgTest('the HTTP API acknowledges writes only after they are durable', async ({ open, q, schema }) => {
  const s = await open();
  const { log } = build(s);
  log.createOwner({ identifier: 'acme' });
  log.addTeamMember({ owner: 'acme', user: U.alice, actor: 'acme' });
  log.createProject({ owner: 'acme', identifier: 'PRJ', title: 'P', actor: 'acme' });
  const server = createApp(log, { onMutation: () => s.commit() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/decisions`, {
      method: 'POST', headers: { 'x-user': U.alice, 'content-type': 'application/json' }, body: JSON.stringify({ project: 'PRJ', title: 'durable' }),
    });
    assert.equal(res.status, 201);
    const rows = await q(`SELECT data->>'title' AS title FROM "${schema}".decisions`);
    assert.deepEqual(rows.map((r) => r.title), ['durable'], 'already in the database when the response arrives');
  } finally { await new Promise((r) => server.close(r)); }
});
