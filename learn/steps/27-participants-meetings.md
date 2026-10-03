# 27 · Participants and meeting notes

## Goal

Track who took part in what role, and record meetings with transcripts rendered as notes.

## You'll learn

- Deriving roles from actions
- Sorting and formatting durations

## Where

- `src/decision-log/decisions/decisions.service.ts` (`participants`)
- `src/decision-log/followups/followups.service.ts` (`addMeeting`, `renderMeetingNotes`)
- New collection `meetings` (ARRAY)

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Each action adds `{ action_type, at }` to the actor's participant entry and a role (commented → contributor and reviewer, approve vote → approver, decline → decliner).

### Hint 2

Sort segments by `start_seconds` and format as `[HH:MM:SS] **Speaker**: text`; duration 190 s is `00:03:10`.
