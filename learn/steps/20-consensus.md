# 20 · Voting: single approval and consensus

## Goal

Add voting. Single approval rejects votes; consensus approves at enough approve votes and a high enough ratio, answering 202 when a vote closes the decision.

## You'll learn

- Tallies and ratios
- Status codes that carry meaning (200 vs 202)
- One vote per person, changeable

## Where

- `src/decision-log/decisions/decisions.service.ts`
- New collection `votes` (ARRAY) and its migration

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

A vote is `{ decision_id, revision, user, vote, comment }`. Re-voting replaces the voter's previous vote for the same revision.

### Hint 2

Tally approve/request_revision/abstain by head count. Abstentions do not count toward the minimum or the ratio.

### Hint 3

Approved when approves ≥ `consensus_min_votes` and approves / (approves + revision requests) ≥ `consensus_approval_threshold`.

### Hint 4

In consensus mode the `approve` action is an approve vote (202); `request_revision` as an action is not a vote (that is step 24).
