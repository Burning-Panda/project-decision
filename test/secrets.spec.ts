import { SQL } from 'bun';
import { describe, it, expect } from 'bun:test';
import {
  SecretBox, MemoryStore, SqliteStore, WebhookDispatcher, verifySignature, buildLog,
  makeClock, randomBytes, tmpDbFile, U,
} from './support/index';

const key = () => randomBytes(32);
const boxOf = (...keys: Buffer[]) => new SecretBox({ keys });
const HOOK_URL = 'https://hooks.example.com/x';

async function hookedLog(box: any, store: any = new MemoryStore()) {
  const clock = makeClock();
  const log = await buildLog({ store, clock: clock.now, secretBox: box });
  log.createOwner({ identifier: 'acme' });
  log.addTeamMember({ owner: 'acme', user: U.alice, actor: 'acme' });
  log.createProject({ owner: 'acme', identifier: 'PRJ', title: 'P', actor: 'acme' });
  return { log, clock };
}

describe('encrypt/decrypt round trip; ciphertext is randomised and carries the key id', () => {
  describe('GIVEN a box', () => {
    describe('WHEN the same plaintext is encrypted twice', () => {
      it('THEN the ciphertexts differ (fresh IV)', () => {
        const box = boxOf(key());
        expect(box.encrypt('whsec_abc', 'webhook-001')).not.toBe(box.encrypt('whsec_abc', 'webhook-001'));
      });
    });
    describe('WHEN encrypting', () => {
      it('THEN the token is enc:v1 with an 8-hex key id and hides the plaintext', () => {
        const a = boxOf(key()).encrypt('whsec_abc', 'webhook-001');
        expect(a).toMatch(/^enc:v1:[0-9a-f]{8}:/);
        expect(a.includes('whsec_abc')).toBe(false);
      });
    });
  });

  describe('GIVEN a token', () => {
    describe('WHEN decrypted with the same record id', () => {
      it('THEN the plaintext returns', () => {
        const box = boxOf(key());
        expect(box.decrypt(box.encrypt('whsec_abc', 'webhook-001'), 'webhook-001')).toBe('whsec_abc');
      });
    });
  });

  describe('GIVEN a token and a plaintext', () => {
    describe('WHEN isEncrypted is asked', () => {
      it('THEN only the token is encrypted', () => {
        const token = boxOf(key()).encrypt('whsec_abc', 'webhook-001');
        expect(SecretBox.isEncrypted(token)).toBe(true);
        expect(SecretBox.isEncrypted('whsec_abc')).toBe(false);
      });
    });
  });
});

describe('ciphertext is bound to its record, key and integrity', () => {
  describe('GIVEN a token for webhook-001', () => {
    describe('WHEN decrypted as webhook-002', () => {
      it('THEN it fails (swapping between records)', () => {
        const box = boxOf(key());
        const token = box.encrypt('s3cret', 'webhook-001');
        expect(() => box.decrypt(token, 'webhook-002')).toThrow(/decrypt/i);
      });
    });
  });

  describe('GIVEN a token with a tampered body', () => {
    describe('WHEN decrypted', () => {
      it('THEN it fails', () => {
        const box = boxOf(key());
        const parts = box.encrypt('s3cret', 'webhook-001').split(':');
        parts[5] = Buffer.from('tampered!').toString('base64');
        expect(() => box.decrypt(parts.join(':'), 'webhook-001')).toThrow(/decrypt/i);
      });
    });
  });

  describe('GIVEN a token from another key', () => {
    describe('WHEN decrypted', () => {
      it('THEN it reports an unknown key id', () => {
        const token = boxOf(key()).encrypt('s3cret', 'webhook-001');
        expect(() => boxOf(key()).decrypt(token, 'webhook-001')).toThrow(/key/i);
      });
    });
  });

  describe('GIVEN a plaintext string', () => {
    describe('WHEN decrypted', () => {
      it('THEN it is rejected as not encrypted', () => {
        expect(() => boxOf(key()).decrypt('not-encrypted', 'x')).toThrow(/encrypted/i);
      });
    });
  });
});

