# 33 · Encryption at rest

## Goal

Implement `SecretBox`: encrypt secrets so a copy of the database file reveals nothing, bind each ciphertext to the record it belongs to, and support rotating the key.

## You'll learn

- Authenticated encryption: AES-256-GCM with `createCipheriv` from `node:crypto` (the API is synchronous; `crypto.subtle` is not)
- Associated data: tying a ciphertext to a record id
- Key ids and rotation: a new key encrypts, old keys still decrypt

## Where

- `src/storage/secrets.ts`
- Used later by `WebhooksService` (steps 34 and 36)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: encrypt/decrypt round trip; ciphertext is randomised and carries the key id

#### What the test wants

Encrypting the same text twice gives two different tokens. A token looks like `enc:v1:<8 hex>:...` and does not contain the plaintext. `decrypt(token, sameRecordId)` returns the plaintext. `SecretBox.isEncrypted` is true for a token and false for plain text.

#### Where to look

`src/storage/secrets.ts`: a class with a constructor, `encrypt`, `decrypt`, `needsRotation` and the static `fromEnv` and `isEncrypted`. GCM needs a fresh random 12-byte IV for every encryption (that is why two tokens differ) and produces an authentication tag you must keep.

#### Plan

1. Token format, six parts separated by `:`: `enc`, `v1`, key id, IV, tag, ciphertext. IV, tag and ciphertext are base64.
2. Key id = the first 8 hex characters of the sha256 of the key.
3. `encrypt(plain, recordId)`: random IV, `createCipheriv('aes-256-gcm', key, iv)`, `cipher.setAAD(Buffer.from(recordId))`, then `update` + `final`, then `getAuthTag()`.
4. `decrypt` mirrors it with `createDecipheriv`, `setAAD`, `setAuthTag`.
5. `isEncrypted(value)`: a string starting with `enc:v1:`.

#### Almost the answer

```ts
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';
const keyId = (key: Buffer) => createHash('sha256').update(key).digest('hex').slice(0, 8);

encrypt(plain: string, recordId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.current)!, iv);
  cipher.setAAD(Buffer.from(recordId));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${PREFIX}${this.current}:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${body.toString('base64')}`;
}

static isEncrypted(value: unknown) { return typeof value === 'string' && value.startsWith(____); }
```

### Section: ciphertext is bound to its record, key and integrity

#### What the test wants

Decrypting a token under another record id fails (message contains "decrypt"). A token whose ciphertext part was replaced fails the same way. A box holding a different key reports an unknown **key** id. Plain text is rejected as not **encrypted**.

#### Where to look

`decrypt`. Each failure has its own message, and the tests match them with a word: `/decrypt/i`, `/key/i`, `/encrypted/i`.

#### Plan

1. Not `isEncrypted`: throw an error mentioning "not encrypted".
2. Split the rest on `:`, look the key up by its id; unknown: throw "unknown key id ...".
3. Run the decipher inside `try`: when GCM refuses (wrong associated data, altered ciphertext or tag), throw "could not decrypt ...". Do not let the raw crypto error through.

#### Almost the answer

```ts
decrypt(token: string, recordId: string): string {
  if (!SecretBox.isEncrypted(token)) throw new Error('value is not encrypted');
  const [id, iv, tag, body] = token.slice(PREFIX.length).split(':');
  const key = this.keys.get(id!);
  if (!key) throw new Error(`unknown key id ${id}`);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv!, 'base64'));
    decipher.setAAD(Buffer.from(recordId));
    decipher.setAuthTag(Buffer.from(tag!, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(body!, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('could not ____: wrong record, wrong key or altered data');
  }
}
```

### Section: keys must be 32 bytes; fromEnv understands base64 and hex and previous keys

#### What the test wants

A 16-byte key: error mentioning "32 bytes". No keys: error mentioning "at least one key". `fromEnv` reads `SECRETS_KEY` (base64 or 64 hex characters) and `SECRETS_KEY_PREVIOUS` (hex or base64, comma separated); a token written under the previous key still decrypts; `needsRotation(token)` is true for old-key tokens and false for current ones. An empty environment gives `null`; `SECRETS_KEY=short` is a "32 bytes" error.

#### Where to look

The constructor and `fromEnv`. The first key is the current one and encrypts; every key can decrypt. Keep a `Map` from key id to key, and remember the current id.

#### Plan

1. Constructor: no keys: throw; any key that is not 32 bytes: throw.
2. `fromEnv`: no `SECRETS_KEY`: return `null`. Parse each value: 64 hex characters means hex, anything else is base64. Current key first, then the previous ones.
3. `needsRotation(token)`: the token's key id (third part) is not the current id.

#### Almost the answer

```ts
constructor(options: { keys: Buffer[] }) {
  if (!options.keys.length) throw new Error('SecretBox needs at least one key');
  for (const key of options.keys) if (key.length !== ____) throw new Error('SecretBox keys must be 32 bytes');
  this.keys = new Map(options.keys.map((k) => [keyId(k), k]));
  this.current = keyId(options.keys[0]!);
}

static fromEnv(env = process.env) {
  if (!env.SECRETS_KEY) return null;
  const parse = (text: string) => (/^[0-9a-f]{64}$/i.test(text.trim()) ? Buffer.from(text.trim(), 'hex') : Buffer.from(text.trim(), 'base64'));
  const previous = (env.SECRETS_KEY_PREVIOUS ?? '').split(',').filter((t) => t.trim());
  return new SecretBox({ keys: [env.SECRETS_KEY, ...previous].map(parse) });
}

needsRotation(token: string) { return token.split(':')[2] !== this.current; }
```

## Common mistakes

- Reusing an IV: always `randomBytes(12)` per encryption, never a constant.
- Forgetting `setAuthTag` before `final()` when decrypting.
- Letting the raw crypto error escape: the tests look for "decrypt", "key" and "encrypted" in the message.
- Splitting the token into the wrong number of parts: the tamper test replaces the sixth part (index 5), the ciphertext.
- Treating a 64-character hex key as base64 (that decodes to 48 bytes, not 32).
