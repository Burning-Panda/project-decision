# 22 · Quorum, majorities and weighted votes

## Goal

Quorum mode: enough of the eligible voters must vote (turnout), then a majority decides, optionally weighted by role.

## You'll learn

- Turnout vs majority
- Weighted sums
- Comparing fractions exactly (2/3)

## Where

- `src/decision-log/decisions/decisions.service.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Eligible voters: team members except the owner. Turnout = weight of voters / weight of all eligible.

### Hint 2

Majority types: `simple` (more than half, a tie is not a majority), `2_3_majority`, `3_4_majority`. Compare `approve * den >= total * num` to avoid floating point surprises.

### Hint 3

Weights change the arithmetic, not the tally: `vote_tally` still counts heads.
