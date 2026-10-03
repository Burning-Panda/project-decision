import { describe, it, expect, beforeEach } from 'bun:test';
import {
  freshLog, proposedIn, draft, act, attempt, expectCode, sha256, U, buildLog, MemoryStore, type LogHandle,
} from './support/index';

// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.
// Actions expected to fail are captured as a thunk in WHEN and invoked by expectCode in THEN; when the
// THEN must also inspect state after the failure, the WHEN runs the action through attempt() instead.
// THEN may call read-only queries (auditTrail, getDecision, ...) to observe the outcome.

const CONSENSUS = { mode: 'consensus_voting' };

/** Audit entries written before hash versioning: hash = sha256 of the entry in insertion order. */
function legacyEntries(count: number) {
  const entries: any[] = [];
  let prev = '0'.repeat(64);
  for (let seq = 1; seq <= count; seq++) {
    const e: any = { seq, at: '2024-01-01T00:00:00.000Z', actor: 'a', action: 'create', decision_id: null, before: null, after: null, ip: null, detail: null, prev_hash: prev };
    e.hash = sha256(JSON.stringify(e));
    prev = e.hash;
    entries.push(e);
  }
  return entries;
}

/** Call inside a describe(): a fresh log whose audit trail is replaced by `count` legacy entries. */
function legacyChain(count: number) {
  const h = freshLog();
  beforeEach(() => {
    h.log.store.audit.length = 0;
    h.log.store.audit.push(...legacyEntries(count));
  });
  return h;
}

/** Rewrites every audit entry with its keys in reverse order, as a jsonb store may return them. */
const reverseKeys = (log: any) => {
  log.store.audit = log.store.audit.map((e: any) => Object.fromEntries(Object.entries(e).sort(([a], [b]) => (a < b ? 1 : -1))));
};

describe('outsiders cannot read anything; the org identifier can read everything', () => {
  const reads: Array<[string, (log: any, id: string) => unknown]> = [
    ['getDecision', (log, id) => log.getDecision(id, U.outsider)],
    ['listComments', (log, id) => log.listComments(id, U.outsider)],
    ['getVersions', (log, id) => log.getVersions(id, U.outsider)],
    ['getParticipants', (log, id) => log.getParticipants(id, U.outsider)],
    ['renderDecisionDocument', (log, id) => log.renderDecisionDocument(id, U.outsider)],
  ];

  for (const [name, read] of reads) {
    describe('GIVEN a proposed decision', () => {
      const h = proposedIn();

      describe(`WHEN an outsider calls ${name}`, () => {
        let call: () => unknown;
        beforeEach(() => { call = () => read(h.log, h.id); });

        it('THEN FORBIDDEN 403', () => {
          expectCode(call, 'FORBIDDEN', 403);
        });
      });
    });
  }

  describe('GIVEN a proposed decision', () => {
    const h = proposedIn();

    describe('WHEN the org identifier reads it', () => {
      let d: any;
      beforeEach(() => { d = h.log.getDecision(h.id, U.org); });

      it('THEN access is granted', () => {
        expect(d.id).toBe(h.id);
      });
    });
  });
});

describe('projects live in a team; decisions are visible only to that team', () => {
  /** Call inside a describe(): adds team payments with bob as its only member, and project PAY in it. */
  function paymentsTeam() {
    const h = freshLog();
    beforeEach(() => {
      h.log.createTeam({ owner: 'acme', name: 'payments', actor: U.org });
      h.log.addTeamMember({ owner: 'acme', team: 'payments', user: U.bob, role: 'member', actor: U.org });
      h.log.createProject({ owner: 'acme', team: 'payments', identifier: 'PAY', title: 'Pay', actor: U.org });
    });
    return h;
  }

  describe('GIVEN a PAY project in team payments', () => {
    const h = paymentsTeam();

    describe('WHEN bob creates a decision', () => {
      let d: any;
      beforeEach(() => { d = h.log.createDecision({ project: 'PAY', actor: U.bob, title: 'Use Stripe' }); });

      it('THEN it belongs to team payments', () => {
        expect(d.team).toBe('payments');
      });
    });

    describe('WHEN alice (default team) creates a decision in it', () => {
      let create: () => unknown;
      beforeEach(() => { create = () => h.log.createDecision({ project: 'PAY', actor: U.alice, title: 'x' }); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(create, 'FORBIDDEN', 403);
      });
    });
  });

  describe('GIVEN a payments decision', () => {
    const h = paymentsTeam();
    let id: string;
    beforeEach(() => { id = h.log.createDecision({ project: 'PAY', actor: U.bob, title: 'Use Stripe' }).id; });

    describe('WHEN carol (default team) reads it', () => {
      let read: () => unknown;
      beforeEach(() => { read = () => h.log.getDecision(id, U.carol); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(read, 'FORBIDDEN', 403);
      });
    });
  });
});

