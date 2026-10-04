# 29 · Follow-ups and todo lists

## Goal

Follow-ups become todos: assigned to a teammate with validation, listed per user with filters, sorting and paging, completed by the assignee, with `overdue` derived from the due date and a small stats summary.

## You'll learn

- Derived state: `overdue` is computed when read, never stored
- Sorting by different keys (by date, by a custom rank)
- Paging: filter, sort, then slice, with a total taken before the slice

## Where

- `src/decision-log/followups/followups.service.ts`
- `src/decision-log/decisions/decisions.service.ts` (`get` shows the decision's follow-ups; `assign_followup` joins `ANY_STATUS`)
- New collection `followups` (ARRAY) and a migration

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: assign_followup creates a pending follow-up/todo and notifies the assignee

#### What the test wants

Alice uses `assign_followup` (the `FOLLOWUP` fixture, to bob): 201 and `data.followup` has id `followup-NNN`, the decision id, `assigned_to` bob, `created_by` alice, `status: pending`, `completed_at: null`. Bob has a `followup_assigned` notification. `getDecision(id).followups` lists it.

#### Where to look

`addFollowup` in `src/decision-log/followups/followups.service.ts`, wired like `add_comment` (step 26): register `assign_followup` in the constructor, add it to `ANY_STATUS`. The decision's `followups` is not stored on the decision: have `get` attach them (a copy of the decision plus the matching rows of the `followups` collection), so the two can never disagree.

#### Plan

1. Register the handler: status 201, `data: { followup }`. Add `followups` to `ARRAY_COLLECTIONS` and a migration. Inject `ProfilesService`.
2. `addFollowup`: access check (`this.decisions.get`), validate (next section), build the record with id `followup-` + the count + 1 padded to three digits.
3. `notify(assigned_to, 'followup_assigned', d, actor)`.
4. In `DecisionsService.get`: `return { ...d, followups: this.ctx.store.followups.filter((f) => f.decision_id === id) }`. (Step 37's spec also reads `getDecision(id).comments`; attach the decision's comments in the same place, now or then.)

#### Almost the answer

```ts
const f = {
  id: `followup-${String(all.length + 1).padStart(3, '0')}`, decision_id: id, title: input.title, description: input.description ?? null,
  assigned_to: input.assigned_to, created_by: actor, due_date: input.due_date ?? null, priority: input.priority ?? 'medium',
  status: 'pending', assignee_notes: null, completed_at: null, created_at: this.ctx.now(),
};
all.push(f);
this.profiles.notify(f.assigned_to, '____', d, actor, { followup_id: f.id });
return structuredClone(f);
```

### Section: assign_followup validation and permissions

#### What the test wants

These are all `VALIDATION_ERROR` 400: an empty title, an assignee outside the team, `due_date: 'tomorrow'`, an unknown priority (`urgent`). An outsider assigning is `FORBIDDEN` 403. Without a priority it defaults to `medium`.

#### Where to look

The top of `addFollowup`. Order: access first (outsider: 403), then the field checks.

#### Plan

1. Title: non-blank.
2. Assignee: must be a member of the decision's team (`this.decisions.teamOf(d).members`).
3. `due_date` (optional): `YYYY-MM-DD` and a real date.
4. Priority (optional): `high`, `medium` or `low`.

#### Almost the answer

```ts
const bad = (message: string) => new DecisionLogError('VALIDATION_ERROR', message, 400);

if (!input.title?.trim()) throw bad('title is required');
if (!team.members.some((m) => m.user === ____)) throw bad('assignee must be on the team');
if (input.due_date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(input.due_date) || Number.isNaN(Date.parse(input.due_date)))) throw bad('due_date must be YYYY-MM-DD');
const priority = input.priority ?? 'medium';
if (!['high', 'medium', 'low'].includes(priority)) throw bad(`unknown priority ${priority}`);
```

### Section: todo list is per user with decision context, filters, sorting and paging

#### What the test wants

Bob has todos A (due 05-01, high), B (04-10, low), C (04-20, medium, in progress); carol has one. `listTodos({ user: bob })`: `total` 3, each item has `decision_title`. Sorted by `due_date`: B, C, A. By `priority`: A, C, B (high to low). `status: in_progress`: only C. `project: NOPE`: none. `sort: due_date, limit: 1, offset: 1`: `total` 3 and the page is C.

#### Where to look

`listTodos` in `FollowupsService` (read `learn/concepts/maps-arrays-records.md` for `filter`/`map`). Each item is the followup plus `decision_title` and `project`, looked up from its decision. The filters arrive as strings (the DTO), so `Number(limit)`.

#### Plan

1. Map every followup to an item: a copy, plus `decision_title` and `project` from `this.ctx.store.decisions.get(f.decision_id)`.
2. Filter by `user` (assignee), `status` and `project`, each only when given.
3. Sort: `due_date` ascending (text comparison works for `YYYY-MM-DD`; missing dates last); `priority` by rank in `['high', 'medium', 'low']`. Without `sort`, keep creation order.
4. `total = items.length`, **then** slice `offset .. offset + limit`.
5. Return `{ items, total }`.

#### Almost the answer

```ts
const RANK = ['high', 'medium', 'low'];
let items = this.ctx.store.followups.map((f) => {
  const d = this.ctx.store.decisions.get(f.decision_id);
  return { ...structuredClone(f), decision_title: d?.title, project: d?.project };
}).filter((t) => (!filters.user || t.assigned_to === filters.user) && (!filters.status || t.status === filters.status) && (!filters.project || t.project === filters.project));

if (filters.sort === 'due_date') items.sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
if (filters.sort === 'priority') items.sort((a, b) => RANK.indexOf(a.priority) - RANK.indexOf(b.____));
const total = items.length;                     // before paging
const offset = Number(filters.offset ?? 0), limit = Number(filters.limit ?? 50);
return { items: items.slice(offset, offset + limit), total };
```

### Section: assignees update status/notes; completion syncs to the decision

#### What the test wants

Carol completing bob's todo is `FORBIDDEN`. Setting the status to `overdue` or to `done` is `VALIDATION_ERROR`. Updating `followup-999` is `NOT_FOUND`. A day later bob completes it with notes: `status: completed`, `assignee_notes` set, `completed_at` is "now" (`2024-03-21T10:00:00.000Z`), and the decision's follow-up shows `completed`.

#### Where to look

`updateTodo(todoId, actor, patch)`. Order: find (404), assignee only (403), then validate the status. "Syncs to the decision" costs nothing if you did step "assign" right: the decision's `followups` is read from the same rows.

#### Plan

1. Find by id or `NOT_FOUND`.
2. `f.assigned_to !== actor`: `FORBIDDEN`.
3. A status must be `pending`, `in_progress` or `completed`. `overdue` is not an allowed *input* (it is derived, next section).
4. Setting `completed` stores `completed_at = this.ctx.now()`; any other status clears it. `notes` goes to `assignee_notes`.
5. Return a copy.

#### Almost the answer

```ts
const STATUSES = ['pending', 'in_progress', 'completed'];   // bad(...) is the helper from the validation section
const f = this.ctx.store.followups.find((x) => x.id === todoId);
if (!f) throw new DecisionLogError('NOT_FOUND', `${todoId} not found`, 404);
if (f.assigned_to !== actor) throw new DecisionLogError('FORBIDDEN', 'only the assignee updates a todo', 403);
if (patch.status !== undefined && !STATUSES.includes(patch.status)) throw bad(____);
if (patch.status !== undefined) {
  f.status = patch.status;
  f.completed_at = patch.status === 'completed' ? this.ctx.now() : null;
}
if (patch.notes !== undefined) f.assignee_notes = patch.notes;
```

### Section: overdue is derived from the due date and never applies to completed items

#### What the test wants

Two todos due 2024-03-25, one completed. Before that date, listing `status: overdue` gives nothing. Ten days later it gives only the incomplete one, and its `status` reads `overdue`. Listing `completed` shows the completed one as `completed`.

#### Where to look

A tiny helper in `FollowupsService`, used by `listTodos`. Do not store `overdue`; compute it every time from `due_date` and today. Today is `this.ctx.now().slice(0, 10)`, a `YYYY-MM-DD` string, which compares correctly with `<`.

#### Plan

1. `status(f)`: `completed` stays `completed`; a todo with a due date before today is `overdue`; otherwise its stored status.
2. In `listTodos`, replace each item's `status` with it **before** filtering, so `status: overdue` finds them and `status: pending` does not.

#### Almost the answer

```ts
private today() { return this.ctx.now().slice(0, 10); }
private status(f) { return f.status !== 'completed' && f.due_date && f.due_date ____ this.today() ? 'overdue' : f.status; }

// in listTodos
return { ...structuredClone(f), status: this.status(f), decision_title: d?.title, project: d?.project };
```

### Section: todo stats summarise completion

#### What the test wants

Four todos for bob ten days on: one completed, one past due (due 03-26), two on track. `todoStats(bob)` is `{ total: 4, completed: 1, completion_rate: 0.25, overdue: 1, on_track: 2 }`.

#### Where to look

`todoStats(user)`. Reuse the derived `status` helper so the counts agree with the list.

#### Plan

1. The user's followups.
2. `completed`: stored status `completed`. `overdue`: derived status `overdue`.
3. `completion_rate` = completed / total (0 when there are none). `on_track` = total − completed − overdue.

#### Almost the answer

```ts
const mine = this.ctx.store.followups.filter((f) => f.assigned_to === user);
const completed = mine.filter((f) => f.status === 'completed').length;
const overdue = mine.filter((f) => this.status(f) === 'overdue').length;
return { total: mine.length, completed, completion_rate: mine.length ? completed / mine.length : 0, overdue, on_track: ____ };
```

## Common mistakes

- Storing `overdue` as a status. The tests move the clock, so the stored value goes stale; compute it on read.
- Slicing before counting: `total` must count everything that matched.
- Sorting `priority` as text (`high`, `low`, `medium` alphabetically); use the rank list.
- Validating the assignee before checking access: an outsider must get `FORBIDDEN`, not a validation error.
- Forgetting `limit`/`offset` can arrive as strings (`Number(...)`).
