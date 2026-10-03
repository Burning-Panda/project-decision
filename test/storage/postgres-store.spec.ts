import { describe, it, expect, beforeEach } from 'bun:test';
import {
  PostgresStore, MemoryStore, MIGRATIONS, MAP_COLLECTIONS, ARRAY_COLLECTIONS, RECORD_COLLECTIONS,
  buildLog, startApi, makeClock, testBox, usePostgres, statementLog, HAS_PG, expectCode, act, U, CONTENT_V1,
} from '../support/index';

// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.
// Actions expected to reject are kept as a promise in WHEN and awaited in THEN.
// THEN may query the schema to observe what was written. Database tests need TEST_DATABASE_URL.

type Pg = ReturnType<typeof usePostgres>;
type Opened = { store: any; log: any };
type Seeded = Opened & { id: string; reopen: (opts?: Record<string, any>) => Promise<Opened> };

const build = (store: any, box: ReturnType<typeof testBox>) => buildLog({ store, clock: makeClock().now, secretBox: box });

/** A promise WHEN steps keep for THEN to await; marked handled so a rejection is not reported before THEN looks. */
const pending = <T>(p: Promise<T>) => { p.catch(() => {}); return p; };

const count = async (pg: Pg, table: string) => (await pg.q(`SELECT count(*)::int AS n FROM "${pg.schema}".${table}`))[0].n;

function seed(log: any) {
  log.createOwner({ identifier: 'acme' });
  for (const u of [U.alice, U.bob]) log.addTeamMember({ owner: 'acme', user: u, actor: 'acme' });
  log.addTeamMember({ owner: 'acme', user: U.lead, role: 'lead', actor: 'acme' });
  log.createProject({ owner: 'acme', identifier: 'PRJ', title: 'P', actor: 'acme' });
  const d = log.createDecision({ project: 'PRJ', actor: U.alice, title: 'Persist me', content: CONTENT_V1 });
  act(log, d.id, U.alice, 'propose');
  log.addComment(d.id, U.bob, { content: 'looks fine' });
  return d.id as string;
}

/**
 * Call inside a describe(), after usePostgres(): a log on the test schema seeded with PRJ-001 proposed and
 * commented (`id`), not yet committed. `reopen()` opens the schema again as a new log with the same secret box.
 */
function seededPostgres(pg: Pg, openOptions: () => Record<string, any> = () => ({})): Seeded {
  const h = {} as Seeded;
  beforeEach(async () => {
    const box = testBox();
    h.store = await pg.open(openOptions());
    h.log = await build(h.store, box);
    h.id = seed(h.log);
    h.reopen = async (opts = {}) => {
      const store = await pg.open(opts);
      return { store, log: await build(store, box) };
    };
  });
  return h;
}

// ---------------------------------------------------------------- pure checks (no database needed)
describe('migrations are ordered, unique and cover every store collection', () => {
  describe('GIVEN the migration list', () => {
    describe('WHEN its versions are read', () => {
      let versions: number[];
      beforeEach(() => { versions = MIGRATIONS.map((m: any) => m.version); });

      it('THEN at least one migration exists', () => {
        expect(versions.length).toBeGreaterThanOrEqual(1);
      });

      it('THEN they are 1..n with no gaps or repeats', () => {
        expect(versions).toEqual(versions.map((_, i) => i + 1));
      });
    });
  });

  for (const c of [...MAP_COLLECTIONS, ...ARRAY_COLLECTIONS, ...RECORD_COLLECTIONS]) {
    describe('GIVEN migration 1', () => {
      describe('WHEN its SQL for schema "s" is read', () => {
        let sql: string;
        beforeEach(() => { sql = MIGRATIONS[0].up('s'); });

        it(`THEN it creates a table for ${c}`, () => {
          expect(sql).toMatch(new RegExp(`"s"\\."${c}"`));
        });
      });
    });
  }

  describe('GIVEN a memory store', () => {
    describe('WHEN persistent is read', () => {
      let persistent: boolean;
      beforeEach(() => { persistent = new MemoryStore().persistent; });

      it('THEN it is false', () => {
        expect(persistent).toBe(false);
      });
    });
  });
});

describe('schema names are validated before they can reach SQL', () => {
  for (const [label, schema] of [['an injection-style', 'bad-name; drop table x'], ['an upper-case', 'Upper']]) {
    describe(`GIVEN ${label} schema name`, () => {
      describe('WHEN the store is opened', () => {
        let opening: Promise<unknown>;
        beforeEach(() => { opening = pending(PostgresStore.open('postgres://x', { schema })); });

        it('THEN it is rejected', async () => {
          await expect(opening).rejects.toThrow(/schema name/i);
        });
      });
    });
  }
});

