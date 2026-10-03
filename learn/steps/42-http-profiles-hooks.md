# 42 · Profiles, the UI contract and write hooks

## Goal

Profiles over HTTP, the UI's endpoints, the write hook and input rejected at the boundary.

## You'll learn

- Durable before acknowledged (`onMutation`)
- Never leaking internal errors

## Where

- `src/profile/`
- `src/api/`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

`?user=` lets an admin read or edit someone else's profile; others get 403.

### Hint 2

A NUL character in a JSON body is INVALID_JSON, because PostgreSQL cannot store it.
