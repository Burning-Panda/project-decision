# 20 · Voting: single approval and consensus

## Goal

Add voting. In single approval, votes are refused and only a lead approves. In consensus mode, team members vote, and the decision is approved once enough of them approve. A vote that closes the decision answers 202.

## You'll learn

- Tallies and shares → `learn/concepts/fractions.md`
- Status codes that carry meaning (200 vs 202) → `learn/concepts/http-basics.md`
- Domain words (vote, consensus, abstain) → `learn/concepts/glossary.md`

## Where

- `src/decision-log/decisions/decisions.service.ts` (`perform`)
- `src/decisions/dto/actions/vote-payload.dto.ts`
- The project's settings: `this.projects.get(d.project).approval_settings`

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: single approval: members and the owner cannot approve; voting is disabled

#### What the test wants

In single approval, a member approving and the owner approving are both `FORBIDDEN`, and so is a lead approving their own proposal. A member casting a vote gets `VOTING_DISABLED` 409.

#### Where to look

`perform` in `src/decision-log/decisions/decisions.service.ts`. Your step 17 `canApprove` already refuses members and the owner. Voting needs `vote` in the `proposed` row of your state table, and a check of the project's `enabled_voting` setting (false in single approval).

#### Plan

1. Add `'vote'` (and `'request_revision'`, used in the last section) to the allowed actions of `proposed`.
2. Who may vote: a member of the decision's team (any role) who is not the owner. Add a `canVote` rule and use it for `vote` in `mayPerform`.
3. In the `vote` branch, first: `enabled_voting` is false, throw `VOTING_DISABLED` 409.

#### Almost the answer

```ts
private canVote(actor: string, d) {
  const team = /* the decision's team, as in canApprove */;
  return actor !== d.owner && team.members.some((m) => m.user === ____);
}

// mayPerform
case 'vote': return this.canVote(actor, d);

// perform, vote branch
const settings = this.projects.get(d.project).approval_settings;
if (!settings.enabled_voting) throw new DecisionLogError(____, 'voting is disabled for this project', 409);
```

### Section: consensus: approves at 3 approvals (80%+), returning 202 when the vote closes it

#### What the test wants

In consensus mode, bob's approve vote answers 200 with `metadata.vote_tally` `{ approve: 1, request_revision: 0, abstain: 0 }`. A second approval leaves it proposed. The third answers 202: the decision is `approved`, with the three voters as `approvers`.

#### Where to look

Keep the votes on the decision itself: `d.votes`, a list of `{ user, vote, comment, revision, at }` (add `votes: []` where step 14 creates decisions). The tally is counted from that list. The rule (from the README): approved when the approve and revision votes together reach `consensus_min_votes`, **and** approvals make up at least `consensus_approval_threshold` of them.

#### Plan

1. Record the vote on `d.votes`.
2. Count the tally; store it on `d.vote_tally` and return it in `metadata.vote_tally`.
3. If the votes approve: status `approved`, `approved_at`, `approvers` = every approve voter with `approved_at`, and `status_code` 202.
4. Otherwise answer 200.

#### Almost the answer

```ts
private tally(d) {
  const t = { approve: 0, request_revision: 0, abstain: 0 };
  for (const v of d.votes) t[v.vote]++;
  return t;
}

private votesApprove(d, settings) {
  const t = this.tally(d);
  const decisive = t.approve + t.request_revision;
  return decisive >= settings.consensus_min_votes && t.approve / decisive >= ____;
}

// vote branch
d.votes.push({ user: actor, vote: payload.vote, comment: payload.comment ?? null, revision: d.current_revision, at: now });
d.vote_tally = this.tally(d);
if (this.votesApprove(d, settings)) {
  d.status = 'approved';
  d.approved_at = now;
  d.approvers = d.votes.filter((v) => v.vote === 'approve').map((v) => ({ user: v.user, approved_at: now }));
  statusCode = ____;
}
```

### Section: consensus: 75% approval is not enough

#### What the test wants

Three approvals and one revision request is 75%: below the default 80%, so the decision stays proposed, and the tally is `{ approve: 3, request_revision: 1, abstain: 0 }`.

#### Where to look

Your `votesApprove` from the previous section. If this fails, the share is computed wrongly (for example, counting abstentions, or dividing by the number of team members instead of the votes).

#### Plan

1. Divide approvals by approvals + revision votes only.
2. Compare with `>=` against the threshold.

#### Almost the answer

```ts
const decisive = t.approve + t.request_revision;   // not abstentions, not team size
return decisive >= settings.consensus_min_votes && t.approve / decisive >= settings.consensus_approval_threshold;
```

### Section: consensus: abstentions do not count toward minimum votes or the ratio

#### What the test wants

Two approvals and an abstention stay proposed (only two votes count). A third approval then approves it.

#### Where to look

