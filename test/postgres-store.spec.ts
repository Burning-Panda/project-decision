import { describe, it, expect } from 'bun:test';
import {
  PostgresStore, MemoryStore, MIGRATIONS, MAP_COLLECTIONS, ARRAY_COLLECTIONS, RECORD_COLLECTIONS,
  buildLog, startApi, makeClock, testBox, usePostgres, statementLog, HAS_PG, expectCode, act, U, CONTENT_V1,
} from './support/index.js';

let sharedBox: ReturnType<typeof testBox> | undefined;
const box = () => (sharedBox ??= testBox());

async function build(store: any, clock = makeClock()) {
  const log = await buildLog({ store, clock: clock.now, secretBox: box() });
  return { log, clock };
}

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

// ---------------------------------------------------------------- pure checks (no database needed)
describe('migrations are ordered, unique and cover every store collection', () => {
  describe('GIVEN the migration list', () => {
    describe('WHEN counted', () => {
      it('THEN at least one migration exists', () => {
        expect(MIGRATIONS.length).toBeGreaterThanOrEqual(1);
      });
    });
    describe('WHEN versions are read', () => {
      it('THEN they are 1..n with no gaps or repeats', () => {
        expect(MIGRATIONS.map((m: any) => m.version)).toEqual(MIGRATIONS.map((_: any, i: number) => i + 1));
      });
    });
  });

  for (const c of [...MAP_COLLECTIONS, ...ARRAY_COLLECTIONS, ...RECORD_COLLECTIONS]) {
    describe(`GIVEN migration 1 for schema "s"`, () => {
      describe(`WHEN its SQL is read`, () => {
        it(`THEN it creates a table for ${c}`, () => {
          expect(MIGRATIONS[0].up('s')).toMatch(new RegExp(`"s"\\."${c}"`));
        });
      });
    });
  }

  describe('GIVEN a memory store', () => {
    describe('WHEN persistent is read', () => {
      it('THEN it is false', () => {
        expect(new MemoryStore().persistent).toBe(false);
      });
    });
  });
});

describe('schema names are validated before they can reach SQL', () => {
  describe('GIVEN an injection-style schema name', () => {
    describe('WHEN the store is opened', () => {
      it('THEN it is rejected', async () => {
        await expect(PostgresStore.open('postgres://x', { schema: 'bad-name; drop table x' })).rejects.toThrow(/schema name/i);
      });
    });
  });

  describe('GIVEN an upper-case schema name', () => {
    describe('WHEN the store is opened', () => {
      it('THEN it is rejected', async () => {
        await expect(PostgresStore.open('postgres://x', { schema: 'Upper' })).rejects.toThrow(/schema name/i);
      });
    });
  });
});

// ---------------------------------------------------------------- database tests (need TEST_DATABASE_URL)
describe.skipIf(!HAS_PG)('opening applies migrations once and records them', () => {
  const pg = usePostgres();

  describe('GIVEN an empty schema', () => {
    describe('WHEN the store is opened', () => {
      it('THEN every migration is recorded in order', async () => {
        const s1 = await pg.open();
        const applied = await pg.q(`SELECT version, name FROM "${pg.schema}".schema_migrations ORDER BY version`);
        expect(applied.map((r: any) => r.version)).toEqual(MIGRATIONS.map((m: any) => m.version));
        await s1.close();
      });
    });
  });

  describe('GIVEN an already migrated schema', () => {
    describe('WHEN it is reopened', () => {
      it('THEN migrations are not re-applied and the store is persistent', async () => {
        const s1 = await pg.open();
        await s1.close();
        const s2 = await pg.open();
        const n = (await pg.q(`SELECT count(*)::int AS n FROM "${pg.schema}".schema_migrations`))[0].n;
        expect(n).toBe(MIGRATIONS.length);
        expect(s2.persistent).toBe(true);
      });
    });
  });
});

describe.skipIf(!HAS_PG)('refuses a database whose schema is newer than the application', () => {
  const pg = usePostgres();

  describe('GIVEN a schema recording migration 999', () => {
    describe('WHEN the store is opened', () => {
      it('THEN it refuses as newer', async () => {
        const s = await pg.open();
        await s.close();
        await pg.q(`INSERT INTO "${pg.schema}".schema_migrations (version, name) VALUES (999, 'from the future')`);
        await expect(pg.open()).rejects.toThrow(/newer/i);
      });
    });
  });
});

