import { describe, it, expect, beforeEach } from 'bun:test';
import { buildLog, SqliteStore, makeClock, testBox, tmpDbFile, onCleanup, act, expectCode, U, CONTENT_V1 } from './support/index';

// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.
// Every test gets its own database file and secret box; every store opened is closed after the test.

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

describe('uncommitted changes are not persisted; later commits are incremental and idempotent', () => {
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
