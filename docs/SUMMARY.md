# Project summary (plain terms)

Written 2026-10-04. Companion: [`HANDOFF.md`](HANDOFF.md) (how to continue the work).

## What this project is

A **decision log**: a web service that records team decisions, lets people approve them (single approver, consensus voting, quorum, or veto), keeps every version, and keeps a tamper-evident audit trail. It is built with NestJS on Bun.

It is also a **teaching repo**: most of the code is deliberately missing (stubs that throw `NotImplementedError`). The tests describe the finished behaviour, and a guided path (`bun run learn`) walks a learner through writing the code, easiest first.

## Where things stand

- 789 tests in 29 spec files; 143 pass. The rest fail only because the code is not written yet. That is intended.
- The server starts (`bun run start`), runs in memory, serves the web UI and Swagger. Endpoints that call unwritten code answer `500`.
- The learning path has 46 steps in 12 levels. Steps 03–25 have full, tested hints. Steps 26–45 have older, simpler hints.

## Done

**Test quality**
- [x] Reviewed every test: correctness, what they cover, organisation.
- [x] Converted all specs to one style: GIVEN (state) > WHEN (one action) > THEN (only checks).
- [x] Moved specs into feature folders (`test/domain`, `decisions`, `webhooks`, `notifications`, `storage`, `http`).
- [x] Fixed wrong or weak tests (a sort test that could not fail, a search test that contradicted another, vague `> 0` checks, a consensus-threshold test that closed too early).
- [x] Removed duplicated checks and dead code (Nest boilerplate tests, unused vitest setup, half of the fake SMTP server, an obsolete parity script).
- [x] Added ~60 tests for gaps: nine HTTP routes with no behaviour test, permission rules with no negative case, edge cases.
- [x] Fixed three places where the code stubs and the tests disagreed.
- [x] Added a coverage rule: `bun run test:cov` fails below 90% of `src/`.

**Persistence (made learnable early)**
- [x] Storage collections start small and grow with each feature; one test checks every collection survives every store.
- [x] SQLite now matches PostgreSQL: one table per collection, numbered migrations that are recorded.
- [x] "Data migrations": ordered upgrades for already-stored data, applied once, with their own tests.

**Server**
- [x] `src/main.ts` now builds the real app: config checks, storage choice, background jobs (auto-approval every minute, webhook delivery, email delivery, pruning), safe shutdown.
- [x] Build fixed for Bun (`module: esnext`); scripts run under Bun.
- [x] UI folder found relative to the code, not the working directory.
- [x] README, `.env.example` and docs brought up to date.

**Learning path**
- [x] Runner `bun run learn`: shows the first failing test of the first unfinished step, explains common failures in plain words, shows section progress, `hint`, `status`, `step`, `list`, `check`.
- [x] 46 steps cover every test section; `bun run learn check` also runs in CI.
- [x] Four-rung hints per test section (what it wants, where to look, a plan, a skeleton with blanks) for steps 03–25.
- [x] 16 short concept explainers in `learn/concepts/` plus a glossary.
- [x] Steps 03–25 were played through against a scratch implementation, which found two real problems (both fixed).

## Not done

- [ ] Four-rung hints for steps **26–45** (levels 6–11). Next up: level 6 (steps 26–30).
- [ ] More concept explainers for later levels (sorting and paging, fuzzy matching, signing with HMAC, encryption, retries, concurrency, private-address blocking).
- [ ] The **solutions branch** (one commit per step) and `learn verify`, which proves the step order works. See `docs/todos/learning-path.md`. Not to be built from the deleted `backup/src`.
- [ ] A test run with real beginners (the best way to find missing hints).
- [ ] All the unwritten application code (that is the learner's job, by design).
- [ ] The PostgreSQL tests need a reachable database. `.env` points at `decisions_test`, which did not exist at the last check.

## Open questions for the owner

- Should an endpoint hitting unwritten code answer `501 Not Implemented` instead of `500`? It would help learners, but changes what the HTTP tests see.
- The README mentions SMS/push UI and audio recording as "not built yet"; they are out of scope for the path.

## Choices made, and why

**Tests**
- *Nested GIVEN/WHEN/THEN, one action per WHEN.* You asked for it; test output then reads like a sentence and every test starts from fresh state.
- *Ambiguous behaviour was decided by you:* ids in search are fuzzy but an exact match ranks first; in consensus mode the `request_revision` action sends the decision back to draft and is not a vote.
- *Behaviour I chose where the code was silent (easy to change):* only leads or admins decline, in every mode; only a comment's author or the decision owner resolves it; export is admin-only and json/csv only; a reused idempotency key with a different body is a `409 CONFLICT`; the edit window includes minute five; the owner is told when a decision is approved or declined; votes are advisory when single approval has voting switched on.
- *Spec fixes follow the README's written rules.* The README says consensus needs enough votes **and** enough approval share, so the threshold test was wrong, not the rule.

**Server and build**
- *Bun, not Node.* The code already uses Bun APIs and imports without `.js`, which Node cannot load. So `module: esnext` + `bundler`, and `start` scripts use `--exec bun`.
- *Memory by default; secrets key only needed when persisting.* A new learner can start the app with zero setup; nothing outlives the process in memory.
- *Refuse bad configuration up front* (two storage options, persisting without a key) instead of failing later.
- *A job that hits unwritten code is logged once,* so the console is not flooded while learners work.

**Persistence**
- *Collections list grows per feature; migration 1 names its tables explicitly.* If migration 1 were computed from the list, it would change meaning when the list grows, and existing databases would never get the new tables.
- *SQLite first, PostgreSQL last and optional.* SQLite needs no server; PostgreSQL adds locking and connection loss, which is harder material.
- *SQLite code is synchronous (`bun:sqlite`),* because the tests call `open` and `commit` without `await`. This is an exception to the repo's "use Bun.SQL" rule.
- *Data migrations are their own mechanism* so "change the shape of stored data" becomes a lesson, not a special case.

**Learning path**
- *Progress is computed from test results, never stored.* It cannot get out of sync. A small `.learn/` file only remembers the furthest step and which hints were shown.
- *Steps are made of whole top-level test sections,* so each step has a clear goal and the runner can map results exactly.
- *Already-implemented code stays as worked examples* (Notifier, email channel, routing), as you decided.
- *Reference solutions go on a separate branch, written later,* and never from `backup/src`, as you decided.
- *Hints per section on a four-rung ladder,* because a beginner stuck on one test should not read advice for the whole step, and should be able to stop at the rung that unblocks them.
- *Related-decision finder: cosine similarity over word counts with stop words removed.* It passes the tests with a wide margin (98 vs 0), handles repetition and text length better than simple word overlap, and is the same maths used later for embeddings.
- *Playtesting with a scratch implementation in a throwaway git worktree,* kept out of the repo (in `/home/admin/work/project-decision-dev/`, its own small git repo) so it does not pre-empt the solutions branch and survives between sessions.
- *Server tests are `*.test.ts`,* so the learning-path check (which scans `*.spec.ts`) ignores them.
