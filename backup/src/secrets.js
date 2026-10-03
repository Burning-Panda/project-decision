import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';

function parseKey(text) {
  const t = text.trim();
  const buf = /^[0-9a-fA-F]{64}$/.test(t) ? Buffer.from(t, 'hex') : Buffer.from(t, 'base64');
  if (buf.length !== 32) throw new Error('Encryption keys must be 32 bytes (64 hex characters or base64)');
  return buf;
}

/**
 * AES-256-GCM envelope for secrets stored at rest. Each token is
 * `enc:v1:<key id>:<iv>:<tag>:<ciphertext>` and is bound to a caller-supplied `aad` (the record id), so a
 * ciphertext copied onto another record fails to decrypt. The first key encrypts; the rest only decrypt (rotation).
 */
export class SecretBox {
  constructor({ keys }) {
    if (!Array.isArray(keys) || !keys.length) throw new Error('SecretBox needs at least one key');
    for (const k of keys) if (!Buffer.isBuffer(k) || k.length !== 32) throw new Error('Encryption keys must be 32 bytes');
    this.keys = new Map(keys.map((k) => [SecretBox.keyId(k), k]));
    this.currentId = SecretBox.keyId(keys[0]);
  }

  static keyId(key) { return createHash('sha256').update(key).digest('hex').slice(0, 8); }
  static generate() { return new SecretBox({ keys: [randomBytes(32)] }); }
  static isEncrypted(value) { return typeof value === 'string' && value.startsWith(PREFIX); }

  /** SECRETS_KEY (current) and SECRETS_KEY_PREVIOUS (comma separated, decrypt-only). Returns null when unset. */
  static fromEnv(env = process.env) {
    if (!env.SECRETS_KEY) return null;
    const previous = (env.SECRETS_KEY_PREVIOUS ?? '').split(',').filter((s) => s.trim());
    return new SecretBox({ keys: [parseKey(env.SECRETS_KEY), ...previous.map(parseKey)] });
  }

  encrypt(plaintext, aad = '') {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.currentId), iv);
    cipher.setAAD(Buffer.from(String(aad)));
    const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    return `${PREFIX}${this.currentId}:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
  }

  decrypt(token, aad = '') {
    if (!SecretBox.isEncrypted(token)) throw new Error('Value is not an encrypted secret');
    const [id, iv, tag, ct] = token.slice(PREFIX.length).split(':');
    const key = this.keys.get(id);
    if (!key) throw new Error(`No key available for key id ${id}`);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAAD(Buffer.from(String(aad)));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Failed to decrypt secret (wrong key, tampering, or ciphertext belongs to another record)');
    }
  }

  needsRotation(token) {
    return SecretBox.isEncrypted(token) && token.slice(PREFIX.length).split(':')[0] !== this.currentId;
  }
}
