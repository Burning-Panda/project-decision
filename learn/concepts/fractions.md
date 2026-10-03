# Comparing fractions

Voting rules compare shares: "at least 80% approve", "two thirds", "more than half".

## Decimals are not exact

Computers store most decimals approximately:

```ts
0.1 + 0.2 === 0.3;     // false (it is 0.30000000000000004)
2 / 3;                 // 0.6666666666666666
```

So `approve / total >= 2 / 3` can come out wrong exactly at the boundary.

## Multiply instead of dividing

Move the division to the other side and compare whole numbers:

```ts
// approve / total >= 2 / 3        becomes
approve * 3 >= total * 2           // exact

// approve / total > 1 / 2  ("more than half")
approve * 2 > total
```

With weights the numbers are still whole numbers (sums of 1s and 3s), so this stays exact.

## "At least" vs "more than"

- "At least two thirds": `>=`. Two of three votes passes.
- "More than half" (a simple majority): `>`. One of two votes is a tie, and a tie is not a majority.

Read the requirement's words carefully; the boundary case is usually what a test checks.
