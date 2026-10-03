# 31 · A tamper-evident audit chain

## Goal

Turn the audit log into a hash chain: each entry's hash covers its content and the previous hash, so any edit is detectable.

## You'll learn

- Hash chains
- Canonical JSON (sorted keys) so storage cannot change a hash
- Versioning a format while staying compatible with old data

## Where

- `src/decision-log/core/audit.service.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Hash `prev_hash` + canonical JSON of the entry (keys sorted recursively) with sha256; mark new entries `hv: 2`.

### Hint 2

`verifyChain` walks the entries: each must link to the previous hash and re-hash to its own. Return `{ ok, broken_at }`.

### Hint 3

Legacy entries (no `hv`) were hashed as sha256 of `JSON.stringify(entry)` without its `hash` field, keys in insertion order; verify those that way.

### Hint 4

A failing action must not leave an entry: validate everything before recording.
