# Handoff (for the next session, written for Claude to resume cold)

Written 2026-10-04 at commit `f5b5712`. Read [`SUMMARY.md`](SUMMARY.md) first for the big picture. This file is only what you need to continue.

## Owner's standing rules

- Commit after each major file change (small, focused commits). Use the attribution line from the system reminder at the time.
- Never use the deleted `backup/src` (git history before `ae08419`) as a reference or source for solutions.
- Reference solutions belong on a separate branch, written later. Do not put solutions on `main`.
- Already-implemented code (Notifier, EmailChannel, smtpTransport, routing, XUserGuard) stays as worked examples.
- Test style: `test/http/routes.spec.ts` is the reference (GIVEN/WHEN/THEN, `bun:test`, no `node:` imports, fresh state per test). Helpers live in `test/support/setup.ts` (`freshLog`, `proposedIn`, `attempt`, `expectCode`). Specs import `src/` only through `test/support/target.ts`.
- Todos are written tersely: only what is needed to do the work later.
- Do not touch the owner's running containers (`wizardly_pare` Postgres). For Postgres checks use a throwaway container on another port (I used 55432) and remove it.
- The owner edits files too. Check `git status` before editing, and never `git checkout` a file to "restore" it; that discards their uncommitted work (I did this once and had to re-apply it).

## Current state

- Branch `main`, clean tree, 72 commits. Last: `f5b5712`.
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

## Not done (in priority order)

1. **Hint ladders for steps 26–45.** Next set is level 6: 26 comments, 27 participants/meetings, 28 profiles/notifications, 29 follow-ups, 30 related decisions. Then level 7 (31–37), 8 (38–39), 9 (40–42), 10 (43–44), 11 (45, optional Postgres). Steps 00–02 keep plain hints (they are worked examples).
2. Concept explainers those levels need (sorting/paging, edit distance, HMAC and AES-GCM, retries/backoff, concurrency guards, SSRF).
3. Solutions branch + `bun run learn verify` (see the todo). Needs the owner to say when.
4. Open question to the owner: `501` instead of `500` for endpoints that hit unwritten code.

## How to do the next set (the method that worked)

The hints must be true, so each set is playtested before it is committed.

1. **Scratch reference.** It lives in the session scratchpad (`.../scratchpad/ref/`, built by `ref_apply.py` and `ref_decisions.ts`) and covers levels 1–5. It is **not in the repo and may be gone**. If so, rebuild it from the specs: the code is small, and levels 1–5 took one session. Extend it for the new level, from the specs (and the README's behaviour notes), not from `backup/src`.
2. **Throwaway worktree.** `git worktree add --detach <scratch>/wt HEAD`, symlink `node_modules`, copy the reference `src/` over it, run `bun run learn status` there. Fix the reference until the new steps pass. Remove the worktree when done (`git worktree remove --force`, `git worktree prune`). Never leave reference code on `main`.
3. **If a spec is wrong** (it contradicts the README or another spec), fix the spec and commit it separately. If the hint approach hits a real gap, put the fix in the brief's skeleton, the step's "Common mistakes", and, if it is a recognisable failure shape, a rule in `diagnose()` in `scripts/learn.ts`.
4. **Write the briefs** with a generator script (pattern: `briefs3.py` in the scratchpad). Format per step: `## Goal`, `## You'll learn`, `## Where`, `## Hints`, `## Common mistakes`. Under `## Hints`, one `### Section: <exact top-level describe title>` per spec section, each with four `#### ` rungs: *What the test wants*, *Where to look*, *Plan*, *Almost the answer* (code with `____` blanks, never the whole answer). `bun run learn check` fails if a section title is wrong.
5. `bun run learn check`, `bun test` (numbers unchanged), commit.

## Behaviour the hints assume (keep consistent)

- Votes live on the decision as `d.votes` (`{ user, vote, comment, revision, at }`); `vote_tally` is counted from them (head counts, even with weights).
- Consensus: approved when approve + revision votes ≥ `consensus_min_votes` **and** approve share ≥ threshold (abstentions excluded). In `consensus_voting` and `quorum` the `approve` action is a vote (202); `request_revision` as an action is not a vote (201, back to draft).
- `perform` checks in this order: unknown action (400), permission (403), state (409), then the action's own validation (400). `create` returns a copy (`structuredClone`) of the stored decision.
- Team keys are `owner/team`; versions are `revisions` entries keyed `decision-id/vN`; every new collection needs an entry in `src/storage/store.ts` and a SQLite migration (migration 1 lists its tables by name on purpose).
- Related finder: cosine similarity of word counts, stop words removed, score × 100, threshold 60 (README and step 30 agree).
- `AuditService.record` starts as a plain append (level 2) and becomes a hash chain in step 31.

## Pitfalls I hit

- `git checkout <file>` discards the owner's uncommitted edits.
- `pkill -f "bun dist/main.js"` also matches the shell running it; stop servers by PID.
- `bun test` run from inside `src/` fails (no tsconfig, decorators break); run from the repo root.
- Passing several spec paths through a shell variable fails; pass them as separate arguments.
- A spec section added to any file must also be added to a step in `learn/steps.ts`, or `learn check` (and CI) fails.
- `.learn/` (runner progress) is gitignored; delete it to see the new-learner experience.
- Server tests are `*.test.ts` on purpose (outside the learning-path scan).
