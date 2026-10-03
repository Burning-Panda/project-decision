# Errors and `throw`

When code finds something wrong it **throws** an error. Throwing stops the function immediately; the error travels up to whoever called it, until something **catches** it.

```ts
function divide(a: number, b: number) {
  if (b === 0) throw new Error('cannot divide by zero');
  return a / b;
}

try {
  divide(1, 0);
} catch (e) {
  console.log((e as Error).message);   // "cannot divide by zero"
}
```

## Errors with a code: `DecisionLogError`

In this project domain rules throw `DecisionLogError(code, message, status)` from `src/common/errors.ts`:

```ts
import { DecisionLogError } from '../../common/errors';

throw new DecisionLogError('VALIDATION_ERROR', 'title is required', 400);
```

The **code** is what tests and clients check; the **status** is the HTTP status the API answers with; the **message** is for humans. The common ones:

| Code | Status | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | The input is wrong (missing, empty, unknown value) |
| `FORBIDDEN` | 403 | The caller may not do this |
| `NOT_FOUND` | 404 | The thing does not exist |
| `CONFLICT` | 409 | It already exists |
| `INVALID_STATE` | 409 | Not allowed in the current state |

## Order matters

When several things are wrong, the **first** check that fails decides the error. Tests often expect a specific order, for example "does it exist?" (404) before "may you?" (403) before "is the input valid?" (400). If a test gets a different code than expected, look at the order of your checks.

## The placeholder error

Every unfinished function throws `NotImplementedError`. Replacing that `throw` with real code is your job in each step.
