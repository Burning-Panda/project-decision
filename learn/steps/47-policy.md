# 47 · Attribute-based rules: allow, deny, explain

## Goal

Write `authorize(request)`, a pure function that decides from facts about the subject, the action and the resource, and says **why** when it refuses.

## You'll learn

- Attribute-based access control (ABAC) → `learn/concepts/authorization-models.md`
- Deny overrides allow: an explicit prohibition beats any grant
- Pure functions with the facts passed in → `learn/concepts/objects-and-copies.md`
- Table-driven tests

## Where

- `src/decision-log/core/policy.ts` (uses `hasPermission` from step 46)

New to reading test failures? `learn/concepts/reading-test-output.md`.

## Hints

Reveal them one at a time with `bun run learn hint`.

### Hint 1

The spec fixes the **order** in which questions are asked, because it fixes the reason you get when two things are wrong at once:

1. no role and not org admin: `not_a_member`
2. deciding on your own decision (`approve`, `decline`, `vote`): `own_decision`, even for a lead, an admin or the org admin
3. owner-only actions (`propose`, `edit_draft`, `return_to_draft`): allowed for the owner, otherwise `not_owner`; a higher role does not unlock them
4. org admin: allowed
5. otherwise: `hasPermission(role, action)` or `missing_permission`

### Hint 2

Keep two small lists, `OWNER_ONLY` and `NOT_OWN`, and test the facts against them. Do not write a branch per role.

### Hint 3

The last section freezes the request. If your function sorts, pushes or assigns on anything it was given, it throws in strict mode. Only read.

## Common mistakes

- Checking the permission first. A plain member who owns the decision then gets `missing_permission` where the spec wants `own_decision`.
- Letting the org admin override owner-only actions. In this project the org admin may approve a colleague's decision but may not propose it.
- Looking things up in the function (a store, a clock). Everything it needs is in the request; that is what makes it testable with plain objects.
- Handling `resource` being absent only for some actions. `team:manage_members` has no resource.
