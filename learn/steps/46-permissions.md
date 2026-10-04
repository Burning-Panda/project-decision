# 46 · Permission-based checks: roles as bundles

## Goal

Stop asking "is this person a lead?" and start asking "may this person approve?". Roles become named bundles of permissions, and code only ever checks a permission.

## You'll learn

- Role-based vs permission-based access → `learn/concepts/authorization-models.md`
- Default deny for unknown roles and for people with no role
- Rules as data (a table), the way the state machine's `ALLOWED` table is data → `learn/concepts/state-machines.md`

## Where

- `src/decision-log/core/permissions.ts`

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

Read the first spec section: it lists the three bundles. A `member` reads, creates and votes. A `lead` can do all that and also approve and decline. An `admin` can do all that and also manage team members.

### Hint 2

Write the bundles as a `Record<TeamRole, readonly Permission[]>`, and build the larger bundles from the smaller ones (`[...MEMBER, 'decision:approve', ...]`) so the nesting spec cannot drift.

### Hint 3

`hasPermission(null, p)` and `hasPermission('superuser', p)` must be `false` and must not throw. What does indexing the table with an unknown key give you?

## Common mistakes

- Looking a role up with `table[role].includes(...)` without a fallback: an unknown role throws a TypeError instead of being refused.
- Writing each bundle out in full. Then a new permission has to be added in three places, and the "roles nest" test is the only thing that notices when you forget one.
- Returning the table's own array. Callers can then change the policy by accident; `readonly` only helps the type checker.
