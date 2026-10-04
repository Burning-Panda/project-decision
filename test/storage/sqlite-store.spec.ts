import { SQL } from 'bun';
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  buildLog, SqliteStore, SQLITE_MIGRATIONS, allCollections, makeClock, testBox, tmpDbFile, onCleanup, act, expectCode, U, CONTENT_V1,
} from '../support/index';

// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.
// Every test gets its own database file (and secret box); every store opened is closed after the test.
// The first sections use the store on its own (documents in, documents out); the later ones run a whole log on it.

const ACME = { identifier: 'acme', name: 'Acme Inc' };

/** Opens `file` as a bare store, closed after the test. */
function openStore(file: string): any {
  const store: any = SqliteStore.open(file);
  onCleanup(() => store.close());
  return store;
}

/** Runs `query` against `file` with a separate read-write connection and returns the rows. */
async function sql(file: string, query: string): Promise<any[]> {
  const db = new SQL({ adapter: 'sqlite', filename: file });
  try { return await db.unsafe(query); } finally { await db.close(); }
}

// ---------------------------------------------------------------- the store on its own
describe('SQLite migrations are numbered 1..n and together give every collection a table', () => {
  describe('GIVEN the SQLite migration list', () => {
    describe('WHEN its versions are read', () => {
      let versions: number[];
      beforeEach(() => { versions = SQLITE_MIGRATIONS.map((m) => m.version); });

      it('THEN at least one migration exists', () => {
        expect(versions.length).toBeGreaterThanOrEqual(1);
      });

      it('THEN they are 1..n with no gaps or repeats', () => {
        expect(versions).toEqual(versions.map((_, i) => i + 1));
      });
    });
  });

  for (const { name } of allCollections()) {
    describe('GIVEN every SQLite migration', () => {
      describe('WHEN their SQL is read', () => {
        let ddl: string;
        beforeEach(() => { ddl = SQLITE_MIGRATIONS.map((m) => m.up()).join('\n'); });

        it(`THEN a table is created for ${name}`, () => {
          expect(ddl).toMatch(new RegExp(`CREATE TABLE (IF NOT EXISTS )?"?${name}"?\\s*\\(`, 'i'));
        });
      });
    });
  }
});

describe('opening a SQLite file applies migrations once, records them, and refuses a newer database', () => {
  describe('GIVEN a new file', () => {
    let file: string;
    beforeEach(() => { file = tmpDbFile(); });

    describe('WHEN it is opened and closed', () => {
      beforeEach(() => { openStore(file).close(); });

      it('THEN every migration is recorded in schema_migrations, in order', async () => {
        const rows = await sql(file, 'SELECT version FROM schema_migrations ORDER BY version');
        expect(rows.map((r) => r.version)).toEqual(SQLITE_MIGRATIONS.map((m) => m.version));
      });
    });
  });

  describe('GIVEN a file that was already opened once', () => {
    let file: string;
    beforeEach(() => {
      file = tmpDbFile();
      openStore(file).close();
    });

    describe('WHEN it is opened again', () => {
      beforeEach(() => { openStore(file).close(); });

      it('THEN no migration is applied twice', async () => {
        const [{ n }] = await sql(file, 'SELECT count(*) AS n FROM schema_migrations');
        expect(n).toBe(SQLITE_MIGRATIONS.length);
      });
    });
  });

  describe('GIVEN a file whose schema_migrations records version 999', () => {
    let file: string;
    beforeEach(async () => {
      file = tmpDbFile();
      openStore(file).close();
      await sql(file, "INSERT INTO schema_migrations (version, name) VALUES (999, 'from the future')");
    });

    describe('WHEN it is opened', () => {
      let opening: () => unknown;
      beforeEach(() => { opening = () => openStore(file); });

      it('THEN it refuses: the database is newer than the application', () => {
        expect(opening).toThrow(/newer/i);
      });
    });
  });
});

