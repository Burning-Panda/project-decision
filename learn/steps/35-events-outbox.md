# 35 · Events and the outbox

## Goal

Every lifecycle step records an event in an outbox and creates a pending delivery for each matching active webhook of the same org. Failed actions record nothing.

## You'll learn

- The outbox pattern: write the event in the same place as the change, send it later
- Wildcard filters
- Payloads that carry ids, never document or comment text

## Where

- `src/decision-log/webhooks/webhooks.service.ts` (a new `emit`, and `deliveries`)
- `src/decision-log/decisions/decisions.service.ts`, `src/decision-log/comments/comments.service.ts`, `src/decision-log/followups/followups.service.ts` (calls to `emit`)
- New collections `events` and `deliveries` (ARRAY) and a new migration

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: events are recorded in the outbox and fan out to matching active hooks of the same org only

#### What the test wants

Hooks: acme "all", acme "decision.approved only", an acme hook that was deleted, and another org's "all". After a decision is created and proposed: the outbox holds `decision.created`, `decision.proposed` (ids `evt-001`, `evt-002`); the "all" hook has both deliveries (listed by `listDeliveries(hookId, admin)` with `event_type`); the approved-only, the foreign and the deleted hooks have none. After the lead approves, the approved-only hook has `decision.approved`.

#### Where to look

One method in `src/decision-log/webhooks/webhooks.service.ts`: `emit(type, owner, decisionId, payload)`. It writes the event, then one delivery per matching hook. `DecisionsService` may depend on `WebhooksService` (it does not depend back), so inject it and call `emit` from `create` and the `propose` branch. The org is the project's owner: give `DecisionsService` an `ownerOf(d)` helper (`this.teamOf(d).project.owner`, using the `teamOf` from step 26).

#### Plan

