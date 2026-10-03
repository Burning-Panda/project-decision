/**
 * The learning path: every top-level spec section belongs to exactly one step, in the order learners implement them.
 * `bun run learn check` verifies that; `docs/todos/learning-path.md` describes the order check against reference solutions.
 */
export interface StepSpec {
  /** Spec file relative to the repo root. */
  file: string;
  /** Exact top-level describe titles. Omitted: every section of the file. */
  sections?: string[];
}

export interface Step {
  /** `NN-slug`; the brief lives at learn/steps/<id>.md. */
  id: string;
  level: number;
  title: string;
  /** Files the learner edits (empty for worked examples). */
  edit: string[];
  specs: StepSpec[];
  /** Needs something external (a PostgreSQL server); skipped tests count as done. */
  optional?: boolean;
}

export const LEVELS = [
  'Orientation: worked examples',
  'First code: pure functions',
  'State, errors and permissions',
  'Persistence',
  'The decision lifecycle',
  'Rules and algorithms',
  'Features that build on each other',
  'Integrity and evolving data',
  'Queries',
  'The HTTP API',
  'Async work and the network',
  'Production database',
];

const routes = 'test/http/routes.spec.ts';
const api = 'test/http/api.spec.ts';
const lifecycle = 'test/decisions/lifecycle.spec.ts';
const approval = 'test/decisions/approval-modes.spec.ts';
const revisions = 'test/decisions/revisions.spec.ts';
const collaboration = 'test/decisions/collaboration.spec.ts';
const audit = 'test/decisions/audit-security.spec.ts';
const search = 'test/decisions/search-reports.spec.ts';
const webhooks = 'test/webhooks/webhooks.spec.ts';
const secrets = 'test/storage/secrets.spec.ts';
const sqlite = 'test/storage/sqlite-store.spec.ts';
const collections = 'test/storage/collections.spec.ts';
const memory = 'test/storage/memory-store.spec.ts';
const email = 'test/notifications/email.spec.ts';
const push = 'test/notifications/push.spec.ts';