describe.skipIf(!HAS_PG)('state survives reopening, including audit chain, integrity and counters', () => {
  const pg = usePostgres();

  async function reopened() {
    const s1 = await pg.open();
    const { log } = await build(s1);
    const id = seed(log);
    act(log, id, U.lead, 'approve');
    await s1.commit();
    await s1.close();
    const { log: again } = await build(await pg.open());
    return { id, again };
  }

  describe('GIVEN an approved committed decision', () => {
    describe('WHEN the schema is reopened', () => {
      it('THEN status and comments persist', async () => {
        const { id, again } = await reopened();
        const d = again.getDecision(id, U.alice);
        expect(d.status).toBe('approved');
        expect(d.comments.length).toBe(1);
      });
    });
  });

  describe('GIVEN a reopened schema', () => {
    describe('WHEN the audit chain and integrity are verified', () => {
      it('THEN both hold', async () => {
        const { id, again } = await reopened();
        expect(again.verifyAuditChain().ok).toBe(true);
        expect(again.verifyIntegrity(id).ok).toBe(true);
      });
    });
    describe('WHEN a decision is created', () => {
      it('THEN numbering continues at PRJ-002', async () => {
        const { again } = await reopened();
        expect(again.createDecision({ project: 'PRJ', actor: U.alice, title: 'next' }).id).toBe('PRJ-002');
      });
    });
    describe('WHEN a comment is added', () => {
      it('THEN ids continue at comment-002', async () => {
        const { id, again } = await reopened();
        expect(again.addComment(id, U.bob, { content: 'second' }).id).toBe('comment-002');
      });
    });
  });
});

describe.skipIf(!HAS_PG)('data is stored as queryable jsonb, one table per collection', () => {
  const pg = usePostgres();

  async function committed() {
    const s = await pg.open();
    const { log } = await build(s);
    seed(log);
    await s.commit();
  }

  describe('GIVEN a committed decision', () => {
    describe('WHEN the decisions table is queried by jsonb path', () => {
      it('THEN key, status and title are readable', async () => {
        await committed();
        const rows = await pg.q(`SELECT k, data->>'status' AS status, data->>'title' AS title FROM "${pg.schema}".decisions`);
        expect(rows.map((r: any) => [r.k, r.status, r.title])).toEqual([['PRJ-001', 'proposed', 'Persist me']]);
      });
    });
    describe('WHEN the audit table is queried by decision_id', () => {
      it('THEN its three entries are there', async () => {
        await committed();
        const n = (await pg.q(`SELECT count(*)::int AS n FROM "${pg.schema}".audit WHERE data->>'decision_id' = 'PRJ-001'`))[0].n;
        expect(n).toBe(3);
      });
    });
  });
});

describe.skipIf(!HAS_PG)('commits are incremental: unchanged state writes nothing, a change touches only its table', () => {
  const pg = usePostgres();

  async function committedStore() {
    const rec = statementLog();
    const s = await pg.open({ onStatement: rec.hook });
    const { log } = await build(s);
    const id = seed(log);
    await s.commit();
    rec.start();
    return { s, log, id, statements: rec.statements };
  }

  describe('GIVEN a fully committed store', () => {
    describe('WHEN commit is called again', () => {
      it('THEN no statements are sent', async () => {
        const { s, statements } = await committedStore();
        await s.commit();
        expect(statements).toEqual([]);
      });
    });
  });

  describe('GIVEN a committed store', () => {
    describe('WHEN a comment is resolved and committed', () => {
      it('THEN only the comments table is written', async () => {
        const { s, log, id, statements } = await committedStore();
        log.resolveComment(id, 'comment-001', U.alice);
        await s.commit();
        const writes = statements.filter((x) => /INSERT|DELETE|UPDATE/i.test(x));
        expect(writes.some((x) => x.includes('"comments"'))).toBe(true);
        expect(writes.some((x) => x.includes('"decisions"'))).toBe(false);
      });
    });
  });
});

describe.skipIf(!HAS_PG)('reopening does not rewrite rows just because jsonb reorders object keys', () => {
  const pg = usePostgres();

  describe('GIVEN a committed schema', () => {
    describe('WHEN it is reopened and committed', () => {
      it('THEN no INSERT or DELETE is sent', async () => {
        // Given
        const s1 = await pg.open();
        seed((await build(s1)).log);
        await s1.commit();
        await s1.close();
        const rec = statementLog();
        const s2 = await pg.open({ onStatement: rec.hook });
        await build(s2);
        rec.start();
        // When
        await s2.commit();
        // Then
        expect(rec.statements.filter((x) => /INSERT|DELETE/i.test(x))).toEqual([]);
      });
    });
  });
});

describe.skipIf(!HAS_PG)('deletions are persisted', () => {
  const pg = usePostgres();

  describe('GIVEN a committed draft', () => {
    describe('WHEN it is deleted, committed and the schema reopened', () => {
      it('THEN it is NOT_FOUND and the count is 1', async () => {
        // Given
        const s1 = await pg.open();
        const { log } = await build(s1);
        seed(log);
        const draft = log.createDecision({ project: 'PRJ', actor: U.alice, title: 'throwaway' });
        await s1.commit();
        // When
        log.deleteDraft(draft.id, U.alice);
        await s1.commit();
        await s1.close();
        // Then
        const { log: again } = await build(await pg.open());
        expectCode(() => again.getDecision(draft.id, U.alice), 'NOT_FOUND');
        expect(again.getProject('PRJ').decision_count).toBe(1);
      });
    });
  });
});

