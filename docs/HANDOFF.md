# Handoff (for the next session, written for Claude to resume cold)

Written 2026-10-04, updated after level 6 (hints for steps 03–30). Read [`SUMMARY.md`](SUMMARY.md) first for the big picture. This file is only what you need to continue.

## Owner's standing rules

- Commit after each major file change (small, focused commits). Use the attribution line from the system reminder at the time.
- Never use the deleted `backup/src` (git history before `ae08419`) as a reference or source for solutions.
- Reference solutions belong on a separate branch, written later. Do not put solutions on `main`.
- My scratch reference and playtest tools live **outside the repo**, in `/home/admin/work/project-decision-dev/` (its own git repo; see its README). Never copy that code into this repo.
- Already-implemented code (Notifier, EmailChannel, smtpTransport, routing, XUserGuard) stays as worked examples.
- Test style: `test/http/routes.spec.ts` is the reference (GIVEN/WHEN/THEN, `bun:test`, no `node:` imports, fresh state per test). Helpers live in `test/support/setup.ts` (`freshLog`, `proposedIn`, `attempt`, `expectCode`). Specs import `src/` only through `test/support/target.ts`.
- Todos are written tersely: only what is needed to do the work later.
- Do not touch the owner's running containers (`wizardly_pare` Postgres). For Postgres checks use a throwaway container on another port (I used 55432) and remove it.
- The owner edits files too. Check `git status` before editing, and never `git checkout` a file to "restore" it; that discards their uncommitted work (I did this once and had to re-apply it).

## Current state

- Branch `main`, clean tree. Last work: level 6 hint ladders (steps 26–30).
- `bun test`: 789 tests, 143 pass, 646 fail (unwritten code, plus Postgres if no database). `bun run learn check` passes (46 steps, every spec section covered).
- Step 03 (`src/ui/ui.controller.ts`, `@Get('app')` should be `@Get('app.js')`) is an **intentional** bug for learners. Leave it.
- Postgres tests: `.env` sets `TEST_DATABASE_URL` to `decisions_test`, which did not exist at the last check (the owner said it was resolved earlier; re-verify before relying on it).

## What was built (where to find it)

| Thing | Where |
|---|---|
| Learning-path steps (ordered, every spec section in one step) | `learn/steps.ts` |
| Runner (`bun run learn`, `status`, `hint`, `step`, `list`, `check`) | `scripts/learn.ts` |
| Step briefs (goal, concepts, files, hint ladders) | `learn/steps/NN-*.md` |
| Concept explainers and glossary | `learn/concepts/*.md` |
| Learner guide | `learn/README.md` |
| Server composition | `src/main.ts`, `src/server/{config,storage,jobs}.ts`; tests `test/server/*.test.ts` |
| Storage contract | `src/storage/store.ts` (collection lists), `migrations/sqlite.ts`, `data-migrations.ts` |
| Remaining todo | `docs/todos/learning-path.md` (solutions branch + `learn verify`) |
| Scratch reference + playtest tools (outside the repo) | `/home/admin/work/project-decision-dev/` |

## Not done (in priority order)

1. **Hint ladders for steps 31–45.** Next set is level 7: 31 audit chain, 32 idempotency, 33 secret box, 34 webhook registry, 35 events/outbox, 36 data migrations, 37 persisting the log. Then 8 (38–39), 9 (40–42), 10 (43–44), 11 (45, optional Postgres). Steps 00–02 keep plain hints (they are worked examples).
2. Concept explainers those levels need (sorting/paging, edit distance, HMAC and AES-GCM, retries/backoff, concurrency guards, SSRF).
3. Solutions branch + `bun run learn verify` (see the todo). Needs the owner to say when.
4. Open question to the owner: `501` instead of `500` for endpoints that hit unwritten code.

## How to do the next set (the method that worked)

The hints must be true, so each set is playtested before it is committed.

