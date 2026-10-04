# 26 · Comments: threads, mentions, edit windows

## Goal

Comments: anyone on the team can comment in any status, comments are threaded, @mentions notify the person mentioned, the author may edit for five minutes, delete leaves a placeholder, and a comment can be resolved and re-opened.

## You'll learn

- Soft deletes: keep the row, blank the content
- Time windows: comparing two timestamps
- Turning `@name` into a team member
- Letting one service plug into another without a circular dependency

## Where

- `src/decision-log/comments/comments.service.ts`
- `src/decision-log/profiles/profiles.service.ts` (`listNotifications`, a new `notify`)
- `src/decision-log/decisions/decisions.service.ts` (`perform` learns three new actions)
- New collections `comments` and `notifications` (ARRAY) in `src/storage/store.ts`, and a new SQLite migration (version 4 in the reference; never edit an earlier one)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: anyone on the team can comment in any status; outsiders cannot

#### What the test wants

Bob uses the `add_comment` action on an approved decision: status 201 and `data.comment` is his comment, `user` bob, `resolved: false`. An outsider doing the same is `FORBIDDEN` 403. Blank content (`"   "`) is `VALIDATION_ERROR` 400.

#### Where to look

Two places. In `src/decision-log/decisions/decisions.service.ts`, `perform` has a state table (`ALLOWED`): `add_comment` is in your list of action names but in no state, so today it answers `INVALID_STATE`. And in `CommentsService`, `add`. Read `learn/concepts/services-and-injection.md` first if "circular dependency" is new to you.

`CommentsService` already depends on `DecisionsService` (it is in its constructor). So `DecisionsService` cannot also depend on `CommentsService`: Nest cannot build two services that each need the other first. Let `perform` hand the action to whoever registered for it.

#### Plan

1. Allow `add_comment` in every state. Make one shared list, `ANY_STATUS`, and add it to each state's row (steps 27 and 29 add two more actions to it).
2. In `DecisionsService`, add a small registry: `handle(action, fn)` stores a function in a `Map`; the `default` branch of `perform` looks the action up and calls it with `(decision, actor, payload)`. The function returns `{ status_code, data }`.
3. In `CommentsService`'s constructor, register `add_comment`: it calls `this.add(...)` and answers `{ status_code: 201, data: { comment } }`.
4. `add(id, actor, input)`: first `this.decisions.get(id, actor)`: it throws `FORBIDDEN` for an outsider, which is exactly the rule. Then validate the content, build the comment, push it on `comments`, return a copy.
5. Comment ids: `comment-001`, `comment-002`, ... (the count of comments so far, plus one).

#### Almost the answer

```ts
// decisions.service.ts
const ANY_STATUS = ['add_comment'];
const ALLOWED: Record<string, string[]> = {
  draft: ['propose', ...ANY_STATUS],
  proposed: ['approve', 'decline', 'vote', 'request_revision', ...ANY_STATUS],
  // ... the same for approved and declined
};
type ActionHandler = (d: any, actor: string, payload: any) => { status_code: number; data: Record<string, unknown> };

private readonly handlers = new Map<string, ActionHandler>();
handle(action: string, handler: ActionHandler) { this.handlers.set(action, handler); }

// in perform's switch
default: {
  const handler = this.handlers.get(request.action);
  if (!handler) throw new NotImplementedError(`action ${request.action}`);
  const r = handler(d, actor, payload);
  status_code = r.status_code;
  data = r.data;
}

// comments.service.ts
constructor(/* ctx, decisions, audit */) {
  decisions.handle('add_comment', (d, actor, payload) => ({ status_code: ____, data: { comment: this.add(d.id, actor, payload) } }));
}

add(id: string, actor: string, input: AddCommentDto) {
  const d = this.decisions.get(id, actor);                       // outsiders: FORBIDDEN
  if (!input.content?.trim()) throw new DecisionLogError('VALIDATION_ERROR', 'content is required', 400);
  const all = this.ctx.store.comments;
  const comment = { id: `comment-${String(all.length + 1).padStart(3, '0')}`, decision_id: id, user: actor, content: input.content,
    parent_id: input.parent_id ?? null, mentions: [], resolved: false, created_at: this.ctx.now(), edited_at: null, deleted_at: null };
  all.push(comment);
  return structuredClone(comment);
}
```

