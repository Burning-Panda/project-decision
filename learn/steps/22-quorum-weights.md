# 22 · Quorum, majorities and weighted votes

## Goal

Quorum mode: first enough of the eligible voters must vote (turnout), then a majority of the approve and revision votes decides. Votes can be weighted by role.

## You'll learn

- Turnout vs majority
- Exact comparisons of fractions → `learn/concepts/fractions.md`
- Weighted sums with `reduce`

## Where

- `src/decision-log/decisions/decisions.service.ts`
- `src/admin/dto/approval-settings.dto.ts` (`quorum_percentage`, `quorum_majority_type`, `vote_weights`)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: quorum: needs turnout before a majority can approve

#### What the test wants

With a 50% quorum and four eligible voters (bob, carol, david, the lead: everyone except the owner), one approval stays proposed; two approvals (2 of 4 = 50%) approve.

#### Where to look

A `quorum` branch in `votesApprove`. Eligible voters: the team's members except the decision's owner. Turnout: the weight of everyone who voted, compared with `quorum_percentage` of the eligible weight. Without weights, every voter weighs 1.

#### Plan

1. `weight(user)`: `settings.vote_weights[role]`, or 1.
2. `eligible` = sum of weights of members other than the owner; `turnout` = sum of weights of the voters.
3. Turnout below the quorum: not approved.
4. Otherwise compare approve weight with revision weight (next sections).

#### Almost the answer

```ts
const team = /* the decision's team */;
const role = (user: string) => team.members.find((m) => m.user === user)?.role;
const weight = (user: string) => settings.vote_weights[role(user)] ?? 1;
const eligible = team.members.filter((m) => m.user !== d.owner).reduce((sum, m) => sum + weight(m.user), 0);
const turnout = d.votes.reduce((sum, v) => sum + weight(v.user), 0);
if (turnout * 100 < settings.quorum_percentage * ____) return false;
```

### Section: quorum: a tie is not a majority; a third vote breaks it

#### What the test wants

One approval and one revision request (a tie, with enough turnout) stay proposed. A second approval (2 against 1) approves.

#### Where to look

The majority part of the quorum rule. A simple majority means **more than half** of the approve and revision weight: a tie is not more than half.

#### Plan

1. `approve` = weight of approve votes; `against` = weight of revision votes.
2. Simple majority: `approve * 2 > approve + against`.

#### Almost the answer

```ts
const approve = d.votes.filter((v) => v.vote === 'approve').reduce((s, v) => s + weight(v.user), 0);
const against = d.votes.filter((v) => v.vote === 'request_revision').reduce((s, v) => s + weight(v.user), 0);
const decisive = approve + against;
return decisive > 0 && approve * 2 ____ decisive;   // > or >= ?
```

### Section: quorum: 2/3 majority

#### What the test wants

With `quorum_majority_type: '2_3_majority'`, two approvals against one (exactly 2/3) approve. With `'3_4_majority'`, the same votes stay proposed (2/3 is less than 3/4).

#### Where to look

The majority types are fractions: simple is "more than 1/2", the others are "at least 2/3" and "at least 3/4". Compare with multiplication so 2/3 is exact.

#### Plan

1. Map each type to a fraction `[num, den]`.
2. Simple: `approve * den > decisive * num`. The others: `approve * den >= decisive * num`.

#### Almost the answer

```ts
const MAJORITY = { simple: [1, 2], '2_3_majority': [2, 3], '3_4_majority': [3, 4] };
const [num, den] = MAJORITY[settings.quorum_majority_type] ?? MAJORITY.simple;
const passes = settings.quorum_majority_type === 'simple' || !settings.quorum_majority_type
  ? approve * den > decisive * num
  : approve * den >= decisive * ____;
```

### Section: quorum: role weights make a lead count for more

#### What the test wants

With `vote_weights: { lead: 3 }` the eligible weight is 6 (three members of weight 1, the lead 3). The lead's approval alone reaches 50% turnout and a majority: approved. The tally still counts heads: `{ approve: 1, request_revision: 0, abstain: 0 }`.

#### Where to look

Your `weight(user)`. Weights change the arithmetic only; `tally` keeps counting one per vote.

#### Plan

1. Use `weight(...)` in both turnout and majority.
2. Leave `tally` as a head count.

#### Almost the answer

```ts
const weight = (user: string) => settings.vote_weights[role(user)] ?? 1;   // lead → 3
```

### Section: quorum: weighted opposition outweighs more numerous approvals

#### What the test wants

With the lead at weight 3: two members approve, then the lead requests a revision. Turnout is 5 of 6, but approvals weigh 2 against 3: the decision stays proposed.

#### Where to look

Same code: compare **weights**, not the number of votes.

#### Plan

1. Check that `approve` and `against` sum weights.

#### Almost the answer

```ts
const against = d.votes.filter((v) => v.vote === 'request_revision').reduce((s, v) => s + weight(____), 0);
```

### Section: without weights the same lead vote is not enough

#### What the test wants

With default weights, the lead's approval alone is 1 of 4: below the 50% quorum, so it stays proposed.

#### Where to look

Default weights are 1 for every role (from step 04's defaults), so turnout is a plain count.

#### Plan

1. Nothing new if turnout uses `weight(...)` with defaults of 1.

#### Almost the answer

```ts
// eligible = 4, turnout = 1 → 1 * 100 < 50 * 4 → not approved
```

## Common mistakes

- Treating a tie as a simple majority (`>=` instead of `>`).
- Using decimals for 2/3 instead of multiplying.
- Weighting the tally: it counts heads.
- Counting the owner as an eligible voter.