// ---------------------------------------------------------------- database tests (need TEST_DATABASE_URL)
describe.skipIf(!HAS_PG)('opening applies migrations once and records them', () => {
  const pg = usePostgres();

  describe('GIVEN an empty schema', () => {
    describe('WHEN the store is opened', () => {
      beforeEach(async () => { await pg.open(); });

      it('THEN every migration is recorded in order', async () => {
        const applied = await pg.q(`SELECT version, name FROM "${pg.schema}".schema_migrations ORDER BY version`);
        expect(applied.map((r: any) => r.version)).toEqual(MIGRATIONS.map((m: any) => m.version));
      });
    });
  });

  describe('GIVEN an already migrated schema', () => {
    beforeEach(async () => { await (await pg.open()).close(); });

    describe('WHEN it is reopened', () => {
      let s2: any;
      beforeEach(async () => { s2 = await pg.open(); });

      it('THEN migrations are not re-applied and the store is persistent', async () => {
        expect(await count(pg, 'schema_migrations')).toBe(MIGRATIONS.length);
        expect(s2.persistent).toBe(true);
      });
    });
  });
});

describe.skipIf(!HAS_PG)('refuses a database whose schema is newer than the application', () => {
  const pg = usePostgres();

  describe('GIVEN a schema recording migration 999', () => {
    beforeEach(async () => {
      await (await pg.open()).close();
      await pg.q(`INSERT INTO "${pg.schema}".schema_migrations (version, name) VALUES (999, 'from the future')`);
    });

    describe('WHEN the store is opened', () => {
      let opening: Promise<unknown>;
      beforeEach(() => { opening = pending(pg.open()); });

      it('THEN it refuses as newer', async () => {
        await expect(opening).rejects.toThrow(/newer/i);
      });
    });
  });
});

describe.skipIf(!HAS_PG)('state survives reopening, including audit chain, integrity and counters', () => {
  const pg = usePostgres();

  /** The seeded decision approved, committed, and the first store closed. */
  function approvedAndCommitted() {
    const h = seededPostgres(pg);
    beforeEach(async () => {
      act(h.log, h.id, U.lead, 'approve');
      await h.store.commit();
      await h.store.close();
    });
    return h;
  }

  describe('GIVEN an approved committed decision', () => {
    const h = approvedAndCommitted();

    describe('WHEN the schema is reopened', () => {
      let again: any;
      beforeEach(async () => { ({ log: again } = await h.reopen()); });

      it('THEN status and comments persist', () => {
        const d = again.getDecision(h.id, U.alice);
        expect(d.status).toBe('approved');
        expect(d.comments.length).toBe(1);
      });

      it('THEN the audit chain and integrity both hold', () => {
        expect(again.verifyAuditChain().ok).toBe(true);
        expect(again.verifyIntegrity(h.id).ok).toBe(true);
      });
    });
  });

  describe('GIVEN a reopened schema', () => {
    const h = approvedAndCommitted();
    let again: any;
    beforeEach(async () => { ({ log: again } = await h.reopen()); });

    describe('WHEN a decision is created', () => {
      let d: any;
      beforeEach(() => { d = again.createDecision({ project: 'PRJ', actor: U.alice, title: 'next' }); });

      it('THEN numbering continues at PRJ-002', () => {
        expect(d.id).toBe('PRJ-002');
      });
    });

    describe('WHEN a comment is added', () => {
      let c: any;
      beforeEach(() => { c = again.addComment(h.id, U.bob, { content: 'second' }); });

      it('THEN ids continue at comment-002', () => {
        expect(c.id).toBe('comment-002');
      });
    });
  });
});

describe.skipIf(!HAS_PG)('data is stored as queryable jsonb, one table per collection', () => {
  const pg = usePostgres();

  describe('GIVEN a committed decision', () => {
    const h = seededPostgres(pg);
    beforeEach(async () => { await h.store.commit(); });

    describe('WHEN the decisions table is queried by jsonb path', () => {
      let rows: any[];
      beforeEach(async () => { rows = await pg.q(`SELECT k, data->>'status' AS status, data->>'title' AS title FROM "${pg.schema}".decisions`); });

      it('THEN key, status and title are readable', () => {
        expect(rows.map((r) => [r.k, r.status, r.title])).toEqual([['PRJ-001', 'proposed', 'Persist me']]);
      });
    });

    describe('WHEN the audit table is queried by decision_id', () => {
      let n: number;
      beforeEach(async () => { n = (await pg.q(`SELECT count(*)::int AS n FROM "${pg.schema}".audit WHERE data->>'decision_id' = 'PRJ-001'`))[0].n; });

      it('THEN its three entries are there', () => {
        expect(n).toBe(3);
      });
    });
  });
});

