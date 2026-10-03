import { MAP_COLLECTIONS, ARRAY_COLLECTIONS, RECORD_COLLECTIONS } from '../store.js';

const q = (s) => `"${s}"`;

/**
 * Ordered, append-only list. Never edit a released migration: add a new one with the next version number.
 * `up(schema)` returns SQL; `schema` has already been validated as a plain lowercase identifier.
 */
export const MIGRATIONS = [
  {
    version: 1,
    name: 'initial document tables',
    up: (schema) => {
      const tables = [...MAP_COLLECTIONS, ...ARRAY_COLLECTIONS, ...RECORD_COLLECTIONS]
        .map((c) => `CREATE TABLE ${q(schema)}.${q(c)} (
  k          text PRIMARY KEY,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);`)
        .join('\n');
      return `${tables}
CREATE INDEX decisions_status_idx     ON ${q(schema)}."decisions"     ((data->>'status'));
CREATE INDEX decisions_project_idx    ON ${q(schema)}."decisions"     ((data->>'project'));
CREATE INDEX followups_assignee_idx   ON ${q(schema)}."followups"     ((data->>'assigned_to'));
CREATE INDEX audit_decision_idx       ON ${q(schema)}."audit"         ((data->>'decision_id'));
CREATE INDEX notifications_user_idx   ON ${q(schema)}."notifications" ((data->>'user'));
CREATE INDEX deliveries_status_idx    ON ${q(schema)}."deliveries"    ((data->>'status'));`;
    },
  },
];
