# 28 · Profiles and in-app notifications

## Goal

Profiles with notification preferences, and in-app notifications for proposals, votes and outcomes.

## You'll learn

- Defaults merged with stored preferences
- Validating nested input
- Not notifying the person who acted

## Where

- `src/decision-log/profiles/profiles.service.ts`
- `src/decision-log/decisions/decisions.service.ts`
- New collection `profiles` (MAP)

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

A missing profile is a default: email derived from the id when it looks like an address, only the email channel on.

### Hint 2

Merge updates over the stored profile; validate email, E.164 phone, subscriptions (reuse `parseSubscription`) and channel names.

### Hint 3

Proposing notifies the team except the owner; votes notify the owner unless `notification_on_vote` is false; approve/decline notify the owner.