describe.skipIf(!HAS_PG)('a failing commit is atomic and the next commit recovers', () => {
  const pg = usePostgres();

  async function withBadBatch() {
    const s = await pg.open();
    const { log } = await build(s);
    const id = seed(log);
    await s.commit();
    log.addComment(id, U.bob, { content: 'fine comment' });
    log.addComment(id, U.bob, { content: 'bad\u0000comment' }); // jsonb cannot store NUL
    return { s };
  }
  const commentCount = async (pg2: any) => (await pg2.q(`SELECT count(*)::int AS n FROM "${pg2.schema}".comments`))[0].n;

  describe('GIVEN a batch containing a NUL character', () => {
    describe('WHEN committed', () => {
      it('THEN it rejects and nothing from the batch is written', async () => {
        const { s } = await withBadBatch();
        await expect(s.commit()).rejects.toThrow(/unicode|escape|\\u0000/i);
        expect(await commentCount(pg)).toBe(1);
      });
    });
  });

  describe('GIVEN a failed batch', () => {
    describe('WHEN the offending row is removed and commit is retried', () => {
      it('THEN the good comment is written', async () => {
        const { s } = await withBadBatch();
        await s.commit().catch(() => {});
        s.comments.pop();
        await s.commit();
        expect(await commentCount(pg)).toBe(2);
      });
    });
  });
});

describe.skipIf(!HAS_PG)('concurrent commits are serialised and converge on the in-memory state', () => {
  const pg = usePostgres();

  describe('GIVEN eight comments each followed by a commit started without awaiting', () => {
    describe('WHEN all settle', () => {
      it('THEN nine comments are stored', async () => {
        // Given
        const s = await pg.open();
        const { log } = await build(s);
        const id = seed(log);
        const jobs: Promise<unknown>[] = [];
        // When
        for (let i = 0; i < 8; i++) { log.addComment(id, U.bob, { content: `c${i}` }); jobs.push(s.commit()); }
        await Promise.all(jobs);
        // Then
        expect((await pg.q(`SELECT count(*)::int AS n FROM "${pg.schema}".comments`))[0].n).toBe(9);
      });
    });
  });
});

describe.skipIf(!HAS_PG)('only one instance may use a database at a time', () => {
  const pg = usePostgres();

  describe('GIVEN an open store', () => {
    describe('WHEN a second instance opens the same schema', () => {
      it('THEN it is refused', async () => {
        await pg.open();
        await expect(pg.open()).rejects.toThrow(/another instance/i);
      });
    });
  });

  describe('GIVEN the first instance closed', () => {
    describe('WHEN another instance opens', () => {
      it('THEN the lock was released', async () => {
        const first = await pg.open();
        await first.close();
        expect(await pg.open()).toBeTruthy();
      });
    });
  });
});

describe.skipIf(!HAS_PG)('losing the connection (and with it the lock) is reported and stops further commits', () => {
  const pg = usePostgres();

  async function afterTermination() {
    const holder: { lost: unknown } = { lost: null };
    const s = await pg.open({ onConnectionLost: (e: unknown) => { holder.lost = e; } });
    const { log } = await build(s);
    seed(log);
    await s.commit();
    await pg.q('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1', [`decision-log:${pg.schema}`]);
    await new Promise((r) => setTimeout(r, 200));
    return { s, log, holder };
  }

  describe('GIVEN the backend connection is terminated', () => {
    describe('WHEN a moment passes', () => {
      it('THEN the onConnectionLost callback fired', async () => {
        const { holder } = await afterTermination();
        expect(holder.lost).toBeTruthy();
      });
    });
  });

  describe('GIVEN a lost connection', () => {
    describe('WHEN a further commit is attempted', () => {
      it('THEN it rejects', async () => {
        const { s, log } = await afterTermination();
        log.createDecision({ project: 'PRJ', actor: U.alice, title: 'after loss' });
        await expect(s.commit()).rejects.toThrow(/connection|lost|terminated/i);
      });
    });
  });
});

describe.skipIf(!HAS_PG)('the HTTP API acknowledges writes only after they are durable', () => {
  const pg = usePostgres();

  describe('GIVEN an API whose onMutation commits the store', () => {
    describe('WHEN a decision is POSTed', () => {
      it('THEN 201 arrives with the row already in the database', async () => {
        // Given
        const s = await pg.open();
        const { log } = await build(s);
        log.createOwner({ identifier: 'acme' });
        log.addTeamMember({ owner: 'acme', user: U.alice, actor: 'acme' });
        log.createProject({ owner: 'acme', identifier: 'PRJ', title: 'P', actor: 'acme' });
        const { base } = await startApi(log, { onMutation: () => s.commit() });
        // When
        const res = await fetch(`${base}/decisions`, {
          method: 'POST', headers: { 'x-user': U.alice, 'content-type': 'application/json' },
          body: JSON.stringify({ project: 'PRJ', title: 'durable' }),
        });
        // Then
        expect(res.status).toBe(201);
        const rows = await pg.q(`SELECT data->>'title' AS title FROM "${pg.schema}".decisions`);
        expect(rows.map((r: any) => r.title)).toEqual(['durable']);
      });
    });
  });
});