describe('keys must be 32 bytes; fromEnv understands base64 and hex and previous keys', () => {
  describe('GIVEN a 16-byte key', () => {
    describe('WHEN a box is built', () => {
      it('THEN it requires 32 bytes', () => {
        expect(() => new SecretBox({ keys: [randomBytes(16)] })).toThrow(/32 bytes/);
      });
    });
  });

  describe('GIVEN no keys', () => {
    describe('WHEN a box is built', () => {
      it('THEN it requires at least one key', () => {
        expect(() => new SecretBox({ keys: [] })).toThrow(/at least one key/);
      });
    });
  });

  describe('GIVEN a base64 current key and a hex previous key', () => {
    describe('WHEN a token from the previous key is decrypted', () => {
      it('THEN it works', () => {
        const k1 = key(), k2 = key();
        const box = SecretBox.fromEnv({ SECRETS_KEY: k1.toString('base64'), SECRETS_KEY_PREVIOUS: k2.toString('hex') });
        const old = boxOf(k2).encrypt('x', 'a');
        expect(box!.decrypt(old, 'a')).toBe('x');
      });
    });
  });

  describe('GIVEN a box with a previous key', () => {
    describe('WHEN needsRotation is asked', () => {
      it('THEN old tokens need it and new ones do not', () => {
        const k1 = key(), k2 = key();
        const box = SecretBox.fromEnv({ SECRETS_KEY: k1.toString('base64'), SECRETS_KEY_PREVIOUS: k2.toString('hex') })!;
        expect(box.needsRotation(boxOf(k2).encrypt('x', 'a'))).toBe(true);
        expect(box.needsRotation(box.encrypt('x', 'a'))).toBe(false);
      });
    });
  });

  describe('GIVEN an empty environment', () => {
    describe('WHEN fromEnv runs', () => {
      it('THEN no box is configured', () => {
        expect(SecretBox.fromEnv({})).toBe(null);
      });
    });
  });

  describe('GIVEN a too-short SECRETS_KEY', () => {
    describe('WHEN fromEnv runs', () => {
      it('THEN it requires 32 bytes', () => {
        expect(() => SecretBox.fromEnv({ SECRETS_KEY: 'short' })).toThrow(/32 bytes/);
      });
    });
  });
});

describe('webhook secrets are encrypted in the store and absent from every serialised form', () => {
  async function created() {
    const { log } = await hookedLog(boxOf(key()));
    const hook = log.createWebhook({ owner: 'acme', url: HOOK_URL, actor: 'acme' });
    return { log, hook };
  }

  describe('GIVEN a new webhook', () => {
    describe('WHEN it is created', () => {
      it('THEN the plaintext whsec_ secret is returned once', async () => {
        const { hook } = await created();
        expect(hook.secret).toMatch(/^whsec_/);
      });
    });
    describe('WHEN the stored record is read', () => {
      it('THEN it holds only an enc:v1 secret_enc', async () => {
        const { log } = await created();
        const stored = log.store.webhooks[0];
        expect('secret' in stored).toBe(false);
        expect(stored.secret_enc).toMatch(/^enc:v1:/);
      });
    });
    describe('WHEN the store and audit trail are serialised', () => {
      it('THEN the plaintext appears nowhere', async () => {
        const { log, hook } = await created();
        const dump = JSON.stringify(log.store.toJSON()) + JSON.stringify(log.auditTrail());
        expect(dump.includes(hook.secret)).toBe(false);
      });
    });
    describe('WHEN webhooks are listed', () => {
      it('THEN neither secret nor ciphertext is exposed', async () => {
        const { log } = await created();
        expect('secret_enc' in log.listWebhooks('acme', 'acme')[0]).toBe(false);
      });
    });
  });
});

describe('the dispatcher still signs with the decrypted secret', () => {
  describe('GIVEN an encrypted webhook and a created decision', () => {
    describe('WHEN the dispatcher runs', () => {
      it('THEN the signature verifies with the plaintext secret', async () => {
        // Given
        const { log } = await hookedLog(boxOf(key()));
        const hook = log.createWebhook({ owner: 'acme', url: HOOK_URL, events: ['decision.created'], actor: 'acme' });
        log.createDecision({ project: 'PRJ', actor: U.alice, title: 'x' });
        let seen: any;
        // When
        await new WebhookDispatcher(log, {
          resolve: async () => ['93.184.216.34'],
          transport: async (_u: string, init: any) => { seen = init; return { status: 200 }; },
        }).run();
        // Then
        expect(verifySignature({
          secret: hook.secret, timestamp: seen.headers['x-decision-log-timestamp'], body: seen.body,
          signature: seen.headers['x-decision-log-signature'], now: log.clock(),
        })).toBe(true);
      });
    });
  });
});

