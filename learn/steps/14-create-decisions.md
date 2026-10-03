# 14 · Creating decisions: ids, defaults, validation

## Goal

Create decisions: per-project ids (`PRJ-001`), the default template, the owner as first participant, validation and team membership. Decisions need new collections, so this is also where you add your first migration after migration 1.

## You'll learn

- Adding a collection and its migration → `learn/concepts/sql-and-migrations.md`
- Asking Nest for another service → `learn/concepts/services-and-injection.md`
- Domain words (decision, draft, participant) → `learn/concepts/glossary.md`

## Where

- `src/decision-log/decisions/decisions.service.ts` (`create`, `get`, `participants`)
- `src/storage/store.ts` and `src/storage/migrations/sqlite.ts`
- `src/decisions/dto/create-decision.dto.ts`

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: decision ids increment per project and project count tracks them

#### What the test wants

The first decision in `PRJ` is `PRJ-001`, the second `PRJ-002`. Numbering is per project: the first in `WEB` is `WEB-001`. `getProject('PRJ').decision_count` counts the decisions in that project.

#### Where to look

`src/decision-log/decisions/decisions.service.ts`, `create`. The project (from `this.projects.get`) has `last_number` and `decision_count`: increase both and build the id from the number. Store decisions in a new Map collection `decisions`.

#### Plan

1. Add `decisions` to `MAP_COLLECTIONS` and `participants` to `ARRAY_COLLECTIONS` in `src/storage/store.ts`.
2. Add SQLite migration 2 creating those two tables. (Step 13 goes red until you do: that is the collections check working.)
3. In `create`: get the project, increase `last_number` and `decision_count`, id = identifier + `-` + the number padded to 3 digits.
4. Store the decision under its id and return it.

#### Almost the answer

```ts
const project = this.projects.get(input.project);
project.last_number += 1;
project.decision_count += 1;
const number = project.last_number;
const id = `${project.identifier}-${String(number).padStart(____, '0')}`;

// src/storage/migrations/sqlite.ts
{ version: 2, name: 'decisions', up: () => ['decisions', 'participants'].map(table).join('\n') },
```

### Section: new decision is an owned draft with the default template when no content given

#### What the test wants

A new decision has status `draft`, the creator as `owner`, number 1 and the project's team. Without content, its content is the template with the headings `## Context`, `## Decision`, `## Alternatives Considered`, `## Consequences`, `## Follow-up Actions`. Listing its participants gives only the owner, with role `owner`.

#### Where to look

The rest of `create`, plus `get` and `participants` in `src/decision-log/decisions/decisions.service.ts`. Record a participant in `this.ctx.store.participants` when the decision is created. Audit the creation with action `create` and the decision id (the audit specs later expect exactly that).

#### Plan

1. Write a `TEMPLATE` constant with the five headings.
2. Build the decision: `id, project, team, owner, number, title, content, status: 'draft', created_at, updated_at`, and `vote_tally: { approve: 0, request_revision: 0, abstain: 0 }` (later steps use it).
3. Push `{ decision_id, user, roles: ['owner'], actions: [...] }` onto participants.
4. Return a **copy** of the decision (`structuredClone`), so whoever called `create` keeps a snapshot that later changes do not alter.
5. `get(id)`: return it or throw `NOT_FOUND`. `participants(id)`: the entries for that decision as `{ user, roles, actions }`.

#### Almost the answer

```ts
const TEMPLATE = '## Context\n\n## Decision\n\n## Alternatives Considered\n\n## Consequences\n\n## Follow-up Actions\n';

const now = this.ctx.now();
const decision = {
  id, project: project.identifier, team: project.team, owner: input.actor, number,
  title, content: input.content ?? ____, status: 'draft',
  vote_tally: { approve: 0, request_revision: 0, abstain: 0 },
  created_at: now, updated_at: now,
};
this.ctx.store.decisions.set(id, decision);
this.ctx.store.participants.push({ decision_id: id, user: input.actor, roles: ['owner'], actions: [{ action_type: 'created', at: now }] });
this.audit.record(input.actor, 'create', id, null, decision);
return structuredClone(decision);   // a copy: the caller must not hold the stored object
```

### Section: creation validation and permissions

#### What the test wants

An outsider (not on the project's team) creating a decision: `FORBIDDEN` 403. An unknown project: `NOT_FOUND` 404. A title of only spaces: `VALIDATION_ERROR` 400.

#### Where to look

Membership means: the org admin, or a member of the project's team. You need the team, so ask Nest for `TeamsService`: add `private readonly teams: TeamsService` to the `DecisionsService` constructor and import it. Check before changing the project's counters.

#### Plan

1. `this.projects.get(...)` gives the 404 for free.
2. Load the team; not a member and not org admin: `FORBIDDEN`.
3. Trim the title; empty: `VALIDATION_ERROR`.
4. Only then increase the counters and store.

#### Almost the answer

```ts
constructor(
  private readonly ctx: LogContext,
  private readonly projects: ProjectsService,
  private readonly teams: TeamsService,   // new: Nest injects it
  private readonly access: AccessService,
  private readonly audit: AuditService,
) {}

const team = this.teams.get(project.owner, project.team);
const member = this.access.isOrgAdmin(input.actor, project.owner) || team.members.some((m) => m.user === ____);
if (!member) throw new DecisionLogError('FORBIDDEN', 'only team members create decisions', 403);
const title = input.title?.trim();
if (!title) throw ____;
```

## Common mistakes

- Returning the stored decision itself from `create`: the caller's object then changes with every later action, and step 16's "updated_at moves" check cannot see a difference.
- Increasing the counters before the checks: a refused request would still use up a number.
- Adding a collection without a migration: step 13 reports it.
- Building the id without padding (`PRJ-1`).
