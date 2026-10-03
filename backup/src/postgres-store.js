import { createHash } from 'node:crypto';
import { MemoryStore, MAP_COLLECTIONS, ARRAY_COLLECTIONS, RECORD_COLLECTIONS } from './store.js';
import { MIGRATIONS } from './migrations/postgres.js';
import { canon } from './util.js';

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const CHUNK = 500;
const q = (s) => `"${s}"`;

/** Stable 64-bit advisory-lock key for a schema. */
const lockKey = (schema) => BigInt.asIntN(64, createHash('sha256').update(`decision-log:${schema}`).digest().readBigUInt64BE(0)).toString();

/**
 * PostgreSQL-backed store. The working set lives in memory (same shape as MemoryStore) and commit() writes only the
 * rows that changed, atomically, as jsonb in one table per collection.
 *
 * Because the working set is in memory the database must have a single writer: open() takes a session-level advisory
 * lock and fails if another instance holds it. If the connection (and so the lock) is lost, `onConnectionLost` is
 * called and further commits fail; the process should exit and be restarted by its supervisor.
 *
 * Requires the optional `pg` package.
 */
export class PostgresStore extends MemoryStore {
  persistent = true;

  static async open(connectionString, { schema = 'decision_log', onConnectionLost, ssl } = {}) {
    if (!SCHEMA_NAME.test(schema)) throw new Error('invalid schema name (lowercase letters, digits and underscores only)');
    let pg;
    try { pg = (await import('pg')).default; } catch { throw new Error('PostgreSQL support requires the "pg" package (npm install pg)'); }

    const client = new pg.Client({ connectionString, application_name: `decision-log:${schema}`, ...(ssl === undefined ? {} : { ssl }) });
    const store = new PostgresStore();
    Object.assign(store, { client, schema, saved: new Map(), tail: Promise.resolve(), lost: null, closing: false });
    client.on('error', (e) => store.markLost(e, onConnectionLost));
    client.on('end', () => { if (!store.closing) store.markLost(new Error('connection ended'), onConnectionLost); });
    await client.connect();
    try {
      const { rows } = await client.query('SELECT pg_try_advisory_lock($1::bigint) AS locked', [lockKey(schema)]);
      if (!rows[0].locked) throw new Error(`another instance is already using schema "${schema}" in this database (only one writer is allowed)`);
      await store.migrate();
      await store.load();
    } catch (e) {
      store.closing = true;
      await client.end().catch(() => {});
      throw e;
    }
    return store;
  }

  markLost(error, cb) {
    if (this.lost) return;
    this.lost = error;
    try { cb?.(error); } catch { /* the callback must not break teardown */ }
  }

  async migrate() {
    const s = q(this.schema);
    await this.client.query(`CREATE SCHEMA IF NOT EXISTS ${s}`);
    await this.client.query(`CREATE TABLE IF NOT EXISTS ${s}.schema_migrations (version int PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await this.client.query(`SELECT COALESCE(max(version), 0)::int AS v FROM ${s}.schema_migrations`);
    const current = rows[0].v;
    const latest = MIGRATIONS.at(-1).version;
    if (current > latest) throw new Error(`database schema version ${current} is newer than this application supports (${latest}); upgrade the application`);
    for (const m of MIGRATIONS.filter((x) => x.version > current)) {
      await this.client.query('BEGIN');
      try {
        await this.client.query(m.up(this.schema));
        await this.client.query(`INSERT INTO ${s}.schema_migrations (version, name) VALUES ($1, $2)`, [m.version, m.name]);
        await this.client.query('COMMIT');
      } catch (e) {
        await this.client.query('ROLLBACK').catch(() => {});
        throw new Error(`migration ${m.version} (${m.name}) failed: ${e.message}`);
      }
    }
  }

  async load() {
    const s = q(this.schema);
    const read = async (coll) => (await this.client.query(`SELECT k, data FROM ${s}.${q(coll)} ORDER BY k`)).rows;
    for (const c of MAP_COLLECTIONS) for (const { k, data } of await read(c)) { this[c].set(k, data); this.saved.set(`${c}\0${k}`, canon(data)); }
    for (const c of ARRAY_COLLECTIONS) for (const { k, data } of await read(c)) { this[c].push(data); this.saved.set(`${c}\0${k}`, canon(data)); }
    for (const c of RECORD_COLLECTIONS) for (const { k, data } of await read(c)) { this[c][k] = data; this.saved.set(`${c}\0${k}`, canon(data)); }
  }

  snapshot() {
    const rows = new Map();
    for (const c of MAP_COLLECTIONS) for (const [k, v] of this[c]) rows.set(`${c}\0${k}`, canon(v));
    for (const c of ARRAY_COLLECTIONS) this[c].forEach((v, i) => rows.set(`${c}\0${String(i).padStart(10, '0')}`, canon(v)));
    for (const c of RECORD_COLLECTIONS) for (const [k, v] of Object.entries(this[c])) rows.set(`${c}\0${k}`, canon(v));
    return rows;
  }

  /** Writes every change since the last successful commit in one transaction. Calls are queued and run one at a time. */
  commit() {
    const run = this.tail.then(() => this.#commitNow());
    this.tail = run.catch(() => {});
    return run;
  }

  async #commitNow() {
    if (this.lost) throw new Error(`database connection lost: ${this.lost.message}`);
    const next = this.snapshot();
    const upserts = new Map();
    const deletes = new Map();
    const push = (map, coll, ...vals) => { if (!map.has(coll)) map.set(coll, vals.map(() => [])); vals.forEach((v, i) => map.get(coll)[i].push(v)); };
    for (const [key, json] of next) if (this.saved.get(key) !== json) { const [coll, k] = key.split('\0'); push(upserts, coll, k, json); }
    for (const key of this.saved.keys()) if (!next.has(key)) { const [coll, k] = key.split('\0'); push(deletes, coll, k); }
    if (!upserts.size && !deletes.size) return;

    const s = q(this.schema);
    await this.client.query('BEGIN');
    try {
      for (const [coll, [keys, docs]] of upserts) {
        for (let i = 0; i < keys.length; i += CHUNK) {
          await this.client.query(
            `INSERT INTO ${s}.${q(coll)} (k, data, updated_at) SELECT u.k, u.d::jsonb, now() FROM unnest($1::text[], $2::text[]) AS u(k, d)
             ON CONFLICT (k) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
            [keys.slice(i, i + CHUNK), docs.slice(i, i + CHUNK)],
          );
        }
      }
      for (const [coll, [keys]] of deletes) {
        for (let i = 0; i < keys.length; i += CHUNK) await this.client.query(`DELETE FROM ${s}.${q(coll)} WHERE k = ANY($1::text[])`, [keys.slice(i, i + CHUNK)]);
      }
      await this.client.query('COMMIT');
    } catch (e) {
      await this.client.query('ROLLBACK').catch(() => {});
      throw e;
    }
    this.saved = next;
  }

  async close() {
    this.closing = true;
    try { await this.tail; } catch { /* already reported to its caller */ }
    if (!this.lost) await this.client.query('SELECT pg_advisory_unlock($1::bigint)', [lockKey(this.schema)]).catch(() => {});
    await this.client.end().catch(() => {});
  }
}
