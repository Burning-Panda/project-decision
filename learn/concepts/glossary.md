# Glossary

| Term | Meaning |
|---|---|
| Owner | An organisation (`acme`). Its identifier acts as organisation admin. |
| Team | A group of users within an owner; every owner has a `default` team. |
| Role | A user's role in a team: `member`, `lead` or `admin`. |
| Project | Where decisions live (`PRJ`); belongs to one team; holds the approval settings. |
| Decision | A document recording a choice, numbered per project (`PRJ-001`). |
| Draft | A decision still being written; only its owner edits it. |
| Propose | Lock a draft's content (with a hash) and ask for approval. |
| Approve / decline | The outcome of a proposal; declining needs a reason. |
| Revision | A new version after changes were requested; old versions are kept. |
| Approval mode | How a proposal is approved: `single_approval` (a lead), `consensus_voting`, `quorum` or `veto`. |
| Vote | `approve`, `request_revision` or `abstain`, in the voting modes. |
| Quorum | Enough eligible voters must vote before a majority counts. |
| Veto | Auto-approval after a waiting period unless someone objects. |
| Supersede | Replace an approved decision with a new one that links back to it. |
| Audit trail | The append-only record of every change: who, what, when. |
| Follow-up / todo | A task assigned on a decision. |
| Webhook | An HTTP call to another system when something happens. |
| Actor | The user performing an action (from the `X-User` header). |
| Permission | A named capability such as `decision:approve`; roles are bundles of permissions. |
| RBAC / ABAC | Role-based / attribute-based access control: decide from the subject's role, or from facts about subject, resource, action and context. |
