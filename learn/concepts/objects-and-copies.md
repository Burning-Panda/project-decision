# Objects, spreading and copies

An object groups named values:

```ts
const project = { identifier: 'PRJ', title: 'Platform', active: true };
project.title;            // 'Platform'
project['title'];         // the same, with a computed name
```

## Defaults with `??`

`a ?? b` gives `a`, unless `a` is `null` or `undefined`; then it gives `b`:

```ts
const team = input.team ?? 'default';
```

## Spreading: building a new object from others

```ts
const defaults = { mode: 'single_approval', allow_abstain: true };
const patch = { mode: 'consensus_voting' };
const merged = { ...defaults, ...patch };   // { mode: 'consensus_voting', allow_abstain: true }
```

Later keys win. Spreading creates a **new** object; `defaults` and `patch` are unchanged.

## References: the same object vs a copy

Objects are passed around by reference. Two variables can point at one object, and changing it through one changes it for both:

```ts
const a = { name: 'Acme' };
const b = a;          // the same object
b.name = 'Changed';
a.name;               // 'Changed'
```

To get an independent copy, including nested objects, use `structuredClone`:

```ts
const copy = structuredClone(a);
copy.name = 'Other';  // a is not affected
```

## Mutating vs returning new values

"Do not mutate the input" means: do not assign into objects you were given (`current.mode = ...`). Build a new object instead (`{ ...current, mode }`). Tests check this, because callers may still be using the original.
