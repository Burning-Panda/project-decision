# 28 · Profiles and in-app notifications

## Goal

Profiles with notification preferences (defaults merged with what is stored, strictly validated), and the in-app notifications that tell people about proposals, votes and outcomes.

## You'll learn

- Defaults merged with stored values (the stored profile only holds what the person changed)
- Validating nested input and rejecting early
- Never telling people about their own actions

## Where

- `src/decision-log/profiles/profiles.service.ts` (`get`, `set`, `notify`)
- `src/decision-log/decisions/decisions.service.ts` (`perform`: notifications on propose, vote, approve, decline)
- `parseSubscription` from `src/notifications/push.ts` (step 5)
- New collection `profiles` (MAP) and a new migration

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Hints are per section. `bun run learn` shows the first one; `bun run learn hint` reveals the next, from "what the test wants" to "almost the answer".

### Section: profiles default sensibly: email derives from the user id, email is the only channel on

#### What the test wants

Bob has no stored profile: `getProfile` gives `email: bob@acme.com` (his id looks like an address), `phone: null`, no push subscriptions, and `preferences: { channels: { email: true, sms: false, push: false }, muted_types: [] }`. For a member whose id is not an address (`acme-bot`, read by the org), `email` is `null`.

#### Where to look

`get` in `ProfilesService`. A profile is stored only after someone saves one; until then you build the default on the fly. `ProfilesService` needs `AccessService` (inject it) for the permission rule in the next section. Add `profiles` to `MAP_COLLECTIONS` (keyed by user id) and a **new** migration.

#### Plan

1. A `fallback(user)` that returns the default profile object.
2. Email is the user id when it matches a simple address pattern, else `null`.
3. `get(user, actor)`: permission check (next section), then the stored profile or the fallback, as a copy.

#### Almost the answer

```ts
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

private fallback(user: string) {
  return {
    user, email: EMAIL.test(user) ? user : null, phone: null, push_subscriptions: [],
    preferences: { channels: { email: true, sms: false, push: false }, muted_types: [] },
  };
}

get(user: string, actor: string) {
  /* permission */
  return structuredClone(this.ctx.store.profiles.get(user) ?? this.____(user));
}
```

### Section: profile updates merge, validate and respect permissions

#### What the test wants

Setting a phone, enabling sms and muting `vote_received` shows in the result. A later update with only a push subscription and `push: true` keeps the phone, sms and the muted type (merge, do not replace). `phone: null` clears the phone. Ten kinds of bad input are `VALIDATION_ERROR`: a malformed email, an email with an injected header (`a@b.co\r\nBcc: evil@x.io`), a phone that is not E.164, subscriptions that are not a list / more than ten / without keys / with a non-https endpoint, an unknown channel, a non-boolean flag, `muted_types` that is not a list. Carol reading or editing bob's profile is `FORBIDDEN`; the org admin may edit it.

#### Where to look

`set` and a permission helper in `ProfilesService`. Start from the stored profile (or the fallback), change only the fields present in the input, validate each before applying, save, return a copy. For subscriptions, `parseSubscription(address)` from step 5 checks one, but it takes a **JSON string**, so give it `JSON.stringify(sub)`; it throws a plain `Error`, which you turn into a `VALIDATION_ERROR`.

#### Plan

1. `mayTouch(user, actor)`: the user themselves, or an org admin (`this.access.isOrgAdmin(actor, owner)` for an owner in `this.ctx.store.owners`). Else `FORBIDDEN`.
2. `email`: a string matching the pattern. The pattern has no `m` flag and uses `\s`, so a newline inside fails it (that is what blocks header injection).
3. `phone`: `null`, or `/^\+[1-9]\d{6,14}$/`.
4. `push_subscriptions`: an array of at most ten; every item passes `parseSubscription`.
5. `preferences.channels`: only `email`, `sms`, `push`, values boolean; merge over the stored channels. `muted_types`: an array; replace.
6. Save in `this.ctx.store.profiles` and return a copy.

#### Almost the answer