export const STEPS: Step[] = [
  // ---- 0. Orientation: already green; read them before writing code
  {
    id: '00-reading-specs', level: 0, title: 'How a spec reads, and how the app is wired', edit: [],
    specs: [
      { file: routes, sections: [
        'every route is registered',
        'an empty X-User is the same as none',
        'known paths reject methods that are not registered for them',
        'unknown paths are not routed',
        'the route table is complete',
      ] },
      { file: 'test/domain/parts.spec.ts' },
    ],
  },
  { id: '01-worked-example-notifier', level: 0, title: 'Worked example: the Notifier', edit: [], specs: [{ file: 'test/notifications/notifications.spec.ts' }] },
  {
    id: '02-worked-example-email', level: 0, title: 'Worked example: the email channel and SMTP', edit: [],
    specs: [{ file: email, sections: [
      'EmailChannel is named email and needs a from address and a transport',
      'EmailChannel renders safe text and HTML with a stable Message-ID',
      'EmailChannel maps transport errors onto retryable or permanent failures',
      'smtpTransport delivers over SMTP and classifies rejections',
    ] }],
  },

  // ---- 1. First code
  { id: '03-first-fix', level: 1, title: 'Your first fix: serve the UI script', edit: ['src/ui/ui.controller.ts'], specs: [{ file: routes, sections: ['the web UI assets are public and whitelisted'] }] },
  { id: '04-project-record', level: 1, title: 'A pure function: building a project record', edit: ['src/decision-log/projects/project.ts'], specs: [{ file: 'test/domain/project.spec.ts' }] },
  { id: '05-push-subscriptions', level: 1, title: 'Parsing and validating input', edit: ['src/notifications/push.ts'], specs: [{ file: push, sections: ['parseSubscription accepts a browser subscription and rejects anything else'] }] },
  {
    id: '06-push-channel', level: 1, title: 'Implementing an interface: the push channel', edit: ['src/notifications/push.ts'],
    specs: [{ file: push, sections: [
      'PushChannel sends the notification to every subscription',
      'PushChannel classifies failures: a gone subscription is permanent, anything else retryable',
    ] }],
  },

  // ---- 2. State, errors and permissions
  { id: '07-memory-store', level: 2, title: 'The in-memory store', edit: ['src/storage/store.ts'], specs: [{ file: memory, sections: ['a new memory store holds every collection, empty, and is not persistent'] }] },
  { id: '08-owners', level: 2, title: 'A service with state and typed errors: owners', edit: ['src/decision-log/owners/owners.service.ts', 'src/decision-log/teams/teams.service.ts', 'src/decision-log/core/audit.service.ts'], specs: [{ file: 'test/domain/owners.spec.ts' }] },
  { id: '09-teams', level: 2, title: 'Permissions: teams and members', edit: ['src/decision-log/teams/teams.service.ts', 'src/decision-log/core/access.service.ts'], specs: [{ file: 'test/domain/teams.spec.ts' }] },
  { id: '10-projects', level: 2, title: 'Composing domain and service: projects', edit: ['src/decision-log/projects/projects.service.ts'], specs: [{ file: 'test/domain/projects.spec.ts' }] },

  // ---- 3. Persistence
  {
    id: '11-json-snapshot', level: 3, title: 'Serialising the store to JSON', edit: ['src/storage/store.ts'],
    specs: [
      { file: memory, sections: ['the JSON snapshot is plain JSON and round-trips'] },
      { file: collections, sections: ['every collection round-trips through the JSON snapshot'] },
    ],
  },
  {
    id: '12-sqlite-migrations', level: 3, title: 'Schema migrations in SQLite', edit: ['src/storage/migrations/sqlite.ts', 'src/storage/sqlite-store.ts'],
    specs: [{ file: sqlite, sections: [
      'SQLite migrations are numbered 1..n and together give every collection a table',
      'opening a SQLite file applies migrations once, records them, and refuses a newer database',
    ] }],
  },
  {
    id: '13-sqlite-store', level: 3, title: 'Saving and loading documents in SQLite', edit: ['src/storage/sqlite-store.ts'],
    specs: [
      { file: sqlite, sections: [
        'SQLite keeps one table per collection, each document as JSON',
        'committed documents survive reopening; uncommitted ones and deleted ones do not',
      ] },
      { file: collections, sections: ['every collection round-trips through SQLite'] },
    ],
  },

  // ---- 4. The decision lifecycle
  {
    id: '14-create-decisions', level: 4, title: 'Creating decisions: ids, defaults, validation', edit: ['src/decision-log/decisions/decisions.service.ts', 'src/storage/store.ts', 'src/storage/migrations/sqlite.ts'],
    specs: [{ file: lifecycle, sections: [
      'decision ids increment per project and project count tracks them',
      'new decision is an owned draft with the default template when no content given',
      'creation validation and permissions',
    ] }],
  },
  {
    id: '15-drafts', level: 4, title: 'Editing and deleting drafts', edit: ['src/decision-log/decisions/decisions.service.ts'],
    specs: [{ file: lifecycle, sections: [
      'drafts are editable by the owner only; updated_at does not move on content edits',
      'only drafts can be deleted, and only by their owner',
    ] }],
  },
  {
    id: '16-propose', level: 4, title: 'Proposing: locking content with a hash', edit: ['src/decision-log/decisions/decisions.service.ts'],
    specs: [{ file: lifecycle, sections: [
      'propose locks content, hashes it with sha256 and snapshots revision 1',
      'propose may carry final content; only the owner may propose',
      'content cannot be edited or deleted once proposed',
    ] }],
  },
  {
    id: '17-approve-decline', level: 4, title: 'A state machine: approve and decline', edit: ['src/decision-log/decisions/decisions.service.ts'],
    specs: [{ file: lifecycle, sections: [
      'unknown actions and wrong-state actions give actionable errors',
      'single approval: a lead approves, content and hash are untouched',
      'approving an approved decision suggests superseding',
      'decline needs a reason, stores it outside the document and allows return to draft',
      'only a lead or an admin may decline, whatever the approval mode',
    ] }],
  },
  {
    id: '18-integrity-and-document', level: 4, title: 'Verifying integrity and rendering the document', edit: ['src/decision-log/decisions/decisions.service.ts', 'src/decision-log/core/audit.service.ts'],
    specs: [{ file: lifecycle, sections: [
      'integrity check detects tampering and records a violation',
      'renderDecisionDocument produces the standard header, approvers and sections',
    ] }],
  },
  {
    id: '19-access', level: 4, title: 'Who may see what', edit: ['src/decision-log/core/access.service.ts', 'src/decision-log/decisions/decisions.service.ts'],
    specs: [{ file: audit, sections: [
      'outsiders cannot read anything; the org identifier can read everything',
      'projects live in a team; decisions are visible only to that team',
    ] }],
  },

  // ---- 5. Rules and algorithms
  {
    id: '20-consensus', level: 5, title: 'Voting: single approval and consensus', edit: ['src/decision-log/decisions/decisions.service.ts', 'src/storage/store.ts', 'src/storage/migrations/sqlite.ts'],
    specs: [{ file: approval, sections: [
      'single approval: members and the owner cannot approve; voting is disabled',
      'consensus: approves at 3 approvals (80%+), returning 202 when the vote closes it',
      'consensus: 75% approval is not enough',
      'consensus: abstentions do not count toward minimum votes or the ratio',
      'consensus: abstain can be disabled; revision votes need a reason',
      'consensus: a voter can change their vote while the decision is open',
      'consensus: owner and outsiders cannot vote; only proposed decisions accept votes',
      'consensus: the approve action counts as an approve vote (202)',
      'consensus: the request_revision action is a revision request, not a vote',
    ] }],
  },
  {
    id: '21-voting-settings', level: 5, title: 'Configurable thresholds', edit: ['src/decision-log/decisions/decisions.service.ts'],
    specs: [{ file: approval, sections: [
      'consensus thresholds can be configured',
      'require_reason_on_revision=false lets a revision vote omit its reason',
      'single approval with enabled_voting=true: votes are advisory',
    ] }],
  },
  {
    id: '22-quorum-weights', level: 5, title: 'Quorum, majorities and weighted votes', edit: ['src/decision-log/decisions/decisions.service.ts'],
    specs: [{ file: approval, sections: [
      'quorum: needs turnout before a majority can approve',
      'quorum: a tie is not a majority; a third vote breaks it',
      'quorum: 2/3 majority',
      'quorum: role weights make a lead count for more',
      'quorum: weighted opposition outweighs more numerous approvals',
      'without weights the same lead vote is not enough',
    ] }],
  },
  {
    id: '23-veto-sweep', level: 5, title: 'Time-based rules: veto windows and sweeps', edit: ['src/decision-log/decisions/decisions.service.ts'],
    specs: [{ file: approval, sections: [
      'veto: auto-approves after the window unless blocked',
      'veto: a veto needs a reason and sends the decision back to draft',
      'veto: a lead can still approve explicitly',
      'veto: sweeping is idempotent',
    ] }],
  },
  {
    id: '24-revisions', level: 5, title: 'Revisions: immutable versions', edit: ['src/decision-log/decisions/decisions.service.ts'],
    specs: [{ file: revisions, sections: [
      'request_revision needs a reason and a proposed decision; returns 201 with a draft',
      'revision cycle keeps every version immutable and reachable',
      'votes are scoped to a revision and reset on re-proposal by default',
      'with revision_vote_resets_count=false approvals carry over',
    ] }],
  },
  { id: '25-diff', level: 5, title: 'An algorithm: diffing markdown by section', edit: ['src/decision-log/decisions/decisions.service.ts'], specs: [{ file: revisions, sections: ['diff groups changes by section path and accepts "v1" style refs'] }] },

  // ---- 6. Features that build on each other
  {
    id: '26-comments', level: 6, title: 'Comments: threads, mentions, edit windows', edit: ['src/decision-log/comments/comments.service.ts', 'src/decision-log/profiles/profiles.service.ts', 'src/storage/store.ts', 'src/storage/migrations/sqlite.ts'],
    specs: [{ file: collaboration, sections: [
      'anyone on the team can comment in any status; outsiders cannot',
      'comments are chronological, threaded and mention-aware',
      'authors may edit within five minutes only',
      'the edit window includes the fifth minute',
      'delete leaves a placeholder; authors and admins only',
      'comments can be resolved and re-opened',
      'the comment author and the decision owner may resolve a comment; others may not',
    ] }],
  },
  {
    id: '27-participants-meetings', level: 6, title: 'Participants and meeting notes', edit: ['src/decision-log/decisions/decisions.service.ts', 'src/decision-log/followups/followups.service.ts'],
    specs: [{ file: collaboration, sections: [
      'participants accumulate roles and actions',
      'meeting records store a transcript and render the documented notes format',
      'meeting needs a transcript',
    ] }],
  },
  {
    id: '28-profiles-notifications', level: 6, title: 'Profiles and in-app notifications', edit: ['src/decision-log/profiles/profiles.service.ts', 'src/decision-log/decisions/decisions.service.ts'],
    specs: [
      { file: 'test/notifications/profiles.spec.ts' },
      { file: collaboration, sections: [
        'notifications: proposing notifies the team; votes notify the owner when enabled',
        'notification_on_vote=false suppresses vote notifications',
        'notifications: the owner hears the outcome of a proposal',
      ] },
    ],
  },
  { id: '29-followups', level: 6, title: 'Follow-ups and todo lists', edit: ['src/decision-log/followups/followups.service.ts'], specs: [{ file: 'test/decisions/followups.spec.ts' }] },
  {
    id: '30-related', level: 6, title: 'Related decisions and superseding', edit: ['src/decision-log/related/related.service.ts', 'src/decision-log/decisions/decisions.service.ts'],
    specs: [
      { file: 'test/decisions/related.spec.ts' },
      { file: lifecycle, sections: ['superseding creates a linked draft; original is marked once the new one is approved'] },
    ],
  },

  // ---- 7. Integrity and evolving data
  {
    id: '31-audit-chain', level: 7, title: 'A tamper-evident audit chain', edit: ['src/decision-log/core/audit.service.ts'],
    specs: [{ file: audit, sections: [
      'every action is audited with before/after state, ip and a verifiable hash chain',
      'audit trail filters by actor and detects tampering',
      'failed actions leave state and audit untouched',
      'audit hashes do not depend on object key order (stores such as jsonb reorder keys)',
      'chains written before hash versioning (insertion-order hashes) still verify',
      'new entries can extend a legacy chain',
    ] }],
  },
  {
    id: '32-idempotency', level: 7, title: 'Idempotency: safe retries', edit: ['src/decision-log/decisions/decisions.service.ts'],
    specs: [{ file: audit, sections: [
      'idempotency keys make retries safe',
      'an idempotency key cannot be reused for a different request',
    ] }],
  },
  {
    id: '33-secret-box', level: 7, title: 'Encryption at rest', edit: ['src/storage/secrets.ts'],
    specs: [{ file: secrets, sections: [
      'encrypt/decrypt round trip; ciphertext is randomised and carries the key id',
      'ciphertext is bound to its record, key and integrity',
      'keys must be 32 bytes; fromEnv understands base64 and hex and previous keys',
    ] }],
  },
  {
    id: '34-webhook-registry', level: 7, title: 'Registering webhooks safely', edit: ['src/decision-log/webhooks/webhooks.service.ts'],
    specs: [{ file: webhooks, sections: [
      'org admins register webhooks; the secret is shown once and never listed',
      'webhook URLs and event filters are validated',
      'webhooks can be removed by admins only; removed hooks disappear from listings',
    ] }],
  },
  {
    id: '35-events-outbox', level: 7, title: 'Events and the outbox', edit: ['src/decision-log/webhooks/webhooks.service.ts', 'src/decision-log/decisions/decisions.service.ts'],
    specs: [{ file: webhooks, sections: [
      'events are recorded in the outbox and fan out to matching active hooks of the same org only',
      'wildcard family filters match',
      'vote and approval events carry the documented payload',
      'every lifecycle step emits its event',
      'failed actions emit nothing',
    ] }],
  },
  {
    id: '36-data-migrations', level: 7, title: 'Evolving stored data: data migrations', edit: ['src/storage/data-migrations.ts', 'src/decision-log/decision-log.ts', 'src/decision-log/webhooks/webhooks.service.ts'],
    specs: [
      { file: 'test/storage/data-migrations.spec.ts' },
      { file: secrets, sections: [
        'webhook secrets are encrypted in the store and absent from every serialised form',
        'legacy plaintext secrets are encrypted automatically when the log starts',
        'rotation re-encrypts everything under the current key',
        'a persistent store requires an explicit secret box; memory stores get an ephemeral one',
      ] },
    ],
  },
  {
    id: '37-persisting-the-log', level: 7, title: 'The whole log, persisted', edit: ['src/storage/sqlite-store.ts', 'src/storage/store.ts'],
    specs: [
      { file: audit, sections: ['state survives a JSON round trip including id counters and audit chain'] },
      { file: sqlite, sections: [
        'state committed to SQLite survives reopening, including audit chain and counters',
        'uncommitted changes are not persisted; later commits are incremental and idempotent',
        'deletions are persisted',
        'a failed commit rolls back as a whole',
      ] },
      { file: webhooks, sections: ['webhooks, events and deliveries survive a SQLite round trip'] },
    ],
  },

  // ---- 8. Queries
  {
    id: '38-listing-search', level: 8, title: 'Filtering, sorting, paging and fuzzy search', edit: ['src/decision-log/decisions/decisions.service.ts', 'src/decision-log/insights/insights.service.ts'],
    specs: [{ file: search, sections: [
      'listDecisions filters, sorts and paginates',
      'search finds content, ids, comments and transcripts, honouring access',
      'search filters by status, owner, project, approver and date range',
    ] }],
  },
  {
    id: '39-dashboard-reports-export', level: 8, title: 'Aggregations: dashboard, reports, export', edit: ['src/decision-log/insights/insights.service.ts'],
    specs: [{ file: search, sections: [
      'dashboard answers the four participation questions',
      'reports: volume, approval metrics, revision cycles, participation, todos',
      'export as JSON includes votes; CSV escapes properly',
      'export is for org admins, in json or csv only',
    ] }],
  },

  // ---- 9. The HTTP API
  {
    id: '40-http-decisions', level: 9, title: 'Controllers: decisions over HTTP', edit: ['src/decisions/decisions.controller.ts', 'src/api/'],
    specs: [{ file: api, sections: [
      'create and fetch a decision',
      'validation and malformed bodies produce 400s in the standard envelope',
      'unified action endpoint drives the whole lifecycle',
      'errors carry allowed actions and codes',
      'Idempotency-Key is echoed and replays do not repeat side effects',
      'an Idempotency-Key cannot be reused for a different request',
    ] }],
  },
  {
    id: '41-http-resources', level: 9, title: 'The rest of the resources', edit: ['src/decisions/', 'src/todos/', 'src/insights/', 'src/admin/'],
    specs: [{ file: api, sections: [
      'comments, participants, versions and diff',
      'todos, search, reports and listing',
      'admin endpoints create projects and members',
      'owner, team and project endpoints',
      'decision document, related links and integrity endpoints',
      'dashboard and notification endpoints',
      'export endpoint',
    ] }],
  },
  {
    id: '42-http-profiles-hooks', level: 9, title: 'Profiles, the UI contract and write hooks', edit: ['src/profile/', 'src/api/'],
    specs: [{ file: api, sections: [
      'UI script only uses endpoints the API actually serves',
      'onMutation fires after successful writes only',
      'notification profile endpoints',
      'NUL characters are rejected at the boundary (they cannot be stored in PostgreSQL jsonb)',
      'a failing persistence hook turns into a 500 without leaking details',
    ] }],
  },

  // ---- 10. Async work and the network
  {
    id: '43-webhook-delivery', level: 10, title: 'Delivering webhooks: signing, retries, SSRF', edit: ['src/webhooks/dispatcher.ts', 'src/decision-log/webhooks/webhooks.service.ts', 'src/webhooks/webhooks.controller.ts'],
    specs: [
      { file: webhooks, sections: [
        'dispatcher POSTs signed JSON and marks deliveries delivered',
        'failures retry with exponential backoff and give up after five attempts',
        'transport errors are recorded and retried; recovery marks delivered',
        'redirects count as failures; they are never followed',
        'failed deliveries can be redelivered by admins',
        'deliveries to removed hooks are cancelled, not sent',
        'concurrent runs do not double-send',
        'delivery refuses targets that resolve to private addresses',
        'verifySignature accepts valid signatures and rejects tampering, wrong secrets and stale timestamps',
        'end to end over real HTTP: a local receiver verifies the signature',
        'default policy refuses a loopback receiver at delivery time',
        'pruneOutbox removes old finished deliveries and orphaned events, keeping pending ones',
      ] },
      { file: secrets, sections: ['the dispatcher still signs with the decrypted secret'] },
      { file: api, sections: ['webhook management endpoints'] },
    ],
  },
  {
    id: '44-notification-dispatch', level: 10, title: 'Dispatching notifications through channels', edit: ['src/decision-log/notifications/notification-dispatcher.ts', 'src/decision-log/notifications/retry-policy.ts'],
    specs: [
      { file: 'test/notifications/notification-dispatch.spec.ts' },
      { file: email, sections: [
        'end to end: team members receive real emails over SMTP, and transient failures are retried',
        'end to end retry: the greylisted recipient succeeds on the next attempt',
      ] },
    ],
  },

  // ---- 11. Production database
  {
    id: '45-postgres', level: 11, title: 'PostgreSQL: transactions, locks and incremental writes', edit: ['src/storage/postgres-store.ts', 'src/storage/migrations/postgres.ts'], optional: true,
    specs: [
      { file: 'test/storage/postgres-store.spec.ts' },
      { file: collections, sections: ['every collection round-trips through PostgreSQL'] },
    ],
  },
];
