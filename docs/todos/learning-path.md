# TODO: verify the learning-path step order against reference solutions

Blocked until the reference solutions exist. Do not use the deleted `backup/src` as a source.

## Solutions branch
- Branch `solutions`, one commit per step of `learn/steps.ts`, tagged with the step id (`step-03-project-record`).
- Each tag holds the smallest implementation that makes that step and every earlier step green, in the conventions of `src/`.

## `bun run learn verify`
Add to `scripts/learn.ts`. For each step N in order: check out its tag in a temporary worktree, run the step results (same junit mapping as `learn status`), and require:
- steps 1..N pass (optional steps may be skipped),
- step N+1 has at least one failing test (otherwise its tests depend on nothing new, or something leaked forward).

Report the first violation with step id and failing section. Run it in CI on the `solutions` branch.

## When it fails
Move the offending top-level section to a later step in `learn/steps.ts` (or split the spec section), then re-run. `bun run learn check` must stay green.
