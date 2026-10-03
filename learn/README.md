# Learning path

You build a decision-log application by making its specs pass, one small step at a time, easiest first. The specs already describe every behaviour; the code in `src/` is mostly stubs that throw `NotImplementedError`. Your job is to replace them.

## The loop

```
bun run learn
```

It runs every spec once, finds the first step that is not finished, and shows you that step's first failing test. Read the step's brief (`learn/steps/NN-*.md`), write the smallest code that makes the test pass, and run `bun run learn` again. When the step is green it tells you so and shows the next one. That is the whole workflow: red, write code, green, next.

| Command | What it does |
|---|---|
| `bun run learn` | The current step and its first failing test |
| `bun run learn hint` | Reveals the next hint for the current step (they get more specific) |
| `bun run learn status` | Progress for every level and step |
| `bun run learn step <n>` | Runs one step (by number or id) and shows all of its failures |
| `bun run learn list` | Every step, in order |

If something you change breaks an earlier step, `bun run learn` says so and sends you back there first.

## When you are stuck

1. Read the failing test's name: GIVEN (the state) > WHEN (the action) > THEN (what must be true).
2. Read the "What this usually means" note under the failure.
3. Run `bun run learn hint`, more than once if needed. Hints go from "what the test wants" to "where to look", "a plan" and finally "almost the answer" (code with blanks).
4. Read the concept the brief links to. `learn/concepts/` explains the ideas the steps use, in plain words with small examples:
   reading test output, HTTP, errors, objects and copies, regex, JSON, async/await, Maps/arrays/records, classes, services and dependency injection, dates and the clock, SQL and migrations, hashing, state machines, permissions, comparing fractions, and a glossary of the domain words.

## Rules of the house

- **Do not edit the specs** in `test/`. They are the requirements. If you think one is wrong, ask.
- **Smallest change that passes.** Later steps will ask for more; that is where you refactor.
- **Read the test names.** Each test reads as GIVEN (the state) > WHEN (one action) > THEN (what must be true). The failure message tells you which.
- **Errors are values with a code.** Domain rules throw `DecisionLogError(code, message, status)` from `src/common/errors.ts`, for example `VALIDATION_ERROR` 400, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409.
- **Adding data means adding a collection.** When a step needs a new kind of record, add its name to the lists in `src/storage/store.ts` and add a migration in `src/storage/migrations/sqlite.ts`. `test/storage/collections.spec.ts` fails until every collection round-trips.
- **Changing stored data means a data migration.** When an existing record changes shape, add an upgrade to `src/storage/data-migrations.ts` (from step 36 on).
- **Records and formatters.** Each feature keeps a typed record (like `ProjectRecord`) for what is stored, and turns it into the API response in one place. That is where fields such as secrets are left out.

## Levels

0. Orientation: worked examples. Already passing; read them to see how specs and code fit.
1. First code: pure functions.
2. State, errors and permissions.
3. Persistence: JSON snapshots, SQLite, schema migrations.
4. The decision lifecycle: a state machine.
5. Rules and algorithms: voting, quorum, veto, revisions, diff.
6. Features that build on each other: comments, notifications, follow-ups, related decisions.
7. Integrity and evolving data: hash chains, idempotency, encryption, webhooks, data migrations.
8. Queries: filtering, paging, search, reports.
9. The HTTP API.
10. Async work and the network: webhook and notification delivery.
11. Production database (optional, needs PostgreSQL).

## Setup

```
bun install
bun run learn
```

Level 11 needs a PostgreSQL server: set `TEST_DATABASE_URL` (see `docs/POSTGRES.md`). Without it that step is reported as skipped.