describe.skipIf(!HAS_PG)('commits are incremental: unchanged state writes nothing, a change touches only its table', () => {
  const pg = usePostgres();

  describe('GIVEN a fully committed store whose statements are being recorded', () => {
    let rec: ReturnType<typeof statementLog>;
    const h = seededPostgres(pg, () => {
      rec = statementLog();
      return { onStatement: rec.hook };
    });
    beforeEach(async () => {
      await h.store.commit();
      rec.start();
    });

    describe('WHEN commit is called again', () => {
      beforeEach(async () => { await h.store.commit(); });

      it('THEN no statements are sent', () => {
        expect(rec.statements).toEqual([]);
      });
    });

    describe('WHEN a comment is resolved and committed', () => {
      beforeEach(async () => {
        h.log.resolveComment(h.id, 'comment-001', U.alice);
        await h.store.commit();
      });

      it('THEN only the comments table is written', () => {
        const writes = rec.statements.filter((x) => /INSERT|DELETE|UPDATE/i.test(x));
        expect(writes.some((x) => x.includes('"comments"'))).toBe(true);
        expect(writes.some((x) => x.includes('"decisions"'))).toBe(false);
      });
    });
  });
});

describe.skipIf(!HAS_PG)('reopening does not rewrite rows just because jsonb reorders object keys', () => {
  const pg = usePostgres();

  describe('GIVEN a committed schema reopened with its statements being recorded', () => {
    const h = seededPostgres(pg);
    let rec: ReturnType<typeof statementLog>;
    let s2: any;
    beforeEach(async () => {
      await h.store.commit();
      await h.store.close();
      rec = statementLog();
      ({ store: s2 } = await h.reopen({ onStatement: rec.hook }));
      rec.start();
    });

    describe('WHEN it is committed', () => {
      beforeEach(async () => { await s2.commit(); });

      it('THEN no INSERT or DELETE is sent', () => {
        expect(rec.statements.filter((x) => /INSERT|DELETE/i.test(x))).toEqual([]);
      });
    });
  });
});

describe.skipIf(!HAS_PG)('deletions are persisted', () => {
  const pg = usePostgres();

  describe('GIVEN a committed draft that was then deleted and committed', () => {
    const h = seededPostgres(pg);
    let draftId: string;
    beforeEach(async () => {
      draftId = h.log.createDecision({ project: 'PRJ', actor: U.alice, title: 'throwaway' }).id;
      await h.store.commit();
      h.log.deleteDraft(draftId, U.alice);
      await h.store.commit();
      await h.store.close();
    });

    describe('WHEN the schema is reopened', () => {
      let again: any;
      beforeEach(async () => { ({ log: again } = await h.reopen()); });

      it('THEN it is NOT_FOUND and the count is 1', () => {
        expectCode(() => again.getDecision(draftId, U.alice), 'NOT_FOUND');
        expect(again.getProject('PRJ').decision_count).toBe(1);
      });
    });
  });
});

describe.skipIf(!HAS_PG)('a failing commit is atomic and the next commit recovers', () => {
  const pg = usePostgres();

  /** The seeded state committed, then a fine comment and one containing NUL (which jsonb cannot store) pending. */
  function badBatch() {
    const h = seededPostgres(pg);
    beforeEach(async () => {
      await h.store.commit();
      h.log.addComment(h.id, U.bob, { content: 'fine comment' });
      h.log.addComment(h.id, U.bob, { content: 'bad\u0000comment' });
    });
    return h;
  }

  describe('GIVEN a batch containing a NUL character', () => {
    const h = badBatch();

    describe('WHEN committed', () => {
      let committing: Promise<unknown>;
      beforeEach(() => { committing = pending(h.store.commit()); });

      it('THEN it rejects and nothing from the batch is written', async () => {
        await expect(committing).rejects.toThrow(/unicode|escape|\\u0000/i);
        expect(await count(pg, 'comments')).toBe(1);
      });
    });
  });

  describe('GIVEN a failed batch whose offending row was removed', () => {
    const h = badBatch();
    beforeEach(async () => {
      await h.store.commit().catch(() => {});
      h.store.comments.pop();
    });

    describe('WHEN commit is retried', () => {
      beforeEach(async () => { await h.store.commit(); });

      it('THEN the good comment is written', async () => {
        expect(await count(pg, 'comments')).toBe(2);
      });
    });
  });
});