describe('legacy plaintext secrets are encrypted automatically when the log starts', () => {
  async function legacy() {
    const store = new MemoryStore();
    store.webhooks.push({
      id: 'webhook-001', owner: 'acme', url: 'https://x.example.com', events: ['*'], secret: 'whsec_legacy',
      active: true, created_by: 'acme', created_at: '2024-01-01T00:00:00.000Z', deleted_at: null,
    });
    const log = await buildLog({ store, secretBox: boxOf(key()) });
    return { store, log };
  }

  describe('GIVEN a store with a plaintext webhook secret', () => {
    describe('WHEN the log starts', () => {
      it('THEN the plaintext field is removed', async () => {
        const { store } = await legacy();
        expect('secret' in store.webhooks[0]).toBe(false);
      });

      it('THEN the original secret is still recoverable', async () => {
        const { store, log } = await legacy();
        expect(log.webhookSecret(store.webhooks[0])).toBe('whsec_legacy');
      });
    });
  });
});

describe('rotation re-encrypts everything under the current key', () => {
  async function rotatable() {
    const oldKey = key(), newKey = key();
    const store = new MemoryStore();
    const { log } = await hookedLog(boxOf(oldKey), store);
    const hook = log.createWebhook({ owner: 'acme', url: HOOK_URL, actor: 'acme' });
    const rotated = await buildLog({ store, secretBox: new SecretBox({ keys: [newKey, oldKey] }) });
    return { oldKey, newKey, store, hook, rotated };
  }

  describe('GIVEN a secret written under the old key', () => {
    describe('WHEN read through a box holding both keys', () => {
      it('THEN it decrypts', async () => {
        const { store, hook, rotated } = await rotatable();
        expect(rotated.webhookSecret(store.webhooks[0])).toBe(hook.secret);
      });
    });
  });

  describe('GIVEN one secret under the old key', () => {
    describe('WHEN rotateSecrets runs', () => {
      it('THEN one is rotated', async () => {
        const { rotated } = await rotatable();
        expect(rotated.rotateSecrets()).toEqual({ rotated: 1 });
      });
    });
  });

  describe('GIVEN rotation already ran', () => {
    describe('WHEN rotateSecrets runs again', () => {
      it('THEN nothing is rotated (idempotent)', async () => {
        const { rotated } = await rotatable();
        rotated.rotateSecrets();
        expect(rotated.rotateSecrets()).toEqual({ rotated: 0 });
      });
    });
  });

  describe('GIVEN rotation ran', () => {
    describe('WHEN only the new key is configured', () => {
      it('THEN the secret still decrypts', async () => {
        const { newKey, store, hook, rotated } = await rotatable();
        rotated.rotateSecrets();
        const onlyNew = await buildLog({ store, secretBox: boxOf(newKey) });
        expect(onlyNew.webhookSecret(store.webhooks[0])).toBe(hook.secret);
      });
    });
  });
});

describe('a persistent store requires an explicit secret box; memory stores get an ephemeral one', () => {
  describe('GIVEN a SQLite store', () => {
    describe('WHEN a log is built without a secret box', () => {
      it('THEN it refuses to start', async () => {
        const store = SqliteStore.open(tmpDbFile('dl-sec-'));
        await expect(buildLog({ store })).rejects.toThrow(/SECRETS_KEY|secretBox/);
        store.close();
      });
    });
  });

  describe('GIVEN a SQLite store with a secret box', () => {
    describe('WHEN a webhook is committed', () => {
      it('THEN the plaintext never reaches the database file', async () => {
        // Given
        const file = tmpDbFile('dl-sec-');
        const store = SqliteStore.open(file);
        const log = await buildLog({ store, secretBox: boxOf(key()) });
        log.createOwner({ identifier: 'acme' });
        const hook = log.createWebhook({ owner: 'acme', url: HOOK_URL, actor: 'acme' });
        // When
        store.commit();
        // Then
        const db = new SQL({ adapter: 'sqlite', filename: file, readonly: true });
        const [{ json }] = await db`SELECT json FROM docs WHERE coll = 'webhooks'`;
        await db.close();
        expect(String(json).includes(hook.secret)).toBe(false);
        store.close();
      });
    });
  });

  describe('GIVEN no store and no secret box', () => {
    describe('WHEN a webhook is created', () => {
      it('THEN an ephemeral box still yields a secret', async () => {
        const memory = await buildLog({});
        memory.createOwner({ identifier: 'acme' });
        expect(memory.createWebhook({ owner: 'acme', url: HOOK_URL, actor: 'acme' }).secret).toBeTruthy();
      });
    });
  });
});
