# 18 · Verifying integrity and rendering the document

## Goal

Record tampering when the integrity check fails, and render a decision as a markdown document. The audit trail now needs filters.

## You'll learn

- Integrity with hashes → `learn/concepts/hashing.md`
- Building text from data; matching it with regexes → `learn/concepts/regex.md`

## Where

- `src/decision-log/decisions/decisions.service.ts` (`verifyIntegrity`, `renderDocument`)
- `src/decision-log/core/audit.service.ts` (`trail`)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: integrity check detects tampering and records a violation

#### What the test wants

An untouched proposed decision verifies `ok: true`. If the stored content was changed behind the system's back, the result is `ok: false` with differing `expected_hash` and `current_hash`, and the audit trail for that decision contains an `integrity_violation` entry.

#### Where to look

`verifyIntegrity` (your step 17 version) and `AuditService.trail(filters)`, which `log.auditTrail({ decision_id })` calls.

#### Plan

1. In `verifyIntegrity`, when the hashes differ, record an audit entry with action `integrity_violation` and the decision id.
2. `trail(filters)`: filter `this.ctx.store.audit` by `decision_id`, `actor`, and `from`/`to` on the date part of `at`, each only when given.

#### Almost the answer

```ts
// verifyIntegrity
const ok = current_hash === d.content_hash;
if (!ok) this.audit.record(null, ____, d.id, null, { expected_hash: d.content_hash, current_hash });

// AuditService
trail(filters) {
  return this.ctx.store.audit.filter((e) =>
    (!filters.decision_id || e.decision_id === filters.decision_id) &&
    (!filters.actor || e.actor === ____) &&
    (!filters.from || e.at.slice(0, 10) >= filters.from) &&
    (!filters.to || e.at.slice(0, 10) <= filters.to));
}
```

### Section: renderDecisionDocument produces the standard header, approvers and sections

#### What the test wants

For an approved decision the markdown starts with `# PRJ-001: Migrate to new database` and contains the lines `- Status: Approved`, `- Date Created: 2024-03-20`, `- Owner: alice@acme.com`, an approver line `lead@acme.com - Approved on 2024-03-20`, and the content (with its `## Decision` section).

#### Where to look

`renderDocument` in the same file. Read the decision with `this.get(id, actor)`. Dates: the first 10 characters of an ISO time. The status needs a capital first letter.

#### Plan

1. Build an array of lines, top to bottom.
2. Header, then the bullet lines, then (when there are approvers) one line per approver, then an empty line and the content.
3. `lines.join('\n')`.

#### Almost the answer

```ts
renderDocument(id, actor) {
  const d = this.get(id, actor);
  const day = (iso?: string) => (iso ?? '').slice(0, 10);
  const status = d.status[0].toUpperCase() + d.status.slice(1);
  const lines = [
    `# ${d.id}: ${d.title}`,
    '',
    `- Status: ${status}`,
    `- Date Created: ${____}`,
    `- Owner: ${d.owner}`,
    ...(d.approvers ?? []).map((a) => `- Approver: ${a.user} - Approved on ${day(____)}`),
    '',
    d.content,
  ];
  return lines.join('\n');
}
```

## Common mistakes

- Recording the violation even when the hashes match.
- A lowercase status (`approved`): the test expects `Approved`.
- Using the whole ISO time instead of the date part.
