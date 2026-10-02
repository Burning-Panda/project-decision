import assert from 'node:assert/strict';
import { DecisionLog } from '../src/decision-log.js';

export function makeClock(start = '2024-03-20T10:00:00Z') {
  let t = Date.parse(start);
  return {
    now: () => new Date(t),
    advanceMinutes: (m) => { t += m * 60_000; },
    advanceHours: (h) => { t += h * 3_600_000; },
    advanceDays: (d) => { t += d * 86_400_000; },
  };
}

export const U = {
  alice: 'alice@acme.com',
  bob: 'bob@acme.com',
  carol: 'carol@acme.com',
  david: 'david@acme.com',
  lead: 'lead@acme.com',
  outsider: 'eve@other.com',
  org: 'acme', // owner/customer identifier acts as organisation admin
};

export const CONTENT_V1 = `## Context

We need a database that scales.

## Decision

Move to PostgreSQL 16 and deprecate MySQL

## Consequences

### Negative

- Database replication overhead during transition
`;

export const CONTENT_V2 = `## Context

We need a database that scales.

## Decision

Move to PostgreSQL 16 within 90 days, maintain MySQL fallback for 30 days

## Consequences

### Negative

- Database replication overhead (mitigated by 30-day dual-write period)
`;

/** Builds a log with one org, default team and project PRJ. */
export function setup({ settings, startAt, finder, threshold } = {}) {
  const clock = makeClock(startAt);
  const log = new DecisionLog({ clock: clock.now, relatedFinder: finder, relatedThreshold: threshold });
  log.createOwner({ identifier: 'acme', name: 'Acme Inc', email: 'root@acme.com' });
  for (const u of [U.alice, U.bob, U.carol, U.david]) {
    log.addTeamMember({ owner: 'acme', team: 'default', user: u, role: 'member', actor: U.org });
  }
  log.addTeamMember({ owner: 'acme', team: 'default', user: U.lead, role: 'lead', actor: U.org });
  log.createProject({
    owner: 'acme', team: 'default', identifier: 'PRJ', title: 'Platform',
    description: 'Platform decisions', settings: settings ? { approval_settings: settings } : undefined,
    actor: U.org,
  });
  return { log, clock };
}

export function draft(log, over = {}) {
  return log.createDecision({
    project: 'PRJ', actor: U.alice, title: 'Migrate to new database', content: CONTENT_V1, ...over,
  });
}

export function proposed(log, over = {}) {
  const d = draft(log, over);
  log.perform(d.id, over.actor ?? U.alice, { action: 'propose', payload: {} });
  return d.id;
}

export const act = (log, id, actor, action, payload = {}, opts) =>
  log.perform(id, actor, { action, payload }, opts);

/** Asserts that fn throws a DecisionLogError with the given code. */
export function assertCode(fn, code, status) {
  try {
    fn();
  } catch (e) {
    assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
    if (status) assert.equal(e.status, status);
    return e;
  }
  assert.fail(`expected error ${code} but nothing was thrown`);
}