Same rule. Abstentions are recorded in the tally but left out of both the minimum and the share.

#### Plan

1. Make sure `abstain` votes are stored and counted in the tally.
2. Make sure `decisive` does not include them.

#### Almost the answer

```ts
const decisive = t.approve + t.request_revision;   // t.abstain is not part of it
```

### Section: consensus: abstain can be disabled; revision votes need a reason

#### What the test wants

With `allow_abstain: false`, abstaining is a `VALIDATION_ERROR`. A `request_revision` vote without a reason (`comment`) is a `VALIDATION_ERROR`. An unknown vote value (`maybe`) is a `VALIDATION_ERROR`.

#### Where to look

The vote branch, before recording anything. The settings are `allow_abstain` and `require_reason_on_revision` (true by default).

#### Plan

1. The vote must be `approve`, `request_revision` or `abstain`.
2. `abstain` while `allow_abstain` is false: refuse.
3. `request_revision` while `require_reason_on_revision` is true and the comment is empty: refuse.

#### Almost the answer

```ts
if (!['approve', 'request_revision', 'abstain'].includes(vote)) throw new DecisionLogError('VALIDATION_ERROR', `unknown vote ${vote}`, 400);
if (vote === 'abstain' && !settings.allow_abstain) throw ____;
if (vote === 'request_revision' && settings.require_reason_on_revision && !comment?.trim()) throw ____;
```

### Section: consensus: a voter can change their vote while the decision is open

#### What the test wants

Bob approves, then votes `request_revision`: the tally becomes `{ approve: 0, request_revision: 1, abstain: 0 }`, and `getDecision(...).votes` holds one vote, not two.

#### Where to look

Where you record the vote: remove the voter's previous vote first.

#### Plan

1. Filter out any vote by the same user.
2. Then push the new one.

#### Almost the answer

```ts
d.votes = d.votes.filter((v) => v.user !== ____);
d.votes.push({ user: actor, vote, comment: comment ?? null, revision: d.current_revision, at: now });
```

### Section: consensus: owner and outsiders cannot vote; only proposed decisions accept votes

#### What the test wants

The owner voting and an outsider voting are both `FORBIDDEN`. Voting on a draft is `INVALID_STATE`.

#### Where to look

Your `canVote` rule and the state table. Permission is checked before state (step 17), so the outsider gets 403 and a member voting on a draft gets 409.

#### Plan

1. `canVote`: not the owner, and a member of the team.
2. `vote` is allowed only in `proposed`.

#### Almost the answer

```ts
return actor !== d.owner && team.members.some((m) => m.user === actor);
// ALLOWED.proposed includes 'vote'; ALLOWED.draft does not
```

### Section: consensus: the approve action counts as an approve vote (202)

#### What the test wants

In consensus mode, bob using the `approve` action (not `vote`) records an approve vote: the answer is 202, the tally has one approval, and the decision stays proposed.

#### Where to look

In voting modes (`consensus_voting`, `quorum`), `approve` is a vote by any voter, not a lead's decision. So `mayPerform` for `approve` depends on the mode, and the `approve` branch hands over to the voting code.

#### Plan

1. `mayPerform('approve')`: in voting modes use `canVote`, otherwise `canApprove`.
2. In the `approve` branch, in a voting mode, cast an `approve` vote with the same code as `vote`.
3. The approve action always answers 202 in voting modes (the vote was accepted).

#### Almost the answer

```ts
const VOTING_MODES = ['consensus_voting', 'quorum'];

// mayPerform
case 'approve': return VOTING_MODES.includes(mode) ? this.canVote(actor, d) : ____;

// approve branch
if (VOTING_MODES.includes(settings.mode)) {
  /* cast an 'approve' vote, exactly like the vote branch */
  statusCode = 202;
}
```

### Section: consensus: the request_revision action is a revision request, not a vote

#### What the test wants

With bob's approval in, the lead uses the `request_revision` action (with a reason): the answer is 201 and the decision is back in `draft`. It is **not** counted as a vote: `vote_tally.request_revision` stays 0.

#### Where to look

A new `request_revision` branch in `perform`, separate from voting. Who may: the same people as approve in single approval (`canApprove`). Step 24 extends it with the revision record.

#### Plan

1. `mayPerform('request_revision')`: `canApprove`.
2. Branch: reason required (`VALIDATION_ERROR`), status `draft`, `status_code` 201. Do not touch `d.votes`.

#### Almost the answer

```ts
case 'request_revision': {
  if (!payload.reason?.trim()) throw ____;
  d.status = ____;
  statusCode = 201;
  break;
}
```

## Common mistakes

- Counting abstentions or team size in the share.
- Adding a second vote for the same person instead of replacing the first.
- Using `canApprove` for the approve action in consensus mode: every voter may approve there.
- Counting the `request_revision` action as a vote.
