import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { SecretBox } from '../src/secrets.js';
import { DecisionLog } from '../src/decision-log.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { MemoryStore } from '../src/store.js';
import { WebhookDispatcher } from '../src/webhooks.js';
import { makeClock, U, draft, assertCode } from './helpers.js';

const key = () => randomBytes(32);
const boxOf = (...keys) => new SecretBox({ keys });

test('encrypt/decrypt round trip; ciphertext is randomised and carries the key id', () => {
  const box = boxOf(key());
  const a = box.encrypt('whsec_abc', 'webhook-001');
  const b = box.encrypt('whsec_abc', 'webhook-001');
  assert.notEqual(a, b, 'fresh IV every time');
  assert.match(a, /^enc:v1:[0-9a-f]{8}:/);
  assert.equal(a.includes('whsec_abc'), false);
  assert.equal(box.decrypt(a, 'webhook-001'), 'whsec_abc');
  assert.equal(SecretBox.isEncrypted(a), true);
  assert.equal(SecretBox.isEncrypted('whsec_abc'), false);
});

test('ciphertext is bound to its record, key and integrity', () => {
  const box = boxOf(key());
  const token = box.encrypt('s3cret', 'webhook-001');
  assert.throws(() => box.decrypt(token, 'webhook-002'), /decrypt/i, 'swapping between records fails');
  const parts = token.split(':');
  parts[5] = Buffer.from('tampered!').toString('base64');
  assert.throws(() => box.decrypt(parts.join(':'), 'webhook-001'), /decrypt/i);
  assert.throws(() => boxOf(key()).decrypt(token, 'webhook-001'), /key/i, 'unknown key id');
  assert.throws(() => box.decrypt('not-encrypted', 'x'), /encrypted/i);
});

test('keys must be 32 bytes; fromEnv understands base64 and hex and previous keys', () => {
  assert.throws(() => new SecretBox({ keys: [randomBytes(16)] }), /32 bytes/);
  assert.throws(() => new SecretBox({ keys: [] }), /at least one key/);
  const k1 = key(), k2 = key();
  const box = SecretBox.fromEnv({ SECRETS_KEY: k1.toString('base64'), SECRETS_KEY_PREVIOUS: `${k2.toString('hex')}` });
  const old = boxOf(k2).encrypt('x', 'a');
  assert.equal(box.decrypt(old, 'a'), 'x', 'previous keys still decrypt');
  assert.equal(box.needsRotation(old), true);
  assert.equal(box.needsRotation(box.encrypt('x', 'a')), false);
  assert.equal(SecretBox.fromEnv({}), null, 'no key configured');
  assert.throws(() => SecretBox.fromEnv({ SECRETS_KEY: 'short' }), /32 bytes/);
});

function hookedLog(box, store = new MemoryStore()) {
  const clock = makeClock();
  const log = new DecisionLog({ store, clock: clock.now, secretBox: box });
  log.createOwner({ identifier: 'acme' });
  log.addTeamMember({ owner: 'acme', user: U.alice, actor: 'acme' });
  log.createProject({ owner: 'acme', identifier: 'PRJ', title: 'P', actor: 'acme' });
  return { log, clock };
}

test('webhook secrets are encrypted in the store and absent from every serialised form', () => {
  const { log } = hookedLog(boxOf(key()));
  const hook = log.createWebhook({ owner: 'acme', url: 'https://hooks.example.com/x', actor: 'acme' });
  assert.match(hook.secret, /^whsec_/, 'plaintext is returned once, at creation');
  const stored = log.store.webhooks[0];
  assert.equal('secret' in stored, false);
  assert.match(stored.secret_enc, /^enc:v1:/);
  const dump = JSON.stringify(log.store.toJSON()) + JSON.stringify(log.auditTrail());
  assert.equal(dump.includes(hook.secret), false);
  assert.equal('secret_enc' in log.listWebhooks('acme', 'acme')[0], false, 'listings never expose the ciphertext either');
});

test('the dispatcher still signs with the decrypted secret', async () => {
  const { log } = hookedLog(boxOf(key()));
  const hook = log.createWebhook({ owner: 'acme', url: 'https://hooks.example.com/x', events: ['decision.created'], actor: 'acme' });
  log.createDecision({ project: 'PRJ', actor: U.alice, title: 'x' });
  const { verifySignature } = await import('../src/webhooks.js');
  let seen;
  await new WebhookDispatcher(log, { resolve: async () => ['93.184.216.34'], transport: async (_u, init) => { seen = init; return { status: 200 }; } }).run();
  assert.equal(verifySignature({ secret: hook.secret, timestamp: seen.headers['x-decision-log-timestamp'], body: seen.body, signature: seen.headers['x-decision-log-signature'], now: log.clock() }), true);
});

test('legacy plaintext secrets are encrypted automatically when the log starts', () => {
  const store = new MemoryStore();
  store.webhooks.push({ id: 'webhook-001', owner: 'acme', url: 'https://x.example.com', events: ['*'], secret: 'whsec_legacy', active: true, created_by: 'acme', created_at: '2024-01-01T00:00:00.000Z', deleted_at: null });
  const box = boxOf(key());
  const log = new DecisionLog({ store, secretBox: box });
  assert.equal('secret' in store.webhooks[0], false);
  assert.equal(log.webhookSecret(store.webhooks[0]), 'whsec_legacy');
});

test('rotation re-encrypts everything under the current key', () => {
  const oldKey = key(), newKey = key();
  const store = new MemoryStore();
  const { log } = hookedLog(boxOf(oldKey), store);
  const hook = log.createWebhook({ owner: 'acme', url: 'https://hooks.example.com/x', actor: 'acme' });
  const rotated = new DecisionLog({ store, secretBox: new SecretBox({ keys: [newKey, oldKey] }) });
  assert.equal(rotated.webhookSecret(store.webhooks[0]), hook.secret);
  assert.deepEqual(rotated.rotateSecrets(), { rotated: 1 });
  assert.deepEqual(rotated.rotateSecrets(), { rotated: 0 }, 'idempotent');
  const onlyNew = new DecisionLog({ store, secretBox: boxOf(newKey) });
  assert.equal(onlyNew.webhookSecret(store.webhooks[0]), hook.secret);
});

test('a persistent store requires an explicit secret box; memory stores get an ephemeral one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-sec-'));
  try {
    const store = SqliteStore.open(path.join(dir, 'x.db'));
    assert.throws(() => new DecisionLog({ store }), /SECRETS_KEY|secretBox/);
    const log = new DecisionLog({ store, secretBox: boxOf(key()) });
    log.createOwner({ identifier: 'acme' });
    const hook = log.createWebhook({ owner: 'acme', url: 'https://hooks.example.com/x', actor: 'acme' });
    store.commit();
    const raw = store.db.prepare("SELECT json FROM docs WHERE coll = 'webhooks'").get().json;
    assert.equal(raw.includes(hook.secret), false, 'plaintext never reaches the database file');
    store.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const memory = new DecisionLog({});
  memory.createOwner({ identifier: 'acme' });
  assert.ok(memory.createWebhook({ owner: 'acme', url: 'https://hooks.example.com/x', actor: 'acme' }).secret);
  assert.ok(draft && assertCode);
});