```ts
const bad = (message: string) => new DecisionLogError('VALIDATION_ERROR', message, 400);

set(user: string, actor: string, input: UpdateProfileDto) {
  if (!this.mayTouch(user, actor)) throw new DecisionLogError('FORBIDDEN', 'not your profile', 403);
  const next = structuredClone(this.ctx.store.profiles.get(user) ?? this.fallback(user));
  if (input.email !== undefined) {
    if (typeof input.email !== 'string' || !EMAIL.test(input.email)) throw bad('email is not valid');
    next.email = input.email;
  }
  if (input.phone !== undefined) {
    if (input.phone !== null && !/^\+[1-9]\d{6,14}$/.test(input.phone)) throw bad('phone must be E.164');
    next.phone = input.phone;
  }
  if (input.push_subscriptions !== undefined) {
    const subs: any = input.push_subscriptions;
    if (!Array.isArray(subs) || subs.length > ____) throw bad('push_subscriptions must be a list of at most ten');
    try { subs.forEach((s) => parseSubscription(JSON.stringify(s))); } catch { throw bad('invalid push subscription'); }
    next.push_subscriptions = subs;
  }
  const channels = input.preferences?.channels;
  if (channels !== undefined) {
    for (const [name, on] of Object.entries(channels)) {
      if (!['email', 'sms', 'push'].includes(name) || typeof on !== 'boolean') throw bad(`bad channel ${name}`);
    }
    next.preferences.channels = { ...next.preferences.channels, ...channels };
  }
  /* muted_types, then */
  this.ctx.store.profiles.set(user, next);
  return structuredClone(next);
}
```

### Section: notifications: proposing notifies the team; votes notify the owner when enabled

#### What the test wants

In consensus mode, when alice proposes, bob has a `decision_proposed` notification for the decision and alice has none. When bob votes, alice has a `vote_received` notification.

#### Where to look

`perform` in `src/decision-log/decisions/decisions.service.ts`, and the `notify` method you wrote in step 26 (it skips the person who acted). New here: the team list for propose (`this.teamOf(d).members`, the helper from step 26), and the project setting `notification_on_vote`, which is true unless switched off.

#### Plan

1. In the `propose` branch: for every team member, `this.profiles.notify(member.user, 'decision_proposed', d, actor)`. The owner is the actor, so `notify` already leaves them out.
2. In the vote branch (a vote was cast, either the `vote` action or `approve` in a voting mode): unless `settings.notification_on_vote === false`, `notify(d.owner, 'vote_received', d, actor)`.
3. Inject `ProfilesService` into `DecisionsService` (add it to the constructor).

#### Almost the answer

```ts
// propose branch
for (const m of this.teamOf(d).members) this.profiles.notify(m.user, 'decision_proposed', d, actor);

// after a vote is recorded
if (settings.notification_on_vote !== ____) this.profiles.notify(d.owner, 'vote_received', d, actor);
```

### Section: notification_on_vote=false suppresses vote notifications

#### What the test wants

With the project setting `notification_on_vote: false`, bob's vote gives alice no `vote_received` notification.

#### Where to look

The condition from the previous section. The setting is read from the project's `approval_settings` (the same object as `enabled_voting`).

#### Plan

1. Only notify when the setting is not `false`.

#### Almost the answer

```ts
const settings = this.projects.get(d.project).approval_settings;
if (settings.notification_on_vote !== false) { /* notify the owner */ }
```

### Section: notifications: the owner hears the outcome of a proposal

#### What the test wants

The lead approves alice's proposal: alice gets `decision_approved` for it, the lead does not. The lead declines it: alice gets `decision_declined`.

#### Where to look

The end of `perform`, after the branch ran. Whatever the route to `approved` (single approval or the closing vote), the owner is told once.

#### Plan

1. After the switch: if the status just became `approved` (it was not before), `notify(d.owner, 'decision_approved', d, actor)`.
2. If it is `declined`: `notify(d.owner, 'decision_declined', d, actor)`.
3. `notify` skips the actor, so a lead is never told about their own approval.

#### Almost the answer

```ts
if (d.status === 'approved' && previous !== 'approved') this.profiles.notify(d.owner, 'decision_approved', d, actor);
if (d.status === 'declined') this.profiles.notify(d.owner, ____, d, actor);
```

## Common mistakes

- Replacing the stored profile instead of merging: the second update would forget the phone.
- Calling `parseSubscription` with an object; it wants a JSON string.
- Forgetting that `notify` must skip the actor (the "alice herself is not notified" test).
- A stored profile that shares objects with what you return; return copies (`structuredClone`).
- Editing migration 1..n instead of adding a new one for `profiles`.