describe('every action is audited with before/after state, ip and a verifiable hash chain', () => {
  describe('GIVEN a decision created, proposed from 10.0.0.1 and approved', () => {
    const h = freshLog();
    let id: string;
    beforeEach(() => {
      id = draft(h.log).id;
      act(h.log, id, U.alice, 'propose', {}, { ip: '10.0.0.1' });
      act(h.log, id, U.lead, 'approve');
    });

    describe('WHEN the decision audit trail is read', () => {
      let trail: any[];
      beforeEach(() => { trail = h.log.auditTrail({ decision_id: id }); });

      it('THEN it lists the three actions in order', () => {
        expect(trail.map((e) => e.action)).toEqual(['create', 'propose', 'approve']);
      });

      it('THEN the propose entry carries actor, ip and before/after status', () => {
        const propose = trail[1];
        expect(propose.actor).toBe(U.alice);
        expect(propose.ip).toBe('10.0.0.1');
        expect(propose.before.status).toBe('draft');
        expect(propose.after.status).toBe('proposed');
      });

      it('THEN each hash is sha256 and links to the previous hash', () => {
        expect(trail[1].hash).toMatch(/^[0-9a-f]{64}$/);
        expect(trail[1].prev_hash).toBe(trail[0].hash);
      });
    });

    describe('WHEN the chain is verified', () => {
      let res: any;
      beforeEach(() => { res = h.log.verifyAuditChain(); });

      it('THEN it is intact', () => {
        expect(res.ok).toBe(true);
      });
    });
  });
});

describe('audit trail filters by actor and detects tampering', () => {
  describe('GIVEN alice created and proposed a decision after the org set things up', () => {
    const h = freshLog();
    beforeEach(() => { act(h.log, draft(h.log).id, U.alice, 'propose'); });

    describe('WHEN the trail is filtered by alice', () => {
      let mine: any[];
      beforeEach(() => { mine = h.log.auditTrail({ actor: U.alice }); });

      it('THEN exactly her entries return (create and propose)', () => {
        expect(mine.map((e) => e.action)).toEqual(['create', 'propose']);
        expect(mine).toEqual(h.log.auditTrail({}).filter((e: any) => e.actor === U.alice));
      });
    });
  });

  describe('GIVEN an audit entry whose actor was rewritten', () => {
    const h = freshLog();
    beforeEach(() => {
      act(h.log, draft(h.log).id, U.alice, 'propose');
      h.log.store.audit[1].actor = 'mallory@evil.com';
    });

    describe('WHEN the chain is verified', () => {
      let res: any;
      beforeEach(() => { res = h.log.verifyAuditChain(); });

      it('THEN it breaks at that entry', () => {
        expect(res.ok).toBe(false);
        expect(res.broken_at).toBe(h.log.store.audit[1].seq);
      });
    });
  });
});

describe('failed actions leave state and audit untouched', () => {
  describe('GIVEN alice\'s draft', () => {
    const h = freshLog();
    let id: string;
    let auditBefore: number;
    beforeEach(() => {
      id = draft(h.log).id;
      auditBefore = h.log.auditTrail({}).length;
    });

    describe('WHEN bob fails to propose it', () => {
      let error: any;
      beforeEach(() => { error = attempt(() => act(h.log, id, U.bob, 'propose')); });

      it('THEN it is FORBIDDEN and the audit length is unchanged', () => {
        expect(error?.code).toBe('FORBIDDEN');
        expect(h.log.auditTrail({}).length).toBe(auditBefore);
      });

      it('THEN it is still a draft', () => {
        expect(h.log.getDecision(id, U.alice).status).toBe('draft');
      });
    });
  });
});

describe('idempotency keys make retries safe', () => {
  const VOTE_KEY = { idempotencyKey: 'vote-bob-prj001' };

  describe('GIVEN bob\'s vote cast with key K', () => {
    const h = proposedIn(CONSENSUS);
    let first: any;
    beforeEach(() => { first = act(h.log, h.id, U.bob, 'vote', { vote: 'approve' }, VOTE_KEY); });

    describe('WHEN the same vote is replayed with K', () => {
      let again: any;
      beforeEach(() => { again = act(h.log, h.id, U.bob, 'vote', { vote: 'approve' }, VOTE_KEY); });

      it('THEN it is flagged idempotent_replay with the same tally', () => {
        expect(again.idempotent_replay).toBe(true);
        expect(first.idempotent_replay).toBeUndefined();
        expect(again.metadata.vote_tally).toEqual(first.metadata.vote_tally);
      });

      it('THEN only one vote is audited', () => {
        expect(h.log.auditTrail({ decision_id: h.id }).filter((e: any) => e.action === 'vote').length).toBe(1);
      });
    });
  });

  describe('GIVEN a follow-up for carol assigned with key F', () => {
    const h = proposedIn();
    const assignment = { title: 'once', assigned_to: U.carol };
    const FOLLOWUP_KEY = { idempotencyKey: 'fu-1' };
    beforeEach(() => { act(h.log, h.id, U.alice, 'assign_followup', assignment, FOLLOWUP_KEY); });

    describe('WHEN the assignment is replayed with F', () => {
      beforeEach(() => { act(h.log, h.id, U.alice, 'assign_followup', assignment, FOLLOWUP_KEY); });

      it('THEN carol has exactly one todo', () => {
        expect(h.log.listTodos({ user: U.carol }).total).toBe(1);
      });
    });
  });
});

