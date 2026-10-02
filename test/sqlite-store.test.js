import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DecisionLog } from '../src/decision-log.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { makeClock, U, CONTENT_V1, act, testBox } from './helpers.js';

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
  return { file: path.join(dir, 'log.db'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const box = testBox();
function build(store) {
  const clock = makeClock();
  const log = new DecisionLog({ store, clock: clock.now, secretBox: box });
  return { log, clock };
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

test('state committed to SQLite survives reopening, including audit chain and counters', () => {
  const { file, cleanup } = tmpDb();
  try {
    const s1 = SqliteStore.open(file);
    const { log } = build(s1);
    const id = seed(log);
    act(log, id, U.lead, 'approve');
    s1.commit();
    s1.close();

    const s2 = SqliteStore.open(file);
    const { log: again } = build(s2);
    const d = again.getDecision(id, U.alice);
    assert.equal(d.status, 'approved');
    assert.equal(d.comments.length, 1);
    assert.equal(again.verifyAuditChain().ok, true);
    assert.equal(again.verifyIntegrity(id).ok, true);
    assert.equal(again.createDecision({ project: 'PRJ', actor: U.alice, title: 'next' }).id, 'PRJ-002');
    assert.equal(again.addComment(id, U.bob, { content: 'second' }).id, 'comment-002', 'counters persisted');
    s2.close();
  } finally { cleanup(); }
});

test('uncommitted changes are not persisted; later commits are incremental and idempotent', () => {
  const { file, cleanup } = tmpDb();
  try {
    const s1 = SqliteStore.open(file);
    const { log } = build(s1);
    const id = seed(log);
    s1.commit();
    log.addComment(id, U.bob, { content: 'never committed' });
    s1.close();

    const s2 = SqliteStore.open(file);
    assert.equal(build(s2).log.getDecision(id, U.alice).comments.length, 1);
    s2.commit();
    s2.commit();
    s2.close();
  } finally { cleanup(); }
});

test('deletions are persisted', () => {
  const { file, cleanup } = tmpDb();
  try {
    const s1 = SqliteStore.open(file);
    const { log } = build(s1);
    seed(log);
    const draft = log.createDecision({ project: 'PRJ', actor: U.alice, title: 'throwaway' });
    s1.commit();
    log.deleteDraft(draft.id, U.alice);
    s1.commit();
    s1.close();

    const s2 = SqliteStore.open(file);
    const { log: again } = build(s2);
    assert.throws(() => again.getDecision(draft.id, U.alice), { code: 'NOT_FOUND' });
    assert.equal(again.getProject('PRJ').decision_count, 1);
    s2.close();
  } finally { cleanup(); }
});

test('a failed commit rolls back as a whole', () => {
  const { file, cleanup } = tmpDb();
  try {
    const s1 = SqliteStore.open(file);
    const { log } = build(s1);
    const id = seed(log);
    s1.commit();
    log.addComment(id, U.bob, { content: 'will not be saved' });
    s1.comments.push({ id: 'bad', decision_id: id, circular: 1n }); // BigInt cannot be serialised
    assert.throws(() => s1.commit());
    s1.comments.pop();
    s1.close();

    const s2 = SqliteStore.open(file);
    assert.equal(build(s2).log.getDecision(id, U.alice).comments.length, 1);
    s2.close();
  } finally { cleanup(); }
});
