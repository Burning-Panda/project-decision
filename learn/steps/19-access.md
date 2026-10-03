# 19 · Who may see what

## Goal

Make every read respect teams: outsiders see nothing, members see their own team's decisions, the org identifier sees everything.

## You'll learn

- One read rule used by every read path → `learn/concepts/permissions.md`
- Default deny

## Where

- `src/decision-log/core/access.service.ts`
- `src/decision-log/decisions/decisions.service.ts`
- `src/decision-log/comments/comments.service.ts` (`list`)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: outsiders cannot read anything; the org identifier can read everything

#### What the test wants

An outsider calling `getDecision`, `listComments`, `getVersions`, `getParticipants` or `renderDecisionDocument` gets `FORBIDDEN`. The org identifier (`acme`) may read the decision.

#### Where to look

Put the rule in `AccessService` and use it in `get` in `src/decision-log/decisions/decisions.service.ts`. Then make every other read start with `this.get(id, actor)`. `CommentsService` already has `DecisionsService` injected: its `list` can call `this.decisions.get(id, actor)` and return `[]` until comments exist (step 26).

#### Plan

1. `AccessService.canRead(actor, team)`: org admin or a member of the team.
2. `DecisionsService.get`: load, find the team, `canRead` or `FORBIDDEN`.
3. `versions`, `participants`, `renderDocument`: call `this.get(id, actor)` first.
4. `CommentsService.list`: `this.decisions.get(id, actor); return [];` for now.

#### Almost the answer

```ts
// AccessService
canRead(actor: string, team: Team) {
  return this.isOrgAdmin(actor, team.owner) || team.members.some((m) => m.user === ____);
}

// DecisionsService
get(id, actor) {
  const d = this.load(id);
  const project = this.projects.get(d.project);
  if (!this.access.canRead(actor, this.teams.get(project.owner, project.team))) throw ____;
  return d;
}
```

### Section: projects live in a team; decisions are visible only to that team

#### What the test wants

A project in team `payments` gives its decisions that team. Carol, only in `default`, cannot read a `payments` decision (`FORBIDDEN`), and alice cannot create one there (`FORBIDDEN`).

#### Where to look

Nothing new to write if `create` takes the team from the project (step 14) and `get` checks the decision's project team (previous section). If this fails, check that you use the **project's** team, not `default`.

#### Plan

1. In `create`, the decision's `team` is `project.team`.
2. In `get`, the team you check is the decision's project team.

#### Almost the answer

```ts
const team = this.teams.get(project.owner, project.team);   // not 'default'
```

## Common mistakes

- Checking access in some read paths but not others: every read should go through `get`.
- Assuming every project is in the `default` team.
