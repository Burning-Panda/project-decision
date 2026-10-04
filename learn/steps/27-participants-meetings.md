# 27 · Participants and meeting notes

## Goal

Track who took part and in which role, and record meetings: a transcript from timed segments, rendered as notes in a fixed Markdown format.

## You'll learn

- Deriving roles from what people did
- Sorting by a number and formatting a duration as `HH:MM:SS`
- Building Markdown text line by line

## Where

- `src/decision-log/decisions/decisions.service.ts` (`participants`, a new `recordParticipant`)
- `src/decision-log/followups/followups.service.ts` (`addMeeting`, `renderMeetingNotes`)
- New collection `meetings` (ARRAY) and its migration. `participants` already exists from step 14.

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: participants accumulate roles and actions

#### What the test wants

Bob commented, carol voted approve, david voted `request_revision`. The owner has exactly `['owner']`. Bob is `contributor` and `reviewer`. Carol is an `approver`, david a `reviewer`. Bob has an action `{ action_type: 'commented', at }`. Separately, after the lead declines, the lead has the role `decliner`.

#### Where to look

`participants` and the places that act, in `src/decision-log/decisions/decisions.service.ts` and `CommentsService`. Step 14 already pushes `{ decision_id, user, roles: ['owner'], actions }` when a decision is created. Now every relevant action must add to the actor's entry. Careful: the test calls `log.addComment(...)` directly, not through `perform`, so the comment code itself must record the participant.

#### Plan

1. Add one public method on `DecisionsService`, `recordParticipant(d, actor, action_type, roles, at)`: find the actor's entry for this decision (or push a new one), add the roles that are not there yet, push `{ action_type, at }` on `actions`.
2. Call it from: `CommentsService.add` (`commented`, roles `contributor` and `reviewer`), the vote branch of `perform` (`voted`; `approver` for an approve vote, `reviewer` for others), and the decline branch (`declined`, `decliner`).
3. Do **not** add roles in `propose`; the owner must keep exactly `['owner']`.

#### Almost the answer

```ts
recordParticipant(d, actor: string | null, action_type: string, roles: string[], at: string) {
  if (!actor) return;
  const all = this.ctx.store.participants;
  let p = all.find((x) => x.decision_id === d.id && x.user === actor);
  if (!p) all.push((p = { decision_id: d.id, user: actor, roles: [], actions: [] }));
  for (const r of roles) if (!p.roles.includes(r)) p.roles.push(r);
  p.actions.push({ action_type, at });
}

// in the vote branch
this.recordParticipant(d, actor, 'voted', vote === 'approve' ? ['approver'] : [____], now);
```

### Section: meeting records store a transcript and render the documented notes format

#### What the test wants

Bob records a meeting (`add_meeting`): 201, `data.meeting.transcript_text` contains `Rollback worries me.`, and bob has a `recorded_meeting` action. Then `renderMeetingNotes` gives Markdown: `## Meeting Records`, a heading `### Meeting: 2024-03-21 15:00 - 00:03:10`, `**Attendees**: alice@acme.com, bob@acme.com`, `**Recording**: s3://bucket/m1.webm`, the transcript lines sorted by time as `[00:00:45] **Bob**: Rollback worries me.`, and the key takeaways as `- ` bullets.

#### Where to look

Two methods in `FollowupsService`. The input is in `test/support/fixtures.ts` (`MEETING`): the segments arrive **out of order**. `add_meeting` reaches `addMeeting` the same way `add_comment` reached `add` (a registered handler; add `add_meeting` to `ANY_STATUS`). A new `meetings` ARRAY collection holds them.

#### Plan

1. Register `add_meeting` in `FollowupsService`'s constructor (status 201, `data: { meeting }`). Add `add_meeting` to `ANY_STATUS`, `meetings` to `ARRAY_COLLECTIONS`, and a migration.
2. `addMeeting`: access check, sort the segments by `start_seconds`, build `transcript_text` as one `Speaker: text` line per segment (when no `transcript_text` was given), store the meeting, record the participant (`recorded_meeting`, role `contributor`).
3. `renderMeetingNotes`: for each meeting of the decision, print the heading (date and time from `recorded_at` in UTC, the duration as `HH:MM:SS`), attendees, recording, a blank line, the segments, then the takeaways.
4. A duration in seconds: hours = `floor(s / 3600)`, minutes = `floor(s / 60) % 60`, seconds = `s % 60`, each padded to two digits.

#### Almost the answer

```ts
const pad = (n: number) => String(n).padStart(2, '0');
const clock = (s: number) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;

const segments = [...(input.segments ?? [])].sort((a, b) => a.start_seconds - b.____);

renderMeetingNotes(id: string, actor: string) {
  this.decisions.get(id, actor);
  const lines = ['## Meeting Records'];
  for (const m of this.ctx.store.meetings.filter((x) => x.decision_id === id)) {
    const when = new Date(m.recorded_at).toISOString();          // 2024-03-21T15:00:00.000Z
    lines.push('', `### Meeting: ${when.slice(0, 10)} ${when.slice(11, 16)} - ${clock(m.duration_seconds)}`, '');
    if (m.attendees.length) lines.push(`**Attendees**: ${m.attendees.join(', ')}`);
    if (m.audio_file_url) lines.push(`**Recording**: ${m.audio_file_url}`);
    lines.push('', ...m.segments.map((s) => `[${clock(s.start_seconds)}] **${s.speaker}**: ${s.text}`));
    if (m.key_takeaways.length) lines.push('', '**Key Takeaways**', ...m.key_takeaways.map((t) => `- ${t}`));
  }
  return lines.join('\n');
}
```

### Section: meeting needs a transcript

#### What the test wants

A meeting with only `duration_seconds: 5` (no segments, no transcript text) is `VALIDATION_ERROR` 400. An outsider adding a meeting is `FORBIDDEN` 403.

#### Where to look

`addMeeting`. The outsider case is the same access check as for comments; the validation is about having *something* to store.

#### Plan

1. `this.decisions.get(id, actor)` first (the outsider gets `FORBIDDEN`).
2. If there is no non-blank `transcript_text` and no segments, throw `VALIDATION_ERROR`.

#### Almost the answer

```ts
const transcript_text = input.transcript_text?.trim() || segments.map((s) => `${s.speaker}: ${s.text}`).join('\n');
if (!____) throw new DecisionLogError('VALIDATION_ERROR', 'a meeting needs segments or a transcript', 400);
```

## Common mistakes

- Recording participants only inside `perform`: the test calls `addComment` directly and finds no entry for bob.
- Giving the owner extra roles (for example from `propose`); the test wants exactly `['owner']`.
- Forgetting to sort the segments: they arrive as 45 s, 0 s, 130 s.
- Using local time for the heading. Read the timestamp as UTC (`toISOString()`), so the test passes in every time zone.
- Adding the `meetings` collection but not a migration (the storage specs fail).
