# Dates and the injected clock

Times are stored as ISO strings: `'2024-03-20T10:00:00.000Z'`. They sort correctly as text and survive JSON.

```ts
new Date().toISOString();            // now
'2024-03-20T10:00:00.000Z'.slice(0, 10);   // '2024-03-20', the date part
Date.parse(a) - Date.parse(b);       // milliseconds between two times
```

## Never read the real clock in services

Tests need to control time ("a draft one hour old", "after 7 days"). So services get the time from the context, which the tests replace:

```ts
const now = this.ctx.now();   // not new Date()
```

The test clock starts at `2024-03-20T10:00:00Z` and only moves when a test calls `clock.advanceHours(...)`. That is why `created_at` and `updated_at` can be compared exactly.
