# 00 · How a spec reads, and how the app is wired

## Goal

Nothing to write yet. Learn to read a spec: every test is GIVEN (state) > WHEN (one action) > THEN (one expectation). Read `test/http/routes.spec.ts` top to bottom, then `test/domain/parts.spec.ts`.

## You'll learn

- How a spec is laid out: `describe` blocks for GIVEN and WHEN, `it` for THEN, `beforeEach` to build state
- Why every THEN runs on freshly built state (no test depends on another)
- How the app is wired: a Nest module provides services; `DecisionLog` is the facade the specs talk to

## Where

- `test/http/routes.spec.ts`: the reference style for every spec in this repo
- `test/support/`: fixtures and helpers; `test/support/target.ts` is the only place specs import from `src/`
- `src/decision-log/decision-log.module.ts`, `src/decision-log/decision-log.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Run `bun test test/http/routes.spec.ts` and match each line of output to the describe/it that produced it.

### Hint 2

Find `runningApi()` in routes.spec: it registers a `beforeEach` and returns a handle. Most specs use this pattern (see `freshLog()` in `test/support/setup.ts`).

### Hint 3

In parts.spec, follow `buildModule()` into `test/support/target.ts`, then into `DecisionLogModule.register`. That is how every spec gets a fresh application.