describe.skipIf(!HAS_PG)('concurrent commits are serialised and converge on the in-memory state', () => {
  const pg = usePostgres();

  describe('GIVEN a seeded store', () => {
    const h = seededPostgres(pg);

    describe('WHEN eight comments are each followed by a commit started without awaiting, and all settle', () => {
      beforeEach(async () => {
        const jobs: Promise<unknown>[] = [];
        for (let i = 0; i < 8; i++) { h.log.addComment(h.id, U.bob, { content: `c${i}` }); jobs.push(h.store.commit()); }
        await Promise.all(jobs);
      });

      it('THEN nine comments are stored', async () => {
        expect(await count(pg, 'comments')).toBe(9);
      });
    });
  });
});

describe.skipIf(!HAS_PG)('only one instance may use a database at a time', () => {
  const pg = usePostgres();

  describe('GIVEN an open store', () => {
    beforeEach(async () => { await pg.open(); });

    describe('WHEN a second instance opens the same schema', () => {
      let opening: Promise<unknown>;
      beforeEach(() => { opening = pending(pg.open()); });

      it('THEN it is refused', async () => {
        await expect(opening).rejects.toThrow(/another instance/i);
      });
    });
  });

  describe('GIVEN the first instance closed', () => {
    beforeEach(async () => { await (await pg.open()).close(); });

    describe('WHEN another instance opens', () => {
      let second: unknown;
      beforeEach(async () => { second = await pg.open(); });

      it('THEN the lock was released', () => {
        expect(second).toBeTruthy();
      });
    });
  });
});

describe.skipIf(!HAS_PG)('losing the connection (and with it the lock) is reported and stops further commits', () => {
  const pg = usePostgres();

  /** Waits up to two seconds for `done()` to become true. */
  async function eventually(done: () => boolean) {
    for (let waited = 0; !done() && waited < 2000; waited += 20) await new Promise((r) => setTimeout(r, 20));
  }

  /** A seeded, committed store whose backend connection gets terminated; `lost` records the onConnectionLost argument. */
  function terminated() {
    const holder: { lost: unknown } = { lost: null };
    const h = seededPostgres(pg, () => {
      holder.lost = null;
      return { onConnectionLost: (e: unknown) => { holder.lost = e; } };
    });
    beforeEach(async () => {
      await h.store.commit();
      await pg.q('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1', [`decision-log:${pg.schema}`]);
    });
    return { h, holder, eventually: () => eventually(() => Boolean(holder.lost)) };
  }

  describe('GIVEN the backend connection is terminated', () => {
    const t = terminated();

    describe('WHEN the store notices', () => {
      beforeEach(async () => { await t.eventually(); });

      it('THEN the onConnectionLost callback fired', () => {
        expect(t.holder.lost).toBeTruthy();
      });
    });
  });

  describe('GIVEN a lost connection', () => {
    const t = terminated();
    beforeEach(async () => {
      await t.eventually();
      t.h.log.createDecision({ project: 'PRJ', actor: U.alice, title: 'after loss' });
    });

    describe('WHEN a further commit is attempted', () => {
      let committing: Promise<unknown>;
      beforeEach(() => { committing = pending(t.h.store.commit()); });

      it('THEN it rejects', async () => {
        await expect(committing).rejects.toThrow(/connection|lost|terminated/i);
      });
    });
  });
});

describe.skipIf(!HAS_PG)('the HTTP API acknowledges writes only after they are durable', () => {
  const pg = usePostgres();

  describe('GIVEN an API whose onMutation commits the store', () => {
    let base: string;
    beforeEach(async () => {
      const store = await pg.open();
      const log = await build(store, testBox());
      log.createOwner({ identifier: 'acme' });
      log.addTeamMember({ owner: 'acme', user: U.alice, actor: 'acme' });
      log.createProject({ owner: 'acme', identifier: 'PRJ', title: 'P', actor: 'acme' });
      ({ base } = await startApi(log, { onMutation: () => store.commit() }));
    });

    describe('WHEN a decision is POSTed', () => {
      let status: number;
      beforeEach(async () => {
        const res = await fetch(`${base}/decisions`, {
          method: 'POST', headers: { 'x-user': U.alice, 'content-type': 'application/json' },
          body: JSON.stringify({ project: 'PRJ', title: 'durable' }),
        });
        status = res.status;
      });

      it('THEN 201 arrives with the row already in the database', async () => {
        expect(status).toBe(201);
        const rows = await pg.q(`SELECT data->>'title' AS title FROM "${pg.schema}".decisions`);
        expect(rows.map((r: any) => r.title)).toEqual(['durable']);
      });
    });
  });
});
