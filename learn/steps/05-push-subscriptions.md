# 05 · Parsing and validating input

## Goal

Implement `parseSubscription`: turn the JSON string a browser sends into a typed subscription, or throw when it is not one.

## You'll learn

- Parsing untrusted input
- Narrowing `unknown` to a type with checks
- Error messages that say what is wrong

## Where

- `src/notifications/push.ts`

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

`JSON.parse` throws on invalid JSON; catch it and throw `Invalid push subscription: …` instead.

### Hint 2

Check that `endpoint` is a string starting with `https://` and that `keys.p256dh` and `keys.auth` are strings.
