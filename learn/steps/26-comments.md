# 26 · Comments: threads, mentions, edit windows

## Goal

Comments: anyone on the team, in any status, threaded, with @mentions that notify, a five-minute edit window, soft deletes and resolving.

## You'll learn

- Soft deletes
- Time windows
- Parsing @mentions against known users

## Where

- `src/decision-log/comments/comments.service.ts`
- `src/decision-log/profiles/profiles.service.ts` (`listNotifications`)
- New collections `comments` and `notifications` (ARRAY) and their migration

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Mentions are `@name` matched against team members' user ids before the `@` of their address.

### Hint 2

A mention creates a notification `{ user, type: 'mention', decision_id, … }`; `listNotifications(user)` filters by user.

### Hint 3

Edit allowed while `now - created_at <= 5 minutes`. Delete keeps the comment with content `[deleted]` and `deleted_at`.

### Hint 4

Resolve: the comment's author, the decision's owner, or an admin.
