# Authorization models: roles, permissions, attributes

`learn/concepts/permissions.md` gave you the basic shape: subject, action, resource, context. This page is about how to organise the rules when there are many of them. Three models, each fixing a weakness in the one before.

## 1. Role-based (RBAC): the subject has a role

```ts
const canApprove = (role: Role) => role === 'lead' || role === 'admin';
```

Simple and easy to explain. It breaks down when:

- Rules multiply. "Leads of *this* team, except for decisions they wrote, unless the project is in `veto` mode" becomes a pile of special roles (**role explosion**).
- The same role name means different things in different places. The check `role === 'lead'` is scattered across files and cannot be audited.

## 2. Permission-based: roles grant permissions, code checks permissions

Code never asks "are you a lead?". It asks "may you `decision:approve`?". Roles are just named bundles of permissions:

```ts
type Permission = 'decision:read' | 'decision:approve' | 'team:add_member' | 'project:create';

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  member: ['decision:read'],
  lead:   ['decision:read', 'decision:approve'],
  admin:  ['decision:read', 'decision:approve', 'team:add_member', 'project:create'],
};

const hasPermission = (role: Role, p: Permission) => ROLE_PERMISSIONS[role].includes(p);
```

What you gain:

- **One place to read the policy.** The table is the requirement.
- **Roles can change without touching call sites.** Add a `reviewer` role by adding a row.
- **Permissions can be granted individually** (a user gets `decision:approve` without becoming a lead) and the API can report "you lack `decision:approve`" instead of a bare 403.

What you do not gain: it still only knows about the subject. It cannot say "not your own decision".

## 3. Attribute-based (ABAC): decide from facts

ABAC decides from **attributes** of the four inputs:

| Group | Attributes here |
|---|---|
| Subject | role in the team, user id |
| Resource | owner, team (status stays out: see below) |
| Action | `approve`, `read` |
| Context | time, whether the veto window has passed |

A rule is a function from those facts to a verdict:

```ts
interface Request {
  subject: { id: string; role?: Role; isOrgAdmin: boolean };
  action: Permission;
  resource: { owner: string; team: string };
  context: { now: Date };
}

type Rule = (r: Request) => boolean;

const sameTeam: Rule = (r) => r.subject.role !== undefined;                       // member of the resource's team
const notAuthor: Rule = (r) => r.subject.id !== r.resource.owner;                 // separation of duties
const mayApprove: Rule = (r) =>
  r.subject.isOrgAdmin || hasPermission(r.subject.role!, 'decision:approve');

const canApprove: Rule = (r) =>
  r.action === 'decision:approve' && sameTeam(r) && notAuthor(r) && mayApprove(r);
```

Each small rule is easy to test alone; the combination reads like the requirement. ABAC is not instead of roles: a role is just one attribute, and permission checks become one rule among others.

### Where attributes come from

The service **loads** attributes; the rules only **compare** them. Keep rules pure (no store, no clock, no I/O). That keeps them testable with plain objects, and it is why `AccessService` has no persistence of its own.

Never trust an attribute the caller can set. The actor comes from `X-User`; the decision's owner comes from the store, not from the request body.

## Combining rules: allow, deny, explain

With more than a few rules you need a convention for how they combine:

1. **Default deny.** No rule says yes: refuse.
2. **Deny overrides allow.** An explicit prohibition ("never your own decision") beats any grant. This is easier to reason about than ordering rules.
3. **Return the reason, not just the verdict.** Use a short code (`own_decision`), not a sentence: codes can be tested and translated, and cannot leak details by accident.

```ts
type Decision = { allow: true } | { allow: false; reason: string };

function authorize(r: Request): Decision {
  if (r.subject.id === r.resource.owner) return { allow: false, reason: 'own_decision' };
  if (!r.subject.isOrgAdmin && !hasPermission(r.subject.role, r.action)) {
    return { allow: false, reason: 'missing_permission' };
  }
  return { allow: true };
}
```

The reason can go into the `FORBIDDEN` error's `details` and into the audit trail, so "why was I refused?" has an answer.

Careful with ordering of **errors** (not rules): if the resource's state is part of a permission rule, a stranger can learn the state from the reason. That is why this project keeps state out of the policy: permission is checked first (`FORBIDDEN`), then state (`INVALID_STATE`). Reasons shown to outsiders must not leak details of the resource; an outsider only ever hears `not_a_member`.

You build all of this in level 12 (steps 46 to 48): `permissionsOf`, `authorize`, then `AccessService.check` and `DecisionLog.can`.

## Testing authorization

Authorization is a good fit for table tests, because the cases are the requirement:

```ts
const cases: [string, Request, boolean][] = [
  ['lead approves a colleague\'s proposal', lead(), true],
  ['lead cannot approve their own',         lead({ owner: 'lead' }), false],
  ['member cannot approve',                 member(), false],
  ['outsider cannot approve',               outsider(), false],
];
```

Always include the **negative** cases. A policy that is only tested with the allowed path will pass while being wide open.

## Common mistakes

- Putting the rule in the controller. Rules belong in one service so every route shares them.
- Checking a role name where a permission is meant.
- Checking only the subject and forgetting the resource, so a lead of team A can approve team B's decisions.
- Letting an allow rule override an explicit deny.
- Letting a rule read the clock or the store directly; pass the facts in.
- Leaking resource details in the denial reason to someone who may not read the resource.

## Try it

Using only the rules of this project, write the table of who may do each of `read`, `propose`, `approve`, `decline`, `add_member` for: org admin, team admin, lead, member, outsider, and the decision's owner. Which cells needed an attribute beyond the role? Those are the ABAC rules.
