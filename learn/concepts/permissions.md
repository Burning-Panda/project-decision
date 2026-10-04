# Permissions

Permission checks answer "may this person do this?". Every check has the same four inputs:

| Input | Question | Example in this project |
|---|---|---|
| **Subject** | Who is asking? | `alice` (the `X-User` header) |
| **Action** | What do they want to do? | `approve`, `read`, `add a member` |
| **Resource** | What is it done to? | decision `PRJ-001`, team `payments` |
| **Context** | What else is true right now? | the decision is `proposed`; alice is not its owner |

Keep each rule small and named, so it reads like the requirement:

```ts
isOrgAdmin(actor, owner)    // the owner identifier itself acts as organisation admin
isTeamAdmin(actor, team)    // org admin, or a team member with role 'admin'
```

Roles in a team are `member`, `lead` and `admin`. A rule that looks only at roles is **role-based access control (RBAC)**. It is the right place to start, and the steps up to 19 use it.

## Where checks go

1. Load what the request is about. If it does not exist: `NOT_FOUND` (404).
2. Check who is asking. If they may not: `FORBIDDEN` (403).
3. Check the input. If it is wrong: `VALIDATION_ERROR` (400).
4. Check the state (`CONFLICT` or `INVALID_STATE`, 409). Then change things.

Checking permission **before** validation means a stranger learns nothing about valid inputs. Doing every check **before** changing anything means a refused request leaves no trace.

## Default deny

Write rules as "allowed if ..." and refuse everything else. A rule that forgets a case then refuses it instead of allowing it.

## Rules are more than roles

Look at "who may approve" in step 17: a `lead` or `admin` of the decision's team, or the org admin, **but never the decision's own owner**. That rule uses a role, a fact about the resource (which team owns it) and a relationship between subject and resource (alice is not the owner). A role alone cannot say it.

Real systems reach this point quickly. `learn/concepts/authorization-models.md` covers the models for it: permission-based checks, attribute-based access control (ABAC), and how to keep many rules testable.

## Common mistakes

- Checking the role name where the rule is about a capability ("is `lead`" instead of "may approve"). Rename a role and every check breaks.
- Checking access in some code paths but not others. Route every path through one function.
- Returning `NOT_FOUND` or `FORBIDDEN` inconsistently. Decide once whether a stranger may learn that something exists.
