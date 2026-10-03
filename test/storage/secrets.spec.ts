import { SQL } from 'bun';
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  SecretBox, MemoryStore, SqliteStore, WebhookDispatcher, verifySignature, buildLog,
  makeClock, onCleanup, randomBytes, tmpDbFile, U,
} from '../support/index';

// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.
// Actions expected to fail are captured as a thunk (or promise) in WHEN and checked in THEN.

const key = () => randomBytes(32);
const boxOf = (...keys: Buffer[]) => new SecretBox({ keys });
const HOOK_URL = 'https://hooks.example.com/x';

/** Builds a log over `store` with this secret box, plus org acme, alice and project PRJ. */
async function acmeLog(box: any, store: any = new MemoryStore()) {
  const log = await buildLog({ store, clock: makeClock().now, secretBox: box });
  log.createOwner({ identifier: 'acme' });
  log.addTeamMember({ owner: 'acme', user: U.alice, actor: 'acme' });
  log.createProject({ owner: 'acme', identifier: 'PRJ', title: 'P', actor: 'acme' });
  return log;
}

describe('encrypt/decrypt round trip; ciphertext is randomised and carries the key id', () => {
  describe('GIVEN a box', () => {
    let box: SecretBox;
    beforeEach(() => { box = boxOf(key()); });

    describe('WHEN the same plaintext is encrypted twice', () => {
      let first: string, second: string;
      beforeEach(() => {
        first = box.encrypt('whsec_abc', 'webhook-001');
        second = box.encrypt('whsec_abc', 'webhook-001');
      });

      it('THEN the ciphertexts differ (fresh IV)', () => {
        expect(first).not.toBe(second);
      });
    });

    describe('WHEN a plaintext is encrypted', () => {
      let token: string;
      beforeEach(() => { token = box.encrypt('whsec_abc', 'webhook-001'); });

      it('THEN the token is enc:v1 with an 8-hex key id and hides the plaintext', () => {
        expect(token).toMatch(/^enc:v1:[0-9a-f]{8}:/);
        expect(token).not.toContain('whsec_abc');
      });
    });
  });

  describe('GIVEN a token for webhook-001', () => {
    let box: SecretBox;
    let token: string;
    beforeEach(() => {
      box = boxOf(key());
      token = box.encrypt('whsec_abc', 'webhook-001');
    });

    describe('WHEN decrypted with the same record id', () => {
      let plain: string;
      beforeEach(() => { plain = box.decrypt(token, 'webhook-001'); });

      it('THEN the plaintext returns', () => {
        expect(plain).toBe('whsec_abc');
      });
    });

    describe('WHEN isEncrypted is asked of the token and of a plaintext', () => {
      let answers: [boolean, boolean];
      beforeEach(() => { answers = [SecretBox.isEncrypted(token), SecretBox.isEncrypted('whsec_abc')]; });

      it('THEN only the token is encrypted', () => {
        expect(answers).toEqual([true, false]);
      });
    });
  });
});

describe('ciphertext is bound to its record, key and integrity', () => {
  describe('GIVEN a token for webhook-001', () => {
    let box: SecretBox;
    let token: string;
    beforeEach(() => {
      box = boxOf(key());
      token = box.encrypt('s3cret', 'webhook-001');
    });

    describe('WHEN decrypted as webhook-002', () => {
      let decrypt: () => unknown;
      beforeEach(() => { decrypt = () => box.decrypt(token, 'webhook-002'); });

      it('THEN it fails (swapping between records)', () => {
        expect(decrypt).toThrow(/decrypt/i);
      });
    });

    describe('WHEN its body is tampered with and it is decrypted', () => {
      let decrypt: () => unknown;
      beforeEach(() => {
        const parts = token.split(':');
        parts[5] = Buffer.from('tampered!').toString('base64');
        decrypt = () => box.decrypt(parts.join(':'), 'webhook-001');
      });

      it('THEN it fails', () => {
        expect(decrypt).toThrow(/decrypt/i);
      });
    });

    describe('WHEN a box with another key decrypts it', () => {
      let decrypt: () => unknown;
      beforeEach(() => { decrypt = () => boxOf(key()).decrypt(token, 'webhook-001'); });

      it('THEN it reports an unknown key id', () => {
        expect(decrypt).toThrow(/key/i);
      });
    });
  });

  describe('GIVEN a plaintext string', () => {
    describe('WHEN decrypted', () => {
      let decrypt: () => unknown;
      beforeEach(() => { decrypt = () => boxOf(key()).decrypt('not-encrypted', 'x'); });

      it('THEN it is rejected as not encrypted', () => {
        expect(decrypt).toThrow(/encrypted/i);
      });
    });
  });
});

