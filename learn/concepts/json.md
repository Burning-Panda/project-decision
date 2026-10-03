# JSON

JSON is text that describes data: objects, arrays, strings, numbers, booleans and `null`.

```ts
JSON.stringify({ id: 'PRJ-001', tags: ['db'] });   // '{"id":"PRJ-001","tags":["db"]}'
JSON.parse('{"id":"PRJ-001"}');                     // { id: 'PRJ-001' }
```

- `JSON.parse` **throws** when the text is not valid JSON. Wrap it in `try/catch` when the text comes from outside.
- Only plain data survives: a `Map` becomes `{}`, a `Date` becomes a string, `undefined` and functions disappear, a `BigInt` makes `stringify` throw.
- So before storing or sending data, turn special types into plain ones: `Object.fromEntries(map)` for a Map, and `new Map(Object.entries(obj))` to get it back.

`JSON.parse(JSON.stringify(x))` is a quick way to see exactly what would survive storing `x`.