describe('state survives a JSON round trip including id counters and audit chain', () => {
  const restore = (json: any) => buildLog({ store: MemoryStore.fromJSON(json), clock: () => new Date('2024-04-01T00:00:00Z') });

  /** Call inside a describe(): an approved PRJ-001 whose store is serialised to `json`. */
  function serialised() {
    const h = proposedIn() as LogHandle & { id: string; json: any };
    beforeEach(() => {
      act(h.log, h.id, U.lead, 'approve');
      h.json = JSON.parse(JSON.stringify(h.log.store.toJSON()));
    });
    return h;
  }

  describe('GIVEN a store serialised to JSON', () => {
    const h = serialised();

    describe('WHEN a log is rebuilt from it', () => {
      let restored: any;
      beforeEach(async () => { restored = await restore(h.json); });

      it('THEN the decision is still approved', () => {
        expect(restored.getDecision(h.id, U.alice).status).toBe('approved');
      });

      it('THEN the audit chain and integrity both hold', () => {
        expect(restored.verifyAuditChain().ok).toBe(true);
        expect(restored.verifyIntegrity(h.id).ok).toBe(true);
      });
    });
  });

  describe('GIVEN a log restored from JSON', () => {
    const h = serialised();
    let restored: any;
    beforeEach(async () => { restored = await restore(h.json); });

    describe('WHEN a new decision is created', () => {
      let d: any;
      beforeEach(() => { d = restored.createDecision({ project: 'PRJ', actor: U.alice, title: 'next' }); });

      it('THEN the counter continues at PRJ-002', () => {
        expect(d.id).toBe('PRJ-002');
      });
    });
  });
});

describe('audit hashes do not depend on object key order (stores such as jsonb reorder keys)', () => {
  /** Call inside a describe(): a fresh log with a decision created and proposed. */
  function audited() {
    const h = freshLog();
    beforeEach(() => { act(h.log, draft(h.log).id, U.alice, 'propose'); });
    return h;
  }

  describe('GIVEN freshly written audit entries', () => {
    const h = audited();

    describe('WHEN their hash versions are read', () => {
      let versions: number[];
      beforeEach(() => { versions = h.log.store.audit.map((e: any) => e.hv); });

      it('THEN every entry carries hv 2', () => {
        expect(versions.every((hv) => hv === 2)).toBe(true);
        expect(versions.length).toBeGreaterThan(0);
      });
    });
  });

  describe('GIVEN audit entries whose keys were stored in reverse order', () => {
    const h = audited();
    beforeEach(() => { reverseKeys(h.log); });

    describe('WHEN the chain is verified', () => {
      let res: any;
      beforeEach(() => { res = h.log.verifyAuditChain(); });

      it('THEN it is still valid', () => {
        expect(res.ok).toBe(true);
      });
    });
  });

  describe('GIVEN reordered entries with a rewritten actor', () => {
    const h = audited();
    beforeEach(() => {
      reverseKeys(h.log);
      h.log.store.audit[0].actor = 'mallory@evil.com';
    });

    describe('WHEN the chain is verified', () => {
      let res: any;
      beforeEach(() => { res = h.log.verifyAuditChain(); });

      it('THEN tampering is still detected', () => {
        expect(res.ok).toBe(false);
      });
    });
  });
});

describe('chains written before hash versioning (insertion-order hashes) still verify', () => {
  describe('GIVEN a three-entry legacy chain', () => {
    const h = legacyChain(3);

    describe('WHEN it is verified', () => {
      let res: any;
      beforeEach(() => { res = h.log.verifyAuditChain(); });

      it('THEN it is ok with no break', () => {
        expect(res).toEqual({ ok: true, broken_at: null });
      });
    });
  });

  describe('GIVEN a legacy chain with entry 2 altered', () => {
    const h = legacyChain(3);
    beforeEach(() => { h.log.store.audit[1].actor = 'mallory'; });

    describe('WHEN it is verified', () => {
      let res: any;
      beforeEach(() => { res = h.log.verifyAuditChain(); });

      it('THEN it breaks at seq 2', () => {
        expect(res).toEqual({ ok: false, broken_at: 2 });
      });
    });
  });
});

describe('new entries can extend a legacy chain', () => {
  describe('GIVEN a one-entry legacy chain', () => {
    const h = legacyChain(1);

    describe('WHEN a new owner is created', () => {
      beforeEach(() => { h.log.createOwner({ identifier: 'newco' }); });

      it('THEN the new entry is hv 2, linked to the legacy hash, and the chain verifies', () => {
        const legacy = h.log.store.audit[0];
        const latest = h.log.store.audit.at(-1);
        expect(latest.hv).toBe(2);
        expect(latest.prev_hash).toBe(legacy.hash);
        expect(h.log.verifyAuditChain().ok).toBe(true);
      });
    });
  });
});
