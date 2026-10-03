# 17 · A state machine: approve and decline

## Goal

Turn `perform` into a state machine: approve, decline and return to draft, with errors that tell the caller what is allowed instead.

## You'll learn

- State machines → `learn/concepts/state-machines.md`
- Errors that carry details → `learn/concepts/errors.md`
- Role-based permissions → `learn/concepts/permissions.md`

## Where

- `src/decision-log/decisions/decisions.service.ts` (`perform`)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: unknown actions and wrong-state actions give actionable errors

#### What the test wants

An action that does not exist (`teleport`): `UNKNOWN_ACTION` 400. The lead approving a draft: `INVALID_STATE` 409 with `details.current_state: 'draft'` and `details.allowed_actions` containing `propose`. An action on `PRJ-999`: `NOT_FOUND` 404.

#### Where to look

`perform` in `src/decision-log/decisions/decisions.service.ts`. Keep two lists: every action name (from `ActionName` in the DTO), and a table of which actions each state allows. `DecisionLogError` takes details as its fourth argument.

#### Plan

1. Load the decision (404).
2. Not a known action: `UNKNOWN_ACTION`.
3. Check permission for the action (who may do it, see the last section), then: not allowed in the current state: `INVALID_STATE` with details. Permission comes first for every action, including the owner-only ones (`propose`, `return_to_draft`).
4. Then dispatch.

#### Almost the answer

```ts
const ACTIONS = ['propose', 'approve', 'decline', 'vote', 'request_revision', 'return_to_draft', 'create_superseding_decision', 'add_comment', 'assign_followup', 'add_meeting'];
const ALLOWED: Record<string, string[]> = {
  draft: ['propose'],
  proposed: ['approve', 'decline'],
  approved: [____],
  declined: ['return_to_draft'],
};

if (!ACTIONS.includes(request.action)) throw new DecisionLogError('UNKNOWN_ACTION', ..., 400);
if (!ALLOWED[d.status].includes(request.action)) {
  throw new DecisionLogError('INVALID_STATE', `cannot ${request.action} a ${d.status} decision`, 409, { current_state: d.status, allowed_actions: ____ });
}
```

### Section: single approval: a lead approves, content and hash are untouched

#### What the test wants

The lead approves: 200, status `approved`, `approved_at` set, content and hash unchanged, and `approvers` is exactly `[{ user: lead, approved_at }]`. The same THEN calls `verifyIntegrity(id)`, which must say `ok: true`.

#### Where to look

A private `approve` method. Who may approve: a lead or admin of the project's team (or the org admin), never the decision's owner. `verifyIntegrity` is fully done in step 18; for now recompute the hash and compare.

#### Plan

1. Permission: role `lead` or `admin` in the team, or org admin, and not the owner. Otherwise `FORBIDDEN`.
2. Set status, `approved_at`, `approvers`, `updated_at`; audit `approve`; return the envelope.
3. `verifyIntegrity(id)`: `{ ok, expected_hash, current_hash }` from comparing a fresh hash with `content_hash`.

#### Almost the answer

```ts
private canApprove(actor: string, d) {
  const project = this.projects.get(d.project);
  const team = this.teams.get(project.owner, project.team);
  const role = team.members.find((m) => m.user === actor)?.role;
  return actor !== d.owner && (this.access.isOrgAdmin(actor, project.owner) || role === 'lead' || role === ____);
}

verifyIntegrity(id) {
  const d = this.load(id);
  const current_hash = new Bun.CryptoHasher('sha256').update(d.content).digest('hex');
  return { ok: current_hash === d.content_hash, expected_hash: d.content_hash, current_hash };
}
```

### Section: approving an approved decision suggests superseding

#### What the test wants

Approving an already approved decision: `INVALID_STATE` with `current_state: 'approved'`, and `details.alternatives` containing `{ action: 'create_superseding_decision' }`.

#### Where to look

The `INVALID_STATE` error from the first section: add `alternatives`, built from the state table.

#### Plan

1. When the state forbids the action, list what the state allows as alternatives: `allowed.map((action) => ({ action }))`.

#### Almost the answer

```ts
const allowed = ALLOWED[d.status];
throw new DecisionLogError('INVALID_STATE', `cannot ${request.action} a ${d.status} decision`, 409, {
  current_state: d.status,
  allowed_actions: allowed,
  alternatives: allowed.map((action) => ({ ____ })),
});
```

### Section: decline needs a reason, stores it outside the document and allows return to draft

#### What the test wants

Declining without a reason: `VALIDATION_ERROR`. With a reason: status `declined` and `decline: { reason, by }`, while the content stays as it was. Returning to draft: only the owner (others `FORBIDDEN`), and the status becomes `draft`. Reworking the content afterwards keeps version 1 exactly as it was proposed.

#### Where to look

Private `decline` and `returnToDraft` methods. Decline uses the same permission as approve. The version snapshot from step 16 already keeps the old content, because it stored a copy of the string.

#### Plan

1. `decline`: permission, then reason required, then set status and `decline`, audit, return.
2. `returnToDraft`: owner only, status back to `draft`, audit, return.

#### Almost the answer

```ts
private decline(d, actor, payload) {
  if (!this.canApprove(actor, d)) throw ____;
  if (!payload.reason?.trim()) throw ____;
  const previous = d.status;
  d.status = 'declined';
  d.decline = { reason: payload.reason, by: actor, at: this.ctx.now() };
  // updated_at, audit, envelope
}
```

### Section: only a lead or an admin may decline, whatever the approval mode

#### What the test wants

A member, the owner or an outsider declining: `FORBIDDEN`. The org admin declining works. In consensus mode a lead's decline ends the decision outright (`declined`), and `vote_tally.request_revision` stays 0: a decline is not a vote.

#### Where to look

Your `canApprove` rule, used by `decline` in every mode. `vote_tally` already exists on new decisions (step 14).

#### Plan

1. Check that `decline` uses `canApprove` and does not depend on the approval mode.
2. Do not touch `vote_tally` in `decline`.

#### Almost the answer

```ts
// in perform, before the state check: who may perform each action
private mayPerform(action: string, actor: string, d): boolean {
  switch (action) {
    case 'propose':
    case 'return_to_draft': return actor === d.owner;
    case 'approve':
    case 'decline': return ____;
    default: return true;   // later steps add votes, comments, ...
  }
}

if (!this.mayPerform(request.action, actor, d)) throw new DecisionLogError('FORBIDDEN', `you may not ${request.action} this decision`, 403);
```

## Common mistakes

- Checking the state before permission: the API spec expects a non-owner proposing an approved decision to get 403, not 409.
- Writing the decline reason into the content.
- Letting the owner approve or decline their own decision.
