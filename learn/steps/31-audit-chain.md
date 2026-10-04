# 31 · A tamper-evident audit chain

## Goal

Turn the audit log into a hash chain: every entry carries the hash of the one before it, so changing, removing or reordering any entry is detectable. Old entries written before the format was versioned must still verify.

## You'll learn

- Hash chains: each hash covers the previous hash
- Canonical JSON: sorting keys so a database cannot change a hash by reordering them → `learn/concepts/hashing.md`, `learn/concepts/json.md`
- Versioning a format and staying compatible with old data

## Where

- `src/decision-log/core/audit.service.ts` (`record` and `verifyChain`; `trail` stays as it is)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: every action is audited with before/after state, ip and a verifiable hash chain

#### What the test wants

After create, propose (from `10.0.0.1`) and approve, the decision's trail lists `create`, `propose`, `approve` in order. The propose entry has the actor, the ip and `before.status` draft / `after.status` proposed. Each `hash` is 64 hex characters and each `prev_hash` is the previous entry's `hash`. `verifyAuditChain()` answers `ok: true`.

#### Where to look

`record` in `src/decision-log/core/audit.service.ts`. Today it appends an entry with empty `prev_hash` and `hash`. An entry is `{ seq, at, actor, action, decision_id, before, after, ip, detail, prev_hash, hash, hv }`. The first entry has nothing before it: use 64 zeros as its `prev_hash`. Read `learn/concepts/hashing.md` for `Bun.CryptoHasher`.

#### Plan

1. `prev_hash` = the last entry's `hash`, or 64 zeros for the first one.
2. Build the entry **without** `hash`, with `hv: 2` (the hash version).
3. `hash` = sha256 of the entry as text (section 4 makes that text canonical).
4. Store **copies** of `before` and `after` (`structuredClone`). `perform` passes the live decision object; if you keep that object, later changes to the decision silently change what the hash was computed from, and the chain breaks.
5. `verifyChain` comes in the next section.

#### Almost the answer

```ts
const GENESIS = '0'.repeat(64);
const sha256 = (text: string) => new Bun.CryptoHasher('sha256').update(text).digest('hex');

record(actor, action, decisionId, before, after, extra = {}) {
  const audit = this.ctx.store.audit;
  const entry: AuditEntry = {
    seq: audit.length + 1, at: this.ctx.now(), actor, action, decision_id: decisionId,
    before: structuredClone(before), after: structuredClone(after), ip: extra.ip ?? null, detail: structuredClone(extra.detail ?? null),
    prev_hash: audit.at(-1)?.hash ?? ____, hash: '', hv: 2,
  };
  const { hash: _unused, ...hashed } = entry;
  entry.hash = sha256(JSON.stringify(hashed));      // made canonical in section 4
  audit.push(entry);
  return entry;
}
```

### Section: audit trail filters by actor and detects tampering

#### What the test wants

Filtering the trail by alice returns exactly her entries (`create`, `propose`). When an entry's `actor` is rewritten, `verifyAuditChain()` returns `ok: false` and `broken_at` is that entry's `seq`.

#### Where to look

`verifyChain` in the same file (`trail` already filters; leave it). Walk the entries in order, keeping the hash you expect the next entry to link to.

#### Plan

1. `prev` starts as 64 zeros.
2. For each entry: it must have `prev_hash === prev`, and recomputing its hash (same steps as `record`: the entry without `hash`) must equal its `hash`.
3. The first entry that fails: return `{ ok: false, broken_at: entry.seq }`.
4. Otherwise `prev = entry.hash` and go on. At the end `{ ok: true, broken_at: null }`.

#### Almost the answer

```ts
verifyChain() {
  let prev = GENESIS;
  for (const e of this.ctx.store.audit as AuditEntry[]) {
    const { hash, ...rest } = e;
    const expected = sha256(JSON.stringify(rest));          // sections 4 and 5 refine this line
    if (e.prev_hash !== prev || hash !== ____) return { ok: false, broken_at: e.seq };
    prev = hash;
  }
  return { ok: true, broken_at: null };
}
```