describe('SQLite keeps one table per collection, each document as JSON', () => {
  describe('GIVEN owner acme committed and the file closed', () => {
    let file: string;
    beforeEach(() => {
      file = tmpDbFile();
      const store = openStore(file);
      store.owners.set('acme', ACME);
      store.commit();
      store.close();
    });

    describe('WHEN the owners table is queried', () => {
      let rows: any[];
      beforeEach(async () => { rows = await sql(file, 'SELECT k, data FROM owners'); });

      it('THEN there is one row keyed acme holding the document as JSON', () => {
        expect(rows.map((r) => r.k)).toEqual(['acme']);
        expect(JSON.parse(rows[0].data)).toEqual(ACME);
      });
    });
  });
});

describe('committed documents survive reopening; uncommitted ones and deleted ones do not', () => {
  describe('GIVEN acme committed, then globex added without committing, and the file closed', () => {
    let file: string;
    beforeEach(() => {
      file = tmpDbFile();
      const store = openStore(file);
      store.owners.set('acme', ACME);
      store.commit();
      store.owners.set('globex', { identifier: 'globex' });
      store.close();
    });

    describe('WHEN the file is reopened', () => {
      let again: any;
      beforeEach(() => { again = openStore(file); });

      it('THEN acme is there and globex is not', () => {
        expect(again.owners.get('acme')).toEqual(ACME);
        expect(again.owners.has('globex')).toBe(false);
      });

      it('THEN the store reports that it is persistent', () => {
        expect(again.persistent).toBe(true);
      });
    });
  });

  describe('GIVEN acme committed, then deleted and committed again', () => {
    let file: string;
    beforeEach(() => {
      file = tmpDbFile();
      const store = openStore(file);
      store.owners.set('acme', ACME);
      store.commit();
      store.owners.delete('acme');
      store.commit();
      store.close();
    });

    describe('WHEN the file is reopened', () => {
      let again: any;
      beforeEach(() => { again = openStore(file); });

      it('THEN acme is gone', () => {
        expect(again.owners.has('acme')).toBe(false);
      });
    });
  });
});

// ---------------------------------------------------------------- a whole log on SQLite

type Opened = { log: any; store: any };
type SqliteHandle = Opened & { id: string; reopen: () => Promise<Opened> };

/** Opens `file` as a SQLite-backed log; the store is closed after the test (closing twice is harmless). */
async function open(file: string, box: ReturnType<typeof testBox>): Promise<Opened> {
  const store = SqliteStore.open(file);
  onCleanup(() => store.close());
  const log = await buildLog({ store, clock: makeClock().now, secretBox: box });
  return { log, store };
}

/**
 * Call inside a describe(): a SQLite-backed log seeded with org acme, alice, bob, the lead, project PRJ
 * and PRJ-001 proposed by alice with one comment by bob (`id`), not yet committed. `reopen()` opens the file again.
 */
function seededSqlite(): SqliteHandle {
  const h = {} as SqliteHandle;
  beforeEach(async () => {
    const file = tmpDbFile();
    const box = testBox();
    Object.assign(h, await open(file, box));
    h.reopen = () => open(file, box);
    const { log } = h;
    log.createOwner({ identifier: 'acme' });
    for (const u of [U.alice, U.bob]) log.addTeamMember({ owner: 'acme', user: u, actor: 'acme' });
    log.addTeamMember({ owner: 'acme', user: U.lead, role: 'lead', actor: 'acme' });
    log.createProject({ owner: 'acme', identifier: 'PRJ', title: 'P', actor: 'acme' });
    h.id = log.createDecision({ project: 'PRJ', actor: U.alice, title: 'Persist me', content: CONTENT_V1 }).id;
    act(log, h.id, U.alice, 'propose');
    log.addComment(h.id, U.bob, { content: 'looks fine' });
  });
  return h;
}

