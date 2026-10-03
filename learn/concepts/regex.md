# Regular expressions

A regular expression ("regex") describes a pattern of text. In TypeScript it is written between slashes:

```ts
/^[A-Za-z][A-Za-z0-9]*$/.test('PRJ');    // true
/^[A-Za-z][A-Za-z0-9]*$/.test('1PRJ');   // false: must start with a letter
```

| Piece | Means |
|---|---|
| `^` and `$` | start and end of the text (without them, a match anywhere counts) |
| `[A-Za-z]` | one letter |
| `[0-9]` or `\d` | one digit |
| `*` | the previous piece, zero or more times |
| `+` | the previous piece, one or more times |
| `{64}` | exactly 64 times |
| `.` | any character (`\.` is a literal dot) |

`text.match(/(\w+)@/)` returns the parts in parentheses (`match[1]`). Tests in this repo often use `toMatch(/.../)` to check rendered text: read the pattern piece by piece and compare with what you produced.