1. **Scratch reference.** `/home/admin/work/project-decision-dev/reference/src/` covers levels 1–6 (steps 03–30). Extend it for the new level, from the specs and the README's behaviour notes, never from `backup/src`.
2. **Playtest.** `/home/admin/work/project-decision-dev/tools/playtest.sh` builds a throwaway worktree of HEAD, lays the reference over it, copies the repo's current `test/`, `learn/`, `scripts/`, and runs `bun run learn status` (or `playtest.sh step 26`). Fix the reference until the new steps pass, then `playtest.sh clean`. Commit the extended reference in the dev repo. Never leave reference code on `main`.
3. **If a spec is wrong** (it contradicts the README or another spec), fix the spec and commit it separately. If the hint approach hits a real gap, put the fix in the brief's skeleton, the step's "Common mistakes", and, if it is a recognisable failure shape, a rule in `diagnose()` in `scripts/learn.ts`.
4. **Write the briefs** with `/home/admin/work/project-decision-dev/tools/brief_writer.py` (example use: `history/briefs3.py` there; do not re-run the history scripts, they overwrite hand edits). Format per step: `## Goal`, `## You'll learn`, `## Where`, `## Hints`, `## Common mistakes`. Under `## Hints`, one `### Section: <exact top-level describe title>` per spec section, each with four `#### ` rungs: *What the test wants*, *Where to look*, *Plan*, *Almost the answer* (code with `____` blanks, never the whole answer). `bun run learn check` fails if a section title is wrong.
5. `bun run learn check`, `bun test` (numbers unchanged), commit.

## Behaviour the hints assume (keep consistent)

- Votes live on the decision as `d.votes` (`{ user, vote, comment, revision, at }`); `vote_tally` is counted from them (head counts, even with weights).
- Consensus: approved when approve + revision votes ≥ `consensus_min_votes` **and** approve share ≥ threshold (abstentions excluded). In `consensus_voting` and `quorum` the `approve` action is a vote (202); `request_revision` as an action is not a vote (201, back to draft).
- `perform` checks in this order: unknown action (400), permission (403), state (409), then the action's own validation (400). `create` returns a copy (`structuredClone`) of the stored decision.
- Team keys are `owner/team`; versions are `revisions` entries keyed `decision-id/vN`; every new collection needs an entry in `src/storage/store.ts` and a SQLite migration (migration 1 lists its tables by name on purpose).
- Related finder: cosine similarity of word counts, stop words removed, score × 100, threshold 60 (README and step 30 agree).
- `DecisionsService` cannot depend on the services that depend on it. Step 26 teaches `handle(action, fn)` (a registry that `perform`'s default branch uses for `add_comment`, `assign_followup`, `add_meeting`; the three join `ANY_STATUS`, allowed in every state) and step 30 `onSave(listener)` (called after create, draft save and propose; `RelatedService` listens). Later steps should reuse these names.
- Public helpers on `DecisionsService` the hints rely on: `teamOf(d)` (the team), `recordParticipant(d, actor, action_type, roles, at)`; `ProfilesService.notify(user, type, decision, actor, extra)` skips `user === actor`. `getDecision` returns the stored decision plus `followups` (derived from the `followups` collection).
- Participants are recorded inside `CommentsService.add` / `FollowupsService.addMeeting` / the vote and decline branches, not generically in `perform` (the specs call `addComment` directly).
- New collections by step: 26 `comments`, `notifications`; 27 `meetings`; 28 `profiles` (MAP); 29 `followups`; 30 `relationships`. Each needs a store entry and a new SQLite migration.
- Todo `overdue` is derived on read (`due_date < ctx.now().slice(0, 10)`, never for `completed`); `listTodos` slices after filtering and sorting, `total` before the slice.
- `AuditService.record` starts as a plain append (level 2) and becomes a hash chain in step 31.

## Pitfalls I hit

- `git checkout <file>` discards the owner's uncommitted edits.
- `pkill -f "bun dist/main.js"` also matches the shell running it; stop servers by PID.
- `bun test` run from inside `src/` fails (no tsconfig, decorators break); run from the repo root.
- Passing several spec paths through a shell variable fails; pass them as separate arguments.
- A spec section added to any file must also be added to a step in `learn/steps.ts`, or `learn check` (and CI) fails.
- `.learn/` (runner progress) is gitignored; delete it to see the new-learner experience.
- Server tests are `*.test.ts` on purpose (outside the learning-path scan).
- Re-running a brief generator overwrites hand edits (briefs 03, 14, 16, 17 were edited after generation).
