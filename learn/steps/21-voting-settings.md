# 21 · Configurable thresholds

## Goal

Make the rules read their numbers from the project settings, and respect `require_reason_on_revision` and `enabled_voting`.

## You'll learn

- Behaviour from settings instead of constants
- Shares → `learn/concepts/fractions.md`

## Where

- `src/decision-log/decisions/decisions.service.ts`

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: consensus thresholds can be configured

#### What the test wants

With `consensus_min_votes: 2`, two approvals approve (202). With `consensus_approval_threshold: 0.6` and four votes required, three approvals of four (75%) approve.

#### Where to look

Your `votesApprove`. If it uses literal numbers (3, 0.8), read them from `settings` instead.

#### Plan

1. Replace literals with `settings.consensus_min_votes` and `settings.consensus_approval_threshold`.

#### Almost the answer

```ts
return decisive >= settings.____ && t.approve / decisive >= settings.____;
```

### Section: require_reason_on_revision=false lets a revision vote omit its reason

#### What the test wants

With `require_reason_on_revision: false`, a `request_revision` vote without a reason is counted: 200, tally `{ approve: 0, request_revision: 1, abstain: 0 }`.

#### Where to look

The reason check in the vote branch: it applies only when the setting is true.

#### Plan

1. Check `settings.require_reason_on_revision` before refusing an empty reason.

#### Almost the answer

```ts
if (vote === 'request_revision' && settings.____ && !comment?.trim()) throw ...;
```

### Section: single approval with enabled_voting=true: votes are advisory

#### What the test wants

In single approval with `enabled_voting: true`, bob's vote is accepted (200, tally `approve: 1`), but the decision stays proposed: only a lead approves in single approval.

#### Where to look

Your vote branch already refuses votes only when `enabled_voting` is false. `votesApprove` must return false for modes without a voting rule (single approval, veto).

#### Plan

1. `votesApprove`: consensus and quorum have rules; every other mode returns false.

#### Almost the answer

```ts
private votesApprove(d, settings) {
  if (settings.mode === 'consensus_voting') { /* ... */ }
  if (settings.mode === 'quorum') { /* step 22 */ }
  return ____;
}
```

## Common mistakes

- Checking the mode instead of `enabled_voting` when refusing votes.
- Letting votes approve in single approval.
