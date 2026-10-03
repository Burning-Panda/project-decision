# Reading test output

Every failure bun prints has the same parts. Learn to read them once and every step gets easier.

```
114 |       describe(`WHEN GET ${path}`, () => {          ← the spec source around the failing line
119 |           expect(res.status).toBe(status);
                                   ^                       ← the exact expectation that failed
error: expect(received).toBe(expected)                     ← which check: toBe, toEqual, toThrow, ...

Expected: 200                                              ← what the test wanted
Received: 404                                              ← what your code produced

      at <anonymous> (test/http/routes.spec.ts:119:30)     ← file:line:column of the failing check
(fail) the web UI assets ... > GIVEN no credentials > WHEN GET /app.js > THEN 200 with javascript
```

The last line is the test's full name: **GIVEN** (the state that was built) > **WHEN** (the one action) > **THEN** (what must be true). Read it as a sentence; it tells you what the code should do.

## Common shapes

- `Expected: X / Received: Y`: a value was different. Find where your code produces `Y`.
- `- Expected` / `+ Received` with a list of lines: an object or array differed. Only the lines marked `-` and `+` differ.
- `NotImplementedError: Something`: the code still throws its placeholder. Open the file and replace the `throw`.
- `expected error FORBIDDEN but nothing was thrown`: your code allowed something the test expects to be refused.
- `undefined is not an object (evaluating 'a.b')`: `a` is `undefined`, so `.b` cannot be read.
- A stack trace with `at …` lines: the top lines that point into `src/` are your code; start there.

`bun run learn` adds a short "What this usually means" note under the failure for these cases.
