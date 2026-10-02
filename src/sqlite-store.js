import { DatabaseSync } from 'node:sqlite';
import { MemoryStore, MAP_COLLECTIONS as MAPS, ARRAY_COLLECTIONS as ARRAYS, RECORD_COLLECTIONS as RECORDS } from './store.js';

/**
 * Durable store: the working set lives in memory (same shape as MemoryStore) and commit()
 * writes only the rows that changed, in one transaction. Requires Node >= 22.13 (node:sqlite).
 */
export class SqliteStore extends MemoryStore {
  persistent = true;

  static open(file) {
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('CREATE TABLE IF NOT EXISTS docs (coll TEXT NOT NULL, k TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (coll, k)) WITHOUT ROWID');
    const store = new SqliteStore();
    store.db = db;
    store.saved = new Map();
    store.load();
    return store;
  }

  load() {
    const rows = this.db.prepare('SELECT coll, k, json FROM docs ORDER BY coll, k').all();
    for (const { coll, k, json } of rows) {
      const value = JSON.parse(json);
      this.saved.set(`${coll}\0${k}`, json);
      if (MAPS.includes(coll)) this[coll].set(k, value);
      else if (ARRAYS.includes(coll)) this[coll].push(value);
      else if (coll === 'idempotency') this.idempotency[k] = value;
      else if (coll === 'counters') this.counters[k] = value;
    }
  }

  /** Flattens the in-memory state into `coll\0key -> json`. Throws if something cannot be serialised. */
  snapshot() {
    const rows = new Map();
    for (const c of MAPS) for (const [k, v] of this[c]) rows.set(`${c}\0${k}`, JSON.stringify(v));
    for (const c of ARRAYS) this[c].forEach((v, i) => rows.set(`${c}\0${String(i).padStart(10, '0')}`, JSON.stringify(v)));
    for (const c of RECORDS) for (const [k, v] of Object.entries(this[c])) rows.set(`${c}\0${k}`, JSON.stringify(v));
    return rows;
  }

  commit() {
    const next = this.snapshot();
    const upsert = this.db.prepare('INSERT INTO docs (coll, k, json) VALUES (?, ?, ?) ON CONFLICT (coll, k) DO UPDATE SET json = excluded.json');
    const remove = this.db.prepare('DELETE FROM docs WHERE coll = ? AND k = ?');
    this.db.exec('BEGIN');
    try {
      for (const [key, json] of next) {
        if (this.saved.get(key) === json) continue;
        const [coll, k] = key.split('\0');
        upsert.run(coll, k, json);
      }
      for (const key of this.saved.keys()) {
        if (next.has(key)) continue;
        const [coll, k] = key.split('\0');
        remove.run(coll, k);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    this.saved = next;
  }

  close() {
    this.db.close();
  }
}
