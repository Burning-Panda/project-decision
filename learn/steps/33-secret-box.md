# 33 · Encryption at rest

## Goal

Implement `SecretBox`: authenticated encryption for secrets at rest, bound to the record it belongs to, with key rotation.

## You'll learn

- Authenticated encryption: AES-256-GCM with `createCipheriv` from Bun's `crypto` module (the API here is synchronous, so not `crypto.subtle`)
- Associated data (binding ciphertext to a record id)
- Key ids and rotation

## Where

- `src/storage/secrets.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Token format: `enc:v1:<keyId>:<iv>:<tag>:<ciphertext>` with base64 parts; the key id is the first 8 hex chars of sha256(key).

### Hint 2

Pass the record id as associated data so a token copied to another record fails to decrypt.

### Hint 3

The first key encrypts; all keys can decrypt. `fromEnv` reads SECRETS_KEY and SECRETS_KEY_PREVIOUS (base64 or hex, 32 bytes).
