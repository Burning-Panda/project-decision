# Hashing

A hash function turns any text into a fixed-length fingerprint. SHA-256 gives 64 hexadecimal characters:

```ts
const hash = new Bun.CryptoHasher('sha256').update('hello').digest('hex');
// '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
```

- The same text always gives the same hash.
- Changing even one character gives a completely different hash.
- You cannot get the text back from the hash.

That makes hashes good for **integrity**: store the hash when content is locked, and later recompute it. If the hashes differ, the content was changed.
