# 23 · Time-based rules: veto windows and sweeps

## Goal

Veto mode: a proposal is approved automatically after `auto_approve_after_days`, unless someone vetoes it with a reason. `sweep()` is the job that applies the waiting period; the server runs it every minute.

## You'll learn

- Time arithmetic with the injected clock → `learn/concepts/dates-and-clock.md`
- Background jobs that are safe to run again (idempotent)

## Where

- `src/decision-log/decisions/decisions.service.ts` (`sweep`, `perform`)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: veto: auto-approves after the window unless blocked

#### What the test wants

With a 7-day window: a sweep after 6 days approves nothing and returns `[]`. A sweep after 7 days returns `[id]`, and the decision is `approved` with no approvers.

#### Where to look

`sweep()` in `src/decision-log/decisions/decisions.service.ts`. Go through the decisions; for proposed ones in veto mode, compare the time since `proposed_at` with the window. A day is 86 400 000 milliseconds.

#### Plan

1. For each decision in the store: skip unless `proposed`, in veto mode, with `auto_approve_after_days` set.
2. Skip if `now - proposed_at` is less than the window.
3. Approve with `approvers: []`, audit, collect the id.
4. Return the ids.

#### Almost the answer

```ts
sweep() {
  const now = this.ctx.now();
  const swept: string[] = [];
  for (const d of this.ctx.store.decisions.values()) {
    if (d.status !== 'proposed') continue;
    const settings = this.projects.get(d.project).approval_settings;
    if (settings.mode !== 'veto' || settings.auto_approve_after_days == null) continue;
    if (Date.parse(now) - Date.parse(d.proposed_at) < settings.auto_approve_after_days * ____) continue;
    d.status = 'approved'; d.approved_at = now; d.approvers = []; d.updated_at = now;
    swept.push(d.id);
  }
  return swept;
}
```

### Section: veto: a veto needs a reason and sends the decision back to draft

#### What the test wants

In veto mode, a `request_revision` vote without a reason is a `VALIDATION_ERROR`. With a reason, the decision goes back to `draft`, and its first version records the reason (`getVersions(id)[0].reason`).

#### Where to look

The vote branch: the reason check already exists (step 20). After recording, in veto mode a revision vote is a veto. Close the current version with the reason: the version lives in `revisions` under `` `${d.id}/v${d.current_revision}` ``.

#### Plan

1. After recording the vote: veto mode and `request_revision`?
2. Set the version's `outcome` (`vetoed`) and `reason`.
3. Status back to `draft`.

#### Almost the answer

```ts
if (settings.mode === 'veto' && vote === 'request_revision') {
  const version = this.ctx.store.revisions.get(`${d.id}/v${d.current_revision}`);
  Object.assign(version, { outcome: 'vetoed', reason: ____ });
  d.status = ____;
}
```

### Section: veto: a lead can still approve explicitly

#### What the test wants

In veto mode, the lead using `approve` approves straight away.

#### Where to look

Veto is not a voting mode in `mayPerform` (only consensus and quorum are), so `approve` uses `canApprove` and the single-approval path.

#### Plan

1. Check `VOTING_MODES` does not include `veto`.

#### Almost the answer

```ts
const VOTING_MODES = ['consensus_voting', 'quorum'];   // veto approves like single approval
```

### Section: veto: sweeping is idempotent

#### What the test wants

After a sweep approved a decision, sweeping again returns `[]` and the decision stays approved.

#### Where to look

Your `sweep` only looks at proposed decisions, so a second run finds nothing.

#### Plan

1. The status check at the top of the loop does this already.

#### Almost the answer

```ts
if (d.status !== ____) continue;
```

## Common mistakes

- Reading `new Date()` instead of `this.ctx.now()`: the tests move the clock.
- Sweeping drafts (a vetoed decision must not be approved later).
- Treating veto as a voting mode for the approve action.