describe('keys must be 32 bytes; fromEnv understands base64 and hex and previous keys', () => {
  describe('GIVEN a 16-byte key', () => {
    describe('WHEN a box is built', () => {
      let build: () => unknown;
      beforeEach(() => { build = () => new SecretBox({ keys: [randomBytes(16)] }); });

      it('THEN it requires 32 bytes', () => {
        expect(build).toThrow(/32 bytes/);
      });
    });
  });

  describe('GIVEN no keys', () => {
    describe('WHEN a box is built', () => {
      let build: () => unknown;
      beforeEach(() => { build = () => new SecretBox({ keys: [] }); });

      it('THEN it requires at least one key', () => {
        expect(build).toThrow(/at least one key/);
      });
    });
  });

  describe('GIVEN a box from a base64 SECRETS_KEY and a hex SECRETS_KEY_PREVIOUS', () => {
    let previous: Buffer;
    let box: SecretBox;
    beforeEach(() => {
      const current = key();
      previous = key();
      box = SecretBox.fromEnv({ SECRETS_KEY: current.toString('base64'), SECRETS_KEY_PREVIOUS: previous.toString('hex') })!;
    });

    describe('WHEN a token from the previous key is decrypted', () => {
      let plain: string;
      beforeEach(() => { plain = box.decrypt(boxOf(previous).encrypt('x', 'a'), 'a'); });

      it('THEN it works', () => {
        expect(plain).toBe('x');
      });
    });

    describe('WHEN needsRotation is asked of an old and a new token', () => {
      let answers: [boolean, boolean];
      beforeEach(() => { answers = [box.needsRotation(boxOf(previous).encrypt('x', 'a')), box.needsRotation(box.encrypt('x', 'a'))]; });

      it('THEN old tokens need it and new ones do not', () => {
        expect(answers).toEqual([true, false]);
      });
    });
  });

  describe('GIVEN an empty environment', () => {
    describe('WHEN fromEnv runs', () => {
      let box: unknown;
      beforeEach(() => { box = SecretBox.fromEnv({}); });

      it('THEN no box is configured', () => {
        expect(box).toBe(null);
      });
    });
  });

  describe('GIVEN a too-short SECRETS_KEY', () => {
    describe('WHEN fromEnv runs', () => {
      let build: () => unknown;
      beforeEach(() => { build = () => SecretBox.fromEnv({ SECRETS_KEY: 'short' }); });

      it('THEN it requires 32 bytes', () => {
        expect(build).toThrow(/32 bytes/);
      });
    });
  });
});

describe('webhook secrets are encrypted in the store and absent from every serialised form', () => {
  describe('GIVEN an org with a secret box', () => {
    let log: any;
    beforeEach(async () => { log = await acmeLog(boxOf(key())); });

    describe('WHEN a webhook is created', () => {
      let hook: any;
      beforeEach(() => { hook = log.createWebhook({ owner: 'acme', url: HOOK_URL, actor: 'acme' }); });

      it('THEN the plaintext whsec_ secret is returned once', () => {
        expect(hook.secret).toMatch(/^whsec_/);
      });

      it('THEN the stored record holds only an enc:v1 secret_enc', () => {
        const stored = log.store.webhooks[0];
        expect(stored).not.toHaveProperty('secret');
        expect(stored.secret_enc).toMatch(/^enc:v1:/);
      });

      it('THEN the plaintext appears nowhere in the serialised store or audit trail', () => {
        const dump = JSON.stringify(log.store.toJSON()) + JSON.stringify(log.auditTrail());
        expect(dump).not.toContain(hook.secret);
      });

      it('THEN listings expose neither secret nor ciphertext', () => {
        expect(log.listWebhooks('acme', 'acme')[0]).not.toHaveProperty('secret_enc');
      });
    });
  });
});

describe('the dispatcher still signs with the decrypted secret', () => {
  describe('GIVEN an encrypted webhook and a created decision', () => {
    let log: any;
    let hook: any;
    beforeEach(async () => {
      log = await acmeLog(boxOf(key()));
      hook = log.createWebhook({ owner: 'acme', url: HOOK_URL, events: ['decision.created'], actor: 'acme' });
      log.createDecision({ project: 'PRJ', actor: U.alice, title: 'x' });
    });

    describe('WHEN the dispatcher runs', () => {
      let seen: any;
      beforeEach(async () => {
        await new WebhookDispatcher(log, {
          resolve: async () => ['93.184.216.34'],
          transport: async (_u: string, init: any) => { seen = init; return { status: 200 }; },
        }).run();
      });

      it('THEN the signature verifies with the plaintext secret', () => {
        expect(verifySignature({
          secret: hook.secret, timestamp: seen.headers['x-decision-log-timestamp'], body: seen.body,
          signature: seen.headers['x-decision-log-signature'], now: log.clock(),
        })).toBe(true);
      });
    });
  });
});

