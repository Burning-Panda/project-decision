# 16 · Proposing: locking content with a hash

## Goal

Implement the first action, `propose`: lock the content with a sha256 hash, snapshot revision 1, and move the decision to `proposed`.

## You'll learn

- The action envelope `{ success, status_code, action_performed, decision, metadata, data }`
- Hashing with `new Bun.CryptoHasher('sha256')`
- Immutable snapshots

## Where

- `src/decision-log/decisions/decisions.service.ts` (`perform`, `versions`)
- `src/decisions/dto/perform-action.dto.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

`perform` dispatches on `request.action`. Start with a `switch` and a `propose` branch.

### Hint 2

Store a version `{ version, content, content_hash, outcome: null, reason: null }` per proposal; `getVersions` returns them with `current` set on the latest.

### Hint 3

After proposing, `updateDraft` throws IMMUTABLE_CONTENT 409 and `deleteDraft` INVALID_STATE 409.