### Section: comments are chronological, threaded and mention-aware

#### What the test wants

Alice comments; ten minutes later bob replies with `parent_id` set and the text `cc @carol and @nobody`. The reply's `mentions` is exactly `[carol]` (`@nobody` is not a member). Carol has a notification of type `mention` for the decision. A reply to a parent that does not exist is `NOT_FOUND`. Listing returns the comments oldest first.

#### Where to look

`add` and `list` in `CommentsService`, and `listNotifications` in `ProfilesService`. A mention is `@` followed by the part of a member's id before the `@` (carol@acme.com is `@carol`). The team's members: `this.teams.get(project.owner, project.team).members`; give `DecisionsService` a public `teamOf(d)` that returns it, so comments can reuse it.

#### Plan

1. In `add`: if `parent_id` is given, it must be one of this decision's comments (404 otherwise).
2. Find every `@word` in the content with a regex. For each, look for a team member whose id before the `@` equals the word. Keep each user once.
3. Store them as `mentions`.
4. For each mention, add a notification. Give `ProfilesService` a `notify(user, type, decision, actor, extra)` that pushes `{ id, user, type, decision_id, project, title, actor, read: false, created_at, ...extra }` on the `notifications` collection and does nothing when `user === actor` (nobody is told about their own action). Inject `ProfilesService` into `CommentsService`.
5. `listNotifications(user)`: that user's rows, newest first.
6. `list`: `this.decisions.get(...)` first (access), then the decision's comments sorted by `created_at`.

#### Almost the answer

```ts
const team = this.decisions.teamOf(d);
const mentions = [...new Set([...input.content.matchAll(/@([\w.+-]+)/g)].map((m) => m[1]))]
  .map((name) => team.members.find((m) => m.user.split('@')[0] === ____)?.user)
  .filter((u): u is string => Boolean(u));
for (const user of mentions) this.profiles.notify(user, 'mention', d, actor, { comment_id: comment.id });

// profiles.service.ts
notify(user: string, type: string, decision, actor: string | null, extra = {}) {
  if (!user || user === ____) return;
  const all = this.ctx.store.notifications;
  all.push({ id: `notif-${String(all.length + 1).padStart(4, '0')}`, user, type, decision_id: decision.id, project: decision.project,
    title: decision.title, actor, read: false, created_at: this.ctx.now(), ...extra });
}
listNotifications(user: string) { return this.ctx.store.notifications.filter((n) => n.user === user).map((n) => structuredClone(n)).reverse(); }
```
Add `'notifications'` and `'comments'` to `ARRAY_COLLECTIONS` in `src/storage/store.ts`, and a new migration that creates their tables (the `storage` specs fail until you do).

### Section: authors may edit within five minutes only

#### What the test wants

Bob edits his own comment four minutes after writing it: `content` changes and `edited_at` is set. Carol editing it is `FORBIDDEN` 403. Bob editing six minutes later is `EDIT_WINDOW_EXPIRED` 403.

#### Where to look

`edit` in `CommentsService`. The tests move the clock (`h.clock.advanceMinutes(4)`); your code reads time only through `this.ctx.now()`, which gives an ISO string. Subtracting two `Date.parse` results gives milliseconds.

#### Plan

1. Find the comment of this decision (404 `NOT_FOUND` if missing). Do `this.decisions.get(id, actor)` first for access.
2. Not the author: `FORBIDDEN`. This check comes before the time check, so carol gets 403 `FORBIDDEN`, not the expiry code.
3. Older than five minutes: `EDIT_WINDOW_EXPIRED` with status 403.
4. Set `content` and `edited_at`; return a copy.

#### Almost the answer

```ts
const EDIT_WINDOW_MS = 5 * 60_000;

private find(id: string, commentId: string) {
  const c = this.ctx.store.comments.find((x) => x.id === commentId && x.decision_id === id);
  if (!c) throw new DecisionLogError('NOT_FOUND', `comment ${commentId} not found`, 404);
  return c;
}

edit(id: string, commentId: string, actor: string, content: string) {
  this.decisions.get(id, actor);
  const c = this.find(id, commentId);
  if (c.user !== actor) throw new DecisionLogError('FORBIDDEN', 'only the author edits a comment', 403);
  const age = Date.parse(this.ctx.now()) - Date.parse(c.created_at);
  if (age ____ EDIT_WINDOW_MS) throw new DecisionLogError('EDIT_WINDOW_EXPIRED', 'comments can be edited for five minutes', 403);
  c.content = content;
  c.edited_at = this.ctx.now();
  return structuredClone(c);
}
```