describe('legacy plaintext secrets are encrypted automatically when the log starts', () => {
  describe('GIVEN a store with a plaintext webhook secret', () => {
    let store: MemoryStore;
    beforeEach(() => {
      store = new MemoryStore();
      store.webhooks.push({
        id: 'webhook-001', owner: 'acme', url: 'https://x.example.com', events: ['*'], secret: 'whsec_legacy',
        active: true, created_by: 'acme', created_at: '2024-01-01T00:00:00.000Z', deleted_at: null,
      });
    });

    describe('WHEN the log starts', () => {
      let log: any;
      beforeEach(async () => { log = await buildLog({ store, secretBox: boxOf(key()) }); });

      it('THEN the plaintext field is removed', () => {
        expect(store.webhooks[0]).not.toHaveProperty('secret');
      });

      it('THEN the original secret is still recoverable', () => {
        expect(log.webhookSecret(store.webhooks[0])).toBe('whsec_legacy');
      });
    });
  });
});

describe('rotation re-encrypts everything under the current key', () => {
  type Rotatable = { newKey: Buffer; store: MemoryStore; hook: any; rotated: any };

  /** A webhook secret written under an old key, and a log (`rotated`) whose box holds [newKey, oldKey]. */
  function rotatable(): Rotatable {
    const h = {} as Rotatable;
    beforeEach(async () => {
      const oldKey = key();
      h.newKey = key();
      h.store = new MemoryStore();
      const log = await acmeLog(boxOf(oldKey), h.store);
      h.hook = log.createWebhook({ owner: 'acme', url: HOOK_URL, actor: 'acme' });
      h.rotated = await buildLog({ store: h.store, secretBox: new SecretBox({ keys: [h.newKey, oldKey] }) });
    });
    return h;
  }

  describe('GIVEN a secret written under the old key and a box holding both keys', () => {
    const h = rotatable();

    describe('WHEN the secret is read', () => {
      let secret: string;
      beforeEach(() => { secret = h.rotated.webhookSecret(h.store.webhooks[0]); });

      it('THEN it decrypts', () => {
        expect(secret).toBe(h.hook.secret);
      });
    });

    describe('WHEN rotateSecrets runs', () => {
      let result: any;
      beforeEach(() => { result = h.rotated.rotateSecrets(); });

      it('THEN one is rotated', () => {
        expect(result).toEqual({ rotated: 1 });
      });
    });
  });

  describe('GIVEN rotation already ran', () => {
    const h = rotatable();
    beforeEach(() => { h.rotated.rotateSecrets(); });

    describe('WHEN rotateSecrets runs again', () => {
      let result: any;
      beforeEach(() => { result = h.rotated.rotateSecrets(); });

      it('THEN nothing is rotated (idempotent)', () => {
        expect(result).toEqual({ rotated: 0 });
      });
    });

    describe('WHEN a log is started with only the new key', () => {
      let onlyNew: any;
      beforeEach(async () => { onlyNew = await buildLog({ store: h.store, secretBox: boxOf(h.newKey) }); });

      it('THEN the secret still decrypts', () => {
        expect(onlyNew.webhookSecret(h.store.webhooks[0])).toBe(h.hook.secret);
      });
    });
  });
});

describe('a persistent store requires an explicit secret box; memory stores get an ephemeral one', () => {
  describe('GIVEN a SQLite store', () => {
    let store: any;
    beforeEach(() => {
      store = SqliteStore.open(tmpDbFile('dl-sec-'));
      onCleanup(() => store.close());
    });

    describe('WHEN a log is built without a secret box', () => {
      let building: Promise<unknown>;
      beforeEach(() => {
        building = buildLog({ store });
        building.catch(() => {}); // observed in THEN
      });

      it('THEN it refuses to start', async () => {
        await expect(building).rejects.toThrow(/SECRETS_KEY|secretBox/);
      });
    });
  });

  describe('GIVEN a SQLite store with a secret box and a webhook', () => {
    let file: string;
    let store: any;
    let hook: any;
    beforeEach(async () => {
      file = tmpDbFile('dl-sec-');
      store = SqliteStore.open(file);
      onCleanup(() => store.close());
      const log = await buildLog({ store, secretBox: boxOf(key()) });
      log.createOwner({ identifier: 'acme' });
      hook = log.createWebhook({ owner: 'acme', url: HOOK_URL, actor: 'acme' });
    });

    describe('WHEN the store is committed', () => {
      let stored: string;
      beforeEach(async () => {
        store.commit();
        const db = new SQL({ adapter: 'sqlite', filename: file, readonly: true });
        const [{ json }] = await db`SELECT json FROM docs WHERE coll = 'webhooks'`;
        await db.close();
        stored = String(json);
      });

      it('THEN the plaintext never reaches the database file', () => {
        expect(stored).not.toContain(hook.secret);
      });
    });
  });

  describe('GIVEN no store and no secret box', () => {
    let memory: any;
    beforeEach(async () => {
      memory = await buildLog({});
      memory.createOwner({ identifier: 'acme' });
    });

    describe('WHEN a webhook is created', () => {
      let hook: any;
      beforeEach(() => { hook = memory.createWebhook({ owner: 'acme', url: HOOK_URL, actor: 'acme' }); });

      it('THEN an ephemeral box still yields a secret', () => {
        expect(hook.secret).toBeTruthy();
      });
    });
  });
});
