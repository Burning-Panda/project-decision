# 05 · Parsing and validating input

## Goal

Implement `parseSubscription`: turn the JSON text a browser sends into a typed subscription, or throw when it is not one.

## You'll learn

- Parsing text from outside → `learn/concepts/json.md`
- Checking a value's shape before trusting it
- Error messages that say what is wrong → `learn/concepts/errors.md`

## Where

- `src/notifications/push.ts` (`parseSubscription` and the `PushSubscription` interface)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: parseSubscription accepts a browser subscription and rejects anything else

#### What the test wants

A valid subscription string comes back as an object equal to the original (endpoint, `expirationTime`, both keys). Text that is not JSON, a subscription without keys, and an endpoint that is not `https` must each throw an error whose message contains "Invalid push subscription".

#### Where to look

`parseSubscription` in `src/notifications/push.ts`. `JSON.parse` throws on bad text, so catch that and throw your own error instead.

#### Plan

1. `JSON.parse` the text inside `try/catch`; on failure throw `Invalid push subscription: not JSON`.
2. Check `endpoint` is a string starting with `https://`.
3. Check `keys.p256dh` and `keys.auth` are both strings.
4. Return `{ endpoint, expirationTime, keys: { p256dh, auth } }`, with `expirationTime` defaulting to `null`.

#### Almost the answer

```ts
export const parseSubscription = (address: string): PushSubscription => {
  const invalid = (why: string) => new Error(`Invalid push subscription: ${why}`);
  let value: any;
  try { value = JSON.parse(address); } catch { throw invalid('not JSON'); }
  if (typeof value?.endpoint !== 'string' || !value.endpoint.startsWith(____)) throw invalid('the endpoint must be https');
  if (typeof value.keys?.p256dh !== 'string' || ____) throw invalid('keys are missing');
  return { endpoint: value.endpoint, expirationTime: value.expirationTime ?? null, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
};
```

## Common mistakes

- Letting `JSON.parse`'s own error escape: its message does not say "Invalid push subscription".
- Returning the string instead of the parsed object.