### Section: failed actions leave state and audit untouched

#### What the test wants

Bob tries to propose alice's draft: `FORBIDDEN`, the audit length is unchanged and the decision is still a draft.

#### Where to look

`perform` in `src/decision-log/decisions/decisions.service.ts`. This usually passes already. It fails if something is changed or recorded *before* the permission and state checks have finished.

#### Plan

1. Every check (action name, permission, state, the action's own validation) comes first.
2. Then change the decision.
3. `audit.record` is the very last step of a successful action. The same rule keeps the outbox (step 35) and notifications correct.

#### Almost the answer

```ts
// shape of perform, from top to bottom
const d = this.load(id);
/* unknown action -> permission -> state -> the action's own validation: all of these may throw */
/* only now: change d, create revisions, ... */
this.audit.record(actor, request.action, d.id, { status: previous }, { status: d.status });
return envelope;
```

### Section: audit hashes do not depend on object key order (stores such as jsonb reorder keys)

#### What the test wants

Fresh entries all carry `hv: 2`. If every entry is rewritten with its keys in reverse order (what a `jsonb` column may return), the chain still verifies. If an `actor` is also rewritten, tampering is still detected.

#### Where to look

`JSON.stringify` writes keys in insertion order, so a reordered copy of the same entry gives a different text and a different hash. Hash a **canonical** text instead: the same JSON with every object's keys sorted, at every depth.

#### Plan

1. Write `canonical(value)`: `JSON.stringify` with a replacer that turns each plain object into one with sorted keys. Arrays stay as they are.
2. Use it in `record` and in `verifyChain` for entries with `hv: 2`.

#### Almost the answer

```ts
const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v);

entry.hash = sha256(canonical(hashed));
```

### Section: chains written before hash versioning (insertion-order hashes) still verify

#### What the test wants

A chain written by the old code (no `hv`, each hash = sha256 of `JSON.stringify` of the entry without its `hash`, keys in insertion order) verifies as `{ ok: true, broken_at: null }`. With entry 2 altered it is `{ ok: false, broken_at: 2 }`.

#### Where to look

`verifyChain`. Entries without `hv: 2` were hashed the old way and cannot be re-hashed the new way. Check how each entry was written before recomputing.

#### Plan

1. `e.hv === 2`: recompute with `canonical`.
2. Otherwise (legacy): recompute with plain `JSON.stringify` of the entry **without `hash`**, exactly as stored.
3. The link check (`prev_hash`) is the same for both.

#### Almost the answer

```ts
const { hash, ...rest } = e;
const expected = e.hv === 2 ? sha256(canonical(rest)) : sha256(JSON.stringify(rest));
if (e.prev_hash !== prev || hash !== expected) return { ok: false, broken_at: e.seq };
```

### Section: new entries can extend a legacy chain

#### What the test wants

On a store whose audit holds one legacy entry, creating an owner appends an entry with `hv: 2`, whose `prev_hash` is the legacy entry's `hash`, and the whole chain verifies.

#### Where to look

`record`. The only thing that matters is where `prev_hash` comes from.

#### Plan

1. `prev_hash` is the last stored entry's `hash`, whatever version that entry is.
2. The new entry is version 2; the old ones stay as they are (never rewrite history).

#### Almost the answer

```ts
prev_hash: audit.at(-1)?.hash ?? GENESIS,      // legacy or not, link to what is there
```

## Common mistakes

- Keeping the live `before`/`after` objects instead of copies: the chain breaks the next time the decision changes.
- Hashing `JSON.stringify(entry)` including the `hash` field (it is empty or stale when you compute it).
- Using `canonical` in `record` but plain `JSON.stringify` in `verifyChain` (or the reverse): both sides must hash the same text.
- Re-hashing legacy entries the new way: they would all look tampered.
- Recording the audit entry before a later check can still throw.
