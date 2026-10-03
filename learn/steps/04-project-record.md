# 04 · A pure function: building a project record

## Goal

Implement `Project.create` and `Project.resolveSettings`: pure functions that check their input and build a project record. They use no store and no clock; everything they need is passed in.

## You'll learn

- Pure functions: same input, same output, nothing else changed
- Throwing typed errors → `learn/concepts/errors.md`
- Defaults and merging without mutating → `learn/concepts/objects-and-copies.md`
- Checking a format with a regex → `learn/concepts/regex.md`

## Where

- `src/decision-log/projects/project.ts` (`ProjectRecord` lists every field you must return)
- `src/admin/dto/approval-settings.dto.ts` (every setting and its allowed values)
- `src/common/errors.ts` (`DecisionLogError`)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: Project.create builds a valid record

#### What the test wants

Given an owner, identifier and title, `Project.create(input, now)` returns a full `ProjectRecord`: team `default` unless given, description `''`, active, both counts 0, `created_at` and `updated_at` equal to `now`, and approval settings with their defaults (mode `single_approval`, voting off). With `mode: 'consensus_voting'`, voting is on and every other setting keeps its default.

#### Where to look

Both functions are in `src/decision-log/projects/project.ts`. `create` needs the settings, and building settings is `resolveSettings`'s job, so start there: write a `DEFAULTS` object with every approval setting, and let `resolveSettings` return a copy of it for now.

#### Plan

1. Above the class, write `const DEFAULTS` with every setting: `mode: 'single_approval'`, `enabled_voting: false`, `consensus_approval_threshold: 0.8`, `consensus_min_votes: 3`, `allow_abstain: true`, `require_reason_on_revision: true`, `auto_approve_after_days: null`, `notification_on_vote: true`, `revision_vote_resets_count: true`, `quorum_percentage: 50`, `quorum_majority_type: 'simple'`, `vote_weights: { member: 1, lead: 1, admin: 1 }`.
2. In `create`, get the settings with `Project.resolveSettings(input.settings?.approval_settings)`.
3. Return an object literal with every field of `ProjectRecord`.

#### Almost the answer

```ts
static create(input, now) {
  const approval_settings = Project.resolveSettings(input.settings?.approval_settings);
  return {
    owner: input.owner,
    team: input.team ?? 'default',
    identifier: input.identifier,
    title: input.title,
    description: ____,
    active: ____,
    decision_count: 0,
    last_number: 0,
    approval_settings,
    created_at: now,
    updated_at: ____,
  };
}
```

### Section: Project.create rejects invalid input

#### What the test wants

Each GIVEN is one bad input, and each must throw `VALIDATION_ERROR` with status 400: an empty identifier, one starting with a digit, one with a dash, an empty title, an unknown mode, and a `quorum_percentage` above 100.

#### Where to look

The identifier and title checks belong in `create`; the settings checks belong in `resolveSettings` (so updating settings later gets the same checks). `DecisionLogError` is in `src/common/errors.ts`.

#### Plan

1. In `create`, before building the record: the identifier must be a letter followed by letters or digits (a regex), and the title must not be empty after trimming.
2. In `resolveSettings`, after merging: the mode must be one of the four modes, and `quorum_percentage` must be between 0 and 100.
3. Each failed check throws `new DecisionLogError('VALIDATION_ERROR', message, 400)`.

#### Almost the answer

```ts
const invalid = (message: string) => new DecisionLogError('VALIDATION_ERROR', message, 400);
const MODES = ['single_approval', 'consensus_voting', 'quorum', 'veto'];

// in create
if (!/^[A-Za-z]____$/.test(input.identifier ?? '')) throw invalid('identifier must start with a letter and contain only letters and digits');
if (!input.title?.trim()) throw ____;

// in resolveSettings, after merging
if (!MODES.includes(next.mode)) throw invalid(`unknown mode ${next.mode}`);
if (next.quorum_percentage < 0 || next.quorum_percentage > ____) throw invalid('quorum_percentage must be 0-100');
```

### Section: Project.resolveSettings merges a patch over current settings

#### What the test wants

`resolveSettings(patch, current)` returns new settings: the patch over the current settings. Patching only `allow_abstain` keeps the mode. The `current` object must not change. Patching the mode to `single_approval` turns voting off. A `vote_weights` entry for an unknown role (`wizard`), a weight of 0 or a non-number is a `VALIDATION_ERROR`.

#### Where to look

Same file. When `current` is missing (a new project), start from `DEFAULTS`. `vote_weights` is a nested object, so it needs its own merge.

#### Plan

1. `next = { ...current, ...patch }`, with `vote_weights` merged the same way.
2. If the patch sets `mode` but not `enabled_voting`, recompute it: on for every mode except `single_approval`.
3. Check each weight in the patch: a known role (`member`, `lead`, `admin`) and a number above 0.
4. Run the checks from the previous section, then return `next`.

#### Almost the answer

```ts
static resolveSettings(patch = {}, current = DEFAULTS) {
  const next = { ...current, ...patch, vote_weights: { ...current.vote_weights, ...patch.vote_weights } };
  if (patch.mode !== undefined && patch.enabled_voting === undefined) next.enabled_voting = ____;
  for (const [role, weight] of Object.entries(patch.vote_weights ?? {})) {
    if (!['member', 'lead', 'admin'].includes(role) || typeof weight !== 'number' || weight <= 0) throw ____;
  }
  // ...the mode and quorum checks...
  return next;
}
```

## Common mistakes

- Assigning into `current` (`current.mode = ...`): build a new object instead.
- Forgetting to merge `vote_weights` separately: a patch with one weight would drop the others.
- Leaving `enabled_voting` as it was when the mode changes.
- Missing a field of `ProjectRecord`: compare your object with the interface.
