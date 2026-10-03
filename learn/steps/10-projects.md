# 10 · Composing domain and service: projects

## Goal

Implement `ProjectsService`: check permission, build the record with `Project.create` (step 04), refuse duplicates, store it, audit it.

## You'll learn

- Keeping domain rules (`Project`) apart from the service around them
- Using another service you injected → `learn/concepts/services-and-injection.md`
- Checking everything before changing anything → `learn/concepts/permissions.md`

## Where

- `src/decision-log/projects/projects.service.ts`
- `src/decision-log/projects/project.ts` (your step 04 code)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: ProjectsService.create

#### What the test wants

The org admin creates `PRJ`; `get('PRJ')` then returns the same record. A team admin (bob, role `admin`) may create one too; a plain member (alice) gets `FORBIDDEN`. An invalid identifier (`1x`) is a `VALIDATION_ERROR` (from `Project.create`). An unknown team: `NOT_FOUND`. Creating `PRJ` twice: `CONFLICT`.

#### Where to look

`ProjectsService.create`. You already have the pieces: `this.teams.get(owner, team)` (404), `this.access.isTeamAdmin(actor, team)` (403), `Project.create(input, now)` (400). Projects go in `this.ctx.store.projects`, keyed by identifier.

#### Plan

1. Load the team (default `default`).
2. Not team admin: `FORBIDDEN`.
3. `Project.create(input, this.ctx.now())`.
4. Identifier taken: `CONFLICT`.
5. Store, audit, return.

#### Almost the answer

```ts
create(input) {
  const team = this.teams.get(input.owner, input.team ?? 'default');
  if (!this.access.isTeamAdmin(input.actor, team)) throw ____;
  const project = Project.create(input, this.ctx.now());
  if (this.ctx.store.projects.has(project.identifier)) throw ____;
  this.ctx.store.projects.set(project.identifier, project);
  this.audit.record(input.actor, 'create_project', null, null, project);
  return project;
}
```

### Section: ProjectsService.get

#### What the test wants

Getting a project that does not exist throws `NOT_FOUND` 404.

#### Where to look

`ProjectsService.get` reads `this.ctx.store.projects`.

#### Plan

1. Look it up by identifier.
2. Missing: throw `NOT_FOUND`; otherwise return it.

#### Almost the answer

```ts
get(identifier: string) {
  const project = this.ctx.store.projects.get(identifier);
  if (!project) throw new DecisionLogError(____, `project ${identifier} not found`, ____);
  return project;
}
```

### Section: ProjectsService.updateSettings

#### What the test wants

The org admin switches `PRJ` to `consensus_voting`: the stored project has the new mode and voting enabled. A plain member: `FORBIDDEN`. Invalid settings: `VALIDATION_ERROR`, and the stored settings stay exactly as they were.

#### Where to look

`ProjectsService.updateSettings`. `Project.resolveSettings(patch, current)` from step 04 merges and validates and throws on bad input, so call it before changing anything.

#### Plan

1. Load the project and its team.
2. Not team admin: `FORBIDDEN`.
3. `const next = Project.resolveSettings(settings.approval_settings, project.approval_settings)`.
4. Only now assign `project.approval_settings = next`, update `updated_at`, audit, return.

#### Almost the answer

```ts
updateSettings(identifier, actor, settings) {
  const project = this.get(identifier);
  const team = this.teams.get(project.owner, project.team);
  if (!this.access.isTeamAdmin(actor, team)) throw ____;
  const next = Project.resolveSettings(settings.approval_settings, ____);
  project.approval_settings = next;
  project.updated_at = this.ctx.now();
  return project;
}
```

## Common mistakes

- Spreading `input` into the record: `actor` would end up stored on the project. `Project.create` already returns the right fields.
- Changing the stored settings before validating the new ones.
