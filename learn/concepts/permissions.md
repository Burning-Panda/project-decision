# Permissions

Permission checks answer "may this person do this?". Keep each rule small and named, so it reads like the requirement:

```ts
isOrgAdmin(actor, owner)    // the owner identifier itself acts as organisation admin
isTeamAdmin(actor, team)    // org admin, or a team member with role 'admin'
```

Roles in a team are `member`, `lead` and `admin`.

## Where checks go

1. Load what the request is about. If it does not exist: `NOT_FOUND` (404).
2. Check who is asking. If they may not: `FORBIDDEN` (403).
3. Check the input. If it is wrong: `VALIDATION_ERROR` (400).
4. Check the state (`CONFLICT` or `INVALID_STATE`, 409). Then change things.

Checking permission **before** validation means a stranger learns nothing about valid inputs. Doing every check **before** changing anything means a refused request leaves no trace.

## Default deny

Write rules as "allowed if ..." and refuse everything else. A rule that forgets a case then refuses it instead of allowing it.