### Section: the edit window includes the fifth minute

#### What the test wants

A comment exactly five minutes old can still be edited by its author.

#### Where to look

The comparison in `edit`. This is the boundary: exactly 5:00 is allowed, 5:00.001 is not.

#### Plan

1. Refuse only when the age is **greater than** the window.

#### Almost the answer

```ts
if (age > EDIT_WINDOW_MS) throw ...;   // not >=
```

### Section: delete leaves a placeholder; authors and admins only

#### What the test wants

Carol deleting bob's comment is `FORBIDDEN`. Bob deleting his own, or the org admin deleting it, returns the comment with `content: '[deleted]'` and `deleted_at` set. Listing afterwards still shows the placeholder.

#### Where to look

`remove` in `CommentsService`. "Admin" is exactly what `AccessService.isTeamAdmin(actor, team)` answers (step 9): the org admin or a team member with role `admin`.

#### Plan

1. Access check, then find the comment (404).
2. Allowed when the actor wrote it, or `this.access.isTeamAdmin(actor, team)`. Otherwise `FORBIDDEN`. (Inject `AccessService`, or expose an `isAdmin(actor, d)` helper on `DecisionsService`.)
3. Do not remove the row: set `content` to `[deleted]` and `deleted_at` to now. That is a *soft delete*; threads keep working because replies still point at it.

#### Almost the answer

```ts
remove(id: string, commentId: string, actor: string) {
  const d = this.decisions.get(id, actor);
  const c = this.find(id, commentId);
  if (c.user !== actor && !this.access.isTeamAdmin(actor, ____)) throw new DecisionLogError('FORBIDDEN', 'only the author or an admin deletes a comment', 403);
  c.content = '[deleted]';
  c.deleted_at = this.ctx.now();
  return structuredClone(c);
}
```

### Section: comments can be resolved and re-opened

#### What the test wants

Alice resolves bob's open comment: `resolved` is true. Alice re-opens a resolved one with `resolveComment(id, commentId, alice, false)`: `resolved` is false.

#### Where to look

`resolve(id, commentId, actor, resolved = true)` in `CommentsService`. The last argument decides the direction.

#### Plan

1. Access check and find (404).
2. Set `c.resolved = resolved`.
3. Return a copy.

#### Almost the answer

```ts
resolve(id: string, commentId: string, actor: string, resolved = true) {
  const d = this.decisions.get(id, actor);
  const c = this.find(id, commentId);
  // who may resolve: see the next section
  c.resolved = ____;
  return structuredClone(c);
}
```

### Section: the comment author and the decision owner may resolve a comment; others may not

#### What the test wants

Bob (the author) may resolve his comment. Carol (another member) and an outsider are `FORBIDDEN`. (Alice owns the decision, so she may too; that is the previous section.)

#### Where to look

The permission line in `resolve`. Two people only: the comment's `user`, and the decision's `owner`.

#### Plan

1. Allowed when `actor === c.user` or `actor === d.owner`.
2. Otherwise `FORBIDDEN`. The outsider is refused earlier, by the access check.

#### Almost the answer

```ts
if (actor !== c.user && actor !== ____) throw new DecisionLogError('FORBIDDEN', 'only the comment author or the decision owner resolves', 403);
```

## Common mistakes

- Making `DecisionsService` depend on `CommentsService` (a circular dependency: Nest fails at start-up). Register a handler instead.
- Forgetting that `add_comment` must be allowed in every status; the first test comments on an approved decision.
- Checking the time before the author: carol would get `EDIT_WINDOW_EXPIRED` instead of `FORBIDDEN`.
- Using `>=` for the window; the fifth minute must still work.
- Returning the stored comment object instead of a copy; later edits then change what you handed out.
- Forgetting the new collections in `src/storage/store.ts` and the migration (the storage specs say so).