describe('state committed to SQLite survives reopening, including audit chain and counters', () => {
  /** The seeded decision approved, committed, and the first store closed. */
  function approvedAndCommitted() {
    const h = seededSqlite();
    beforeEach(() => {
      act(h.log, h.id, U.lead, 'approve');
      h.store.commit();
      h.store.close();
    });
    return h;
  }

  describe('GIVEN an approved, committed decision', () => {
    const h = approvedAndCommitted();

    describe('WHEN the file is reopened', () => {
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

  describe('GIVEN a reopened store', () => {
    const h = approvedAndCommitted();
    let again: any;
    beforeEach(async () => { ({ log: again } = await h.reopen()); });

    describe('WHEN a decision is created', () => {
      let d: any;
      beforeEach(() => { d = again.createDecision({ project: 'PRJ', actor: U.alice, title: 'next' }); });

      it('THEN the counter continues at PRJ-002', () => {
        expect(d.id).toBe('PRJ-002');
      });
    });

    describe('WHEN a comment is added', () => {
      let c: any;
      beforeEach(() => { c = again.addComment(h.id, U.bob, { content: 'second' }); });

      it('THEN the comment counter continues at comment-002', () => {
        expect(c.id).toBe('comment-002');
      });
    });
  });
});

describe('uncommitted changes are not persisted; committing again changes nothing', () => {
  /** The seeded state committed, then a second comment added without committing, and the store closed. */
  function withUncommittedComment() {
    const h = seededSqlite();
    beforeEach(() => {
      h.store.commit();
      h.log.addComment(h.id, U.bob, { content: 'never committed' });
      h.store.close();
    });
    return h;
  }

  describe('GIVEN a comment added after the last commit', () => {
    const h = withUncommittedComment();

    describe('WHEN the file is reopened', () => {
      let again: any;
      beforeEach(async () => { ({ log: again } = await h.reopen()); });

      it('THEN only the committed comment exists', () => {
        expect(again.getDecision(h.id, U.alice).comments.length).toBe(1);
      });
    });
  });

  describe('GIVEN a reopened store', () => {
    const h = withUncommittedComment();
    let reopened: Opened;
    beforeEach(async () => { reopened = await h.reopen(); });

    describe('WHEN commit is called twice without changes', () => {
      let commitTwice: () => unknown;
      beforeEach(() => { commitTwice = () => { reopened.store.commit(); reopened.store.commit(); }; });

      it('THEN neither call throws', () => {
        expect(commitTwice).not.toThrow();
      });
    });
  });
});

describe('deletions are persisted', () => {
  describe('GIVEN a committed draft that was then deleted and committed', () => {
    const h = seededSqlite();
    let draftId: string;
    beforeEach(() => {
      draftId = h.log.createDecision({ project: 'PRJ', actor: U.alice, title: 'throwaway' }).id;
      h.store.commit();
      h.log.deleteDraft(draftId, U.alice);
      h.store.commit();
      h.store.close();
    });

    describe('WHEN the file is reopened', () => {
      let again: any;
      beforeEach(async () => { ({ log: again } = await h.reopen()); });

      it('THEN the draft is NOT_FOUND and the project count is 1', () => {
        expectCode(() => again.getDecision(draftId, U.alice), 'NOT_FOUND');
        expect(again.getProject('PRJ').decision_count).toBe(1);
      });
    });
  });
});

describe('a failed commit rolls back as a whole', () => {
  /** The seeded state committed, then a good comment and an unserialisable row pending. */
  function badBatch() {
    const h = seededSqlite();
    beforeEach(() => {
      h.store.commit();
      h.log.addComment(h.id, U.bob, { content: 'will not be saved' });
      h.store.comments.push({ id: 'bad', decision_id: h.id, circular: 1n }); // BigInt cannot be serialised
    });
    return h;
  }

  describe('GIVEN a pending good comment and an unserialisable row', () => {
    const h = badBatch();

    describe('WHEN commit is called', () => {
      let commit: () => unknown;
      beforeEach(() => { commit = () => h.store.commit(); });

      it('THEN it throws', () => {
        expect(commit).toThrow();
      });
    });
  });

  describe('GIVEN a commit that failed and a closed store', () => {
    const h = badBatch();
    beforeEach(() => {
      try { h.store.commit(); } catch { /* expected */ }
      h.store.comments.pop();
      h.store.close();
    });

    describe('WHEN the file is reopened', () => {
      let again: any;
      beforeEach(async () => { ({ log: again } = await h.reopen()); });

      it('THEN none of the failed batch was written', () => {
        expect(again.getDecision(h.id, U.alice).comments.length).toBe(1);
      });
    });
  });
});
