# 10 · Composing domain and service: projects

## Goal

Implement `ProjectsService`: authorise, build the record with `Project.create` (step 04), reject duplicates, store, audit.

## You'll learn

- Separating pure domain rules (Project) from the service around them
- Service composition through constructor injection

## Where

- `src/decision-log/projects/projects.service.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Order in `create`: team exists (NOT_FOUND) → actor is team admin (FORBIDDEN) → `Project.create(input, this.ctx.now())` → identifier free (CONFLICT) → store → audit.

### Hint 2

`updateSettings` uses `Project.resolveSettings(patch.approval_settings, current.approval_settings)`. If it throws, nothing is stored, which is what the spec checks.
