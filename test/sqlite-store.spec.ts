import { describe, it, expect } from 'bun:test';
import { buildLog, SqliteStore, makeClock, testBox, tmpDbFile, act, expectCode, U, CONTENT_V1 } from './support/index.js';

let sharedBox: ReturnType<typeof testBox> | undefined;
const box = () => (sharedBox ??= testBox());

async function build(store: any) {
  const clock = makeClock();
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

describe('state committed to SQLite survives reopening, including audit chain and counters', () => {
  async function reopenedAfterApproval() {
    const file = tmpDbFile();
    const s1 = SqliteStore.open(file);
    const { log } = await build(s1);
    const id = seed(log);
    act(log, id, U.lead, 'approve');
    s1.commit();
    s1.close();
    const s2 = SqliteStore.open(file);
    const { log: again } = await build(s2);
    return { id, again, s2 };
  }

  describe('GIVEN an approved, committed decision', () => {
    describe('WHEN the file is reopened', () => {
      it('THEN status and comments persist', async () => {
        const { id, again } = await reopenedAfterApproval();
        const d = again.getDecision(id, U.alice);
        expect(d.status).toBe('approved');
        expect(d.comments.length).toBe(1);
      });
    });
  });

  describe('GIVEN a reopened store', () => {
    describe('WHEN the audit chain and integrity are verified', () => {
      it('THEN both hold', async () => {
        const { id, again } = await reopenedAfterApproval();
        expect(again.verifyAuditChain().ok).toBe(true);
        expect(again.verifyIntegrity(id).ok).toBe(true);
      });
    });
    describe('WHEN a decision is created', () => {
      it('THEN the counter continues at PRJ-002', async () => {
        const { again } = await reopenedAfterApproval();
        expect(again.createDecision({ project: 'PRJ', actor: U.alice, title: 'next' }).id).toBe('PRJ-002');
      });
    });
    describe('WHEN a comment is added', () => {
      it('THEN the comment counter continues at comment-002', async () => {
        const { id, again } = await reopenedAfterApproval();
        expect(again.addComment(id, U.bob, { content: 'second' }).id).toBe('comment-002');
      });
    });
  });
});

describe('uncommitted changes are not persisted; later commits are incremental and idempotent', () => {
  async function withUncommittedComment() {
    const file = tmpDbFile();
    const s1 = SqliteStore.open(file);
    const { log } = await build(s1);
    const id = seed(log);
    s1.commit();
    log.addComment(id, U.bob, { content: 'never committed' });
    s1.close();
    return { file, id };
  }

  describe('GIVEN a comment added after the last commit', () => {
    describe('WHEN the file is reopened', () => {
      it('THEN only the committed comment exists', async () => {
        const { file, id } = await withUncommittedComment();
        const s2 = SqliteStore.open(file);
        expect((await build(s2)).log.getDecision(id, U.alice).comments.length).toBe(1);
        s2.close();
      });
    });
  });

  describe('GIVEN a reopened store', () => {
    describe('WHEN commit is called twice without changes', () => {
      it('THEN neither call throws', async () => {
        const { file } = await withUncommittedComment();
        const s2 = SqliteStore.open(file);
        await build(s2);
        expect(() => { s2.commit(); s2.commit(); }).not.toThrow();
        s2.close();
      });
    });
  });
});

describe('deletions are persisted', () => {
  describe('GIVEN a committed draft', () => {
    describe('WHEN it is deleted and committed', () => {
      it('THEN after reopening it is NOT_FOUND and the project count is 1', async () => {
        // Given
        const file = tmpDbFile();
        const s1 = SqliteStore.open(file);
        const { log } = await build(s1);
        seed(log);
        const draft = log.createDecision({ project: 'PRJ', actor: U.alice, title: 'throwaway' });
        s1.commit();
        // When
        log.deleteDraft(draft.id, U.alice);
        s1.commit();
        s1.close();
        // Then
        const s2 = SqliteStore.open(file);
        const { log: again } = await build(s2);
        expectCode(() => again.getDecision(draft.id, U.alice), 'NOT_FOUND');
        expect(again.getProject('PRJ').decision_count).toBe(1);
        s2.close();
      });
    });
  });
});

describe('a failed commit rolls back as a whole', () => {
  describe('GIVEN a pending good comment and an unserialisable row', () => {
    describe('WHEN commit is called', () => {
      it('THEN it throws', async () => {
        // Given
        const s1 = SqliteStore.open(tmpDbFile());
        const { log } = await build(s1);
        const id = seed(log);
        s1.commit();
        log.addComment(id, U.bob, { content: 'will not be saved' });
        s1.comments.push({ id: 'bad', decision_id: id, circular: 1n }); // BigInt cannot be serialised
        // When / Then
        expect(() => s1.commit()).toThrow();
        s1.comments.pop();
        s1.close();
      });
    });
  });

  describe('GIVEN a commit that failed', () => {
    describe('WHEN the file is reopened', () => {
      it('THEN none of the failed batch was written', async () => {
        // Given
        const file = tmpDbFile();
        const s1 = SqliteStore.open(file);
        const { log } = await build(s1);
        const id = seed(log);
        s1.commit();
        log.addComment(id, U.bob, { content: 'will not be saved' });
        s1.comments.push({ id: 'bad', decision_id: id, circular: 1n });
        try { s1.commit(); } catch { /* expected */ }
        s1.comments.pop();
        s1.close();
        // When
        const s2 = SqliteStore.open(file);
        // Then
        expect((await build(s2)).log.getDecision(id, U.alice).comments.length).toBe(1);
        s2.close();
      });
    });
  });
});
