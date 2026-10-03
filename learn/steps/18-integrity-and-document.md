# 18 · Verifying integrity and rendering the document

## Goal

Check a proposed decision's content against its hash (recording a violation), and render the decision as a markdown document. The audit trail now needs filters.

## You'll learn

- Integrity checks
- Rendering text from data
- Querying the audit trail

## Where

- `src/decision-log/decisions/decisions.service.ts` (`verifyIntegrity`, `renderDocument`)
- `src/decision-log/core/audit.service.ts` (`trail`)

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

`verifyIntegrity` recomputes the hash; on mismatch return `{ ok: false, expected_hash, current_hash }` and record an `integrity_violation` audit entry.

### Hint 2

`trail(filters)` filters `store.audit` by `decision_id`, `actor`, `from`, `to`.

### Hint 3

Match the document line by line against the THEN regexes: header `# ID: title`, `- Status: Approved`, `- Date Created: YYYY-MM-DD`, `- Owner: …`, the approver line, then the content.
