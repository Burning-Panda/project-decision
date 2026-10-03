# State machines

A decision is always in exactly one **state**: `draft`, `proposed`, `approved` or `declined`. **Actions** move it between states, and each action is only allowed in some states.

```
draft ──propose──► proposed ──approve──► approved
  ▲                    │
  └──return_to_draft── declined ◄──decline──┘
```

Write the rules as data, then use the data everywhere:

```ts
const ALLOWED: Record<string, string[]> = {
  draft: ['propose'],
  proposed: ['approve', 'decline'],
  approved: [],
  declined: ['return_to_draft'],
};

if (!ALLOWED[decision.status].includes(action)) {
  throw new DecisionLogError('INVALID_STATE', `cannot ${action} a ${decision.status} decision`, 409, {
    current_state: decision.status,
    allowed_actions: ALLOWED[decision.status],
  });
}
```

Because the table lists what *is* allowed, the same data produces a helpful error: "you cannot approve a draft; you can propose it".