1. Add `events` and `deliveries` to `ARRAY_COLLECTIONS` and a migration.
2. `emit`: event `{ id: 'evt-001', type, owner, decision_id, payload, created_at }` pushed on `events`. The payload is `{ id, event: type, decision_id, timestamp, ...extra }` (the same `id` as the event).
3. For each hook with the same `owner`, `active`, not deleted, and some filter matching the type: push a delivery `{ id: 'dlv-1', webhook_id, event_id, event_type, status: 'pending', attempts: 0, next_attempt_at: now, last_status: null, last_error: null, delivered_at: null, created_at: now }`. (Step 43's dispatcher reads exactly these fields.)
4. `deliveries(webhookId, actor, query)`: 404 for a missing hook, org admin only, optional `status` filter, `limit`/`offset` (strings or numbers), returns `{ items, total }`.
5. Ids: the number of rows plus one (`evt-` padded to three digits, `dlv-` plain). Step 43 prunes old rows; if you want ids that are never reused, use the highest number in use plus one instead.

#### Almost the answer

```ts
const matches = (filter: string, type: string) =>
  filter === '*' || filter === type || (filter.endsWith('.*') && type.startsWith(filter.slice(0, -1)));   // 'decision.*' -> prefix 'decision.'

emit(type: string, owner: string, decisionId: string | null, payload: Record<string, unknown> = {}) {
  const { events, deliveries, webhooks } = this.ctx.store;
  const id = `evt-${String(events.length + 1).padStart(3, '0')}`;
  const now = this.ctx.now();
  events.push({ id, type, owner, decision_id: decisionId, payload: { id, event: type, decision_id: decisionId, timestamp: now, ...payload }, created_at: now });
  for (const hook of webhooks) {
    if (hook.owner !== owner || !hook.active || hook.deleted_at || !hook.events.some((f: string) => matches(f, type))) continue;
    deliveries.push({ id: `dlv-${deliveries.length + 1}`, webhook_id: hook.id, event_id: id, event_type: type, status: 'pending', attempts: ____,
      next_attempt_at: now, last_status: null, last_error: null, delivered_at: null, created_at: now });
  }
}
```

### Section: wildcard family filters match

#### What the test wants

A `decision.*` hook on a proposed decision: when bob comments, it still has exactly two deliveries (created, proposed). `comment.created` is not a `decision.` event.

#### Where to look

The `matches` function. A family wildcard is a prefix test on the part before the dot. Also emit `comment.created` when a comment is added (README): in `CommentsService.add`, after the comment is stored.

#### Plan

1. `decision.*` matches types starting with `decision.` and nothing else.
2. Emit `comment.created` with the comment id and actor in the payload, **not** its text. Inject `WebhooksService` into `CommentsService`.

#### Almost the answer

```ts
type.startsWith(filter.slice(0, -1))     // 'decision.*' -> 'decision.'  (keep the dot)

// comments.service.ts, end of add
this.webhooks.emit('comment.created', this.decisions.ownerOf(d), id, { comment_id: comment.id, actor });
```

### Section: vote and approval events carry the documented payload

#### What the test wants

In consensus mode, three approving votes (with comments) close a decision. The outbox has three `decision.vote_received` events, each with `payload.event`, `decision_id`, `voter`, `vote`, a `timestamp` and an `id` equal to the event id. The **last** event is `decision.approved` with `payload.approvers` the three user ids. The closing vote's event comes before the approval. No document or comment content appears anywhere in the events.

#### Where to look

The vote branch and the end of `perform` in `src/decision-log/decisions/decisions.service.ts`. The vote event is emitted when the vote is recorded, so for the closing vote it comes before the approval. The approval event is emitted once, after the switch, when the status just became `approved` (the same place step 28 notifies the owner).

#### Plan

1. After a vote is accepted (validation passed): `emit('decision.vote_received', d, { voter: actor, vote })`. Leave the vote's `comment` out.
2. After the switch, where `d.status === 'approved' && previous !== 'approved'`: `emit('decision.approved', d, { approvers })` with the approvers' user ids.
3. A private `emit(type, d, payload)` on `DecisionsService` keeps the call sites short.

#### Almost the answer

```ts
private emit(type: string, d: any, payload: Record<string, unknown> = {}) {
  this.webhooks.emit(type, this.ownerOf(d), d.id, payload);
}

// vote branch, after castVote
this.emit('decision.vote_received', d, { voter: actor, vote });

// after the switch
if (d.status === 'approved' && previous !== 'approved') {
  this.emit('decision.approved', d, { approvers: (d.approvers ?? []).map((a) => a.____) });
}
```

### Section: every lifecycle step emits its event

#### What the test wants

Each of these emits its event: drafting (`decision.created`), propose, request revision, decline, approve, recording a meeting (`meeting.recorded`), returning a declined decision to draft, assigning a follow-up (`followup.assigned`), completing one (`followup.completed`), and approving a successor (`decision.superseded`, for the original).

#### Where to look

One `emit` call at the end of each branch: `request_revision` (`decision.revision_requested`), `decline` (`decision.declined`), `return_to_draft` (`decision.returned_to_draft`), the place where a successor's approval marks the original (`decision.superseded`), `FollowupsService.addFollowup`, `FollowupsService.updateTodo` (only when the new status is `completed`) and `addMeeting`.

#### Plan

1. `DecisionsService`: `decision.created`, `proposed`, `revision_requested` (also a veto-mode revision vote), `declined`, `returned_to_draft`, `approved`, `superseded` (payload `{ superseded_by }`, decision id = the original).
2. `FollowupsService`: `followup.assigned`, `followup.completed`, `meeting.recorded`. Inject `WebhooksService`; the org is `this.decisions.ownerOf(decision)`.
3. Payloads: ids and actors, never text.

#### Almost the answer

```ts
// followups.service.ts
this.webhooks.emit('followup.assigned', this.decisions.ownerOf(d), id, { followup_id: f.id, assigned_to: f.assigned_to, actor });

// updateTodo, after the change
if (patch.status === 'completed') {
  this.webhooks.emit('____', this.decisions.ownerOf(this.ctx.store.decisions.get(f.decision_id)), f.decision_id, { followup_id: f.id, actor });
}
```

### Section: failed actions emit nothing

#### What the test wants

Bob failing to propose (`FORBIDDEN`) and the lead failing to approve a draft (`INVALID_STATE`) leave the events collection unchanged.

#### Where to look

Where each `emit` sits. Same rule as the audit entry: it comes after every check that can throw. Passing already? Then your emits are in the right place.

#### Plan

1. Put each `emit` after the branch's validation, never at the top of `perform`.

#### Almost the answer

```ts
case 'decline':
  if (!payload.reason?.trim()) throw ...;     // 1. validate
  d.status = 'declined';                       // 2. change
  this.emit('decision.declined', d, { by: actor });   // 3. then announce
  break;
```

## Common mistakes

- Matching `decision.*` with `startsWith('decision')` (no dot): it would match `decisions.x`.
- Putting the comment text, vote comment or document content in a payload: the test greps for `"content"`.
- Emitting at the top of `perform`: a refused action would still be announced.
- Using the decision's `owner` field as the org: that is the author. The org is the project's `owner` (`ownerOf`).
- Emitting the vote event after the approval event for the closing vote.
