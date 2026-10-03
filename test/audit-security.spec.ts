import { describe, it, expect } from 'bun:test';
import { setup, draft, proposed, act, expectCode, sha256, U, buildLog, MemoryStore } from './support/index.js';

describe('outsiders cannot read anything; the org identifier can read everything', () => {
  const reads: Array<[string, (log: any, id: string) => unknown]> = [
    ['getDecision', (log, id) => log.getDecision(id, U.outsider)],
    ['listComments', (log, id) => log.listComments(id, U.outsider)],
    ['getVersions', (log, id) => log.getVersions(id, U.outsider)],
    ['getParticipants', (log, id) => log.getParticipants(id, U.outsider)],
    ['renderDecisionDocument', (log, id) => log.renderDecisionDocument(id, U.outsider)],
  ];

  for (const [name, read] of reads) {
    describe(`GIVEN a proposed decision`, () => {
      describe(`WHEN an outsider calls ${name}`, () => {
        it(`THEN FORBIDDEN 403`, async () => {
          const { log } = await setup();
          const id = proposed(log);
          expectCode(() => read(log, id), 'FORBIDDEN', 403);
        });
      });
    });
  }

  describe('GIVEN a proposed decision', () => {
    describe('WHEN the org identifier reads it', () => {
      it('THEN access is granted', async () => {
        const { log } = await setup();
        const id = proposed(log);
        expect(log.getDecision(id, U.org).id).toBe(id);
      });
    });
  });
});

describe('team admins manage membership; plain members cannot', () => {
  describe('GIVEN a plain member', () => {
    describe('WHEN bob adds a team member', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup();
        expectCode(() => log.addTeamMember({ owner: 'acme', team: 'default', user: 'x@acme.com', role: 'member', actor: U.bob }), 'FORBIDDEN', 403);
      });
    });
  });

  describe('GIVEN the org admin', () => {
    describe('WHEN a member is added with role king', () => {
      it('THEN VALIDATION_ERROR 400', async () => {
        const { log } = await setup();
        expectCode(() => log.addTeamMember({ owner: 'acme', team: 'default', user: 'x@acme.com', role: 'king', actor: U.org }), 'VALIDATION_ERROR', 400);
      });
    });
  });

  describe('GIVEN an existing project PRJ', () => {
    describe('WHEN the org admin creates PRJ again', () => {
      it('THEN CONFLICT 409', async () => {
        const { log } = await setup();
        expectCode(() => log.createProject({ owner: 'acme', identifier: 'PRJ', title: 'dup', actor: U.org }), 'CONFLICT', 409);
      });
    });
  });

  describe('GIVEN a plain member', () => {
    describe('WHEN bob creates a project', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup();
        expectCode(() => log.createProject({ owner: 'acme', identifier: 'ZZ', title: 'x', actor: U.bob }), 'FORBIDDEN', 403);
      });
    });
  });
});

describe('projects live in a team; decisions are visible only to that team', () => {
  async function paymentsTeam() {
    const { log } = await setup();
    log.createTeam({ owner: 'acme', name: 'payments', actor: U.org });
    log.addTeamMember({ owner: 'acme', team: 'payments', user: U.bob, role: 'member', actor: U.org });
    log.createProject({ owner: 'acme', team: 'payments', identifier: 'PAY', title: 'Pay', actor: U.org });
    return log;
  }

  describe('GIVEN a PAY project in team payments', () => {
    describe('WHEN bob creates a decision', () => {
      it('THEN it belongs to team payments', async () => {
        const log = await paymentsTeam();
        const d = log.createDecision({ project: 'PAY', actor: U.bob, title: 'Use Stripe' });
        expect(d.team).toBe('payments');
      });
    });
  });

  describe('GIVEN a payments decision', () => {
    describe('WHEN carol (default team) reads it', () => {
      it('THEN FORBIDDEN 403', async () => {
        const log = await paymentsTeam();
        const d = log.createDecision({ project: 'PAY', actor: U.bob, title: 'Use Stripe' });
        expectCode(() => log.getDecision(d.id, U.carol), 'FORBIDDEN', 403);
      });
    });
  });

  describe('GIVEN the PAY project', () => {
    describe('WHEN alice (default team) creates a decision in it', () => {
      it('THEN FORBIDDEN 403', async () => {
        const log = await paymentsTeam();
        expectCode(() => log.createDecision({ project: 'PAY', actor: U.alice, title: 'x' }), 'FORBIDDEN', 403);
      });
    });
  });
});

describe('every action is audited with before/after state, ip and a verifiable hash chain', () => {
  async function trailAfterCreateProposeApprove() {
    const { log } = await setup();
    const d = draft(log);
    act(log, d.id, U.alice, 'propose', {}, { ip: '10.0.0.1' });
    act(log, d.id, U.lead, 'approve');
    return { log, trail: log.auditTrail({ decision_id: d.id }) };
  }

  describe('GIVEN create, propose and approve', () => {
    describe('WHEN the decision audit trail is read', () => {
      it('THEN it lists the three actions in order', async () => {
        const { trail } = await trailAfterCreateProposeApprove();
        expect(trail.map((e: any) => e.action)).toEqual(['create', 'propose', 'approve']);
      });
    });
  });

  describe('GIVEN a propose from 10.0.0.1', () => {
    describe('WHEN its audit entry is read', () => {
      it('THEN it carries actor, ip and before/after status', async () => {
        const { trail } = await trailAfterCreateProposeApprove();
        const propose = trail[1];
        expect(propose.actor).toBe(U.alice);
        expect(propose.ip).toBe('10.0.0.1');
        expect(propose.before.status).toBe('draft');
        expect(propose.after.status).toBe('proposed');
      });
    });
  });

  describe('GIVEN three audited actions', () => {
    describe('WHEN entry hashes are inspected', () => {
      it('THEN each is sha256 and links to the previous hash', async () => {
        const { trail } = await trailAfterCreateProposeApprove();
        expect(trail[1].hash).toMatch(/^[0-9a-f]{64}$/);
        expect(trail[1].prev_hash).toBe(trail[0].hash);
      });
    });
    describe('WHEN the chain is verified', () => {
      it('THEN it is intact', async () => {
        const { log } = await trailAfterCreateProposeApprove();
        expect(log.verifyAuditChain().ok).toBe(true);
      });
    });
  });
});

describe('audit trail filters by actor and detects tampering', () => {
  describe('GIVEN actions by several actors', () => {
    describe('WHEN the trail is filtered by alice', () => {
      it('THEN only her entries return', async () => {
        // Given
        const { log } = await setup();
        const d = draft(log);
        act(log, d.id, U.alice, 'propose');
        // When
        const mine = log.auditTrail({ actor: U.alice });
        // Then
        expect(mine.every((e: any) => e.actor === U.alice)).toBe(true);
      });
    });
  });

  describe('GIVEN an audit entry whose actor was rewritten', () => {
    describe('WHEN the chain is verified', () => {
      it('THEN it breaks at that entry', async () => {
        // Given
        const { log } = await setup();
        const d = draft(log);
        act(log, d.id, U.alice, 'propose');
        log.store.audit[1].actor = 'mallory@evil.com';
        // When
        const res = log.verifyAuditChain();
        // Then
        expect(res.ok).toBe(false);
        expect(res.broken_at).toBe(log.store.audit[1].seq);
      });
    });
  });
});

describe('failed actions leave state and audit untouched', () => {
  describe('GIVEN a draft', () => {
    describe('WHEN bob fails to propose it', () => {
      it('THEN the audit length is unchanged', async () => {
        // Given
        const { log } = await setup();
        const d = draft(log);
        const before = log.auditTrail({}).length;
        // When
        expectCode(() => act(log, d.id, U.bob, 'propose'), 'FORBIDDEN');
        // Then
        expect(log.auditTrail({}).length).toBe(before);
      });

      it('THEN it is still a draft', async () => {
        const { log } = await setup();
        const d = draft(log);
        expectCode(() => act(log, d.id, U.bob, 'propose'), 'FORBIDDEN');
        expect(log.getDecision(d.id, U.alice).status).toBe('draft');
      });
    });
  });
});

describe('idempotency keys make retries safe', () => {
  const voteOpts = { idempotencyKey: 'vote-alice-prj001' };

  async function bobVoted() {
    const { log } = await setup({ mode: 'consensus_voting' });
    const id = proposed(log);
    const first = act(log, id, U.bob, 'vote', { vote: 'approve' }, voteOpts);
    return { log, id, first };
  }

  describe('GIVEN a vote cast with key K', () => {
    describe('WHEN the same vote is replayed with K', () => {
      it('THEN it is flagged idempotent_replay with the same tally', async () => {
        // Given
        const { log, id, first } = await bobVoted();
        // When
        const again = act(log, id, U.bob, 'vote', { vote: 'approve' }, voteOpts);
        // Then
        expect(again.idempotent_replay).toBe(true);
        expect(first.idempotent_replay).toBeUndefined();
        expect(again.metadata.vote_tally).toEqual(first.metadata.vote_tally);
      });
    });
    describe('WHEN it is replayed', () => {
      it('THEN only one vote is audited', async () => {
        // Given
        const { log, id } = await bobVoted();
        // When
        act(log, id, U.bob, 'vote', { vote: 'approve' }, voteOpts);
        // Then
        expect(log.auditTrail({ decision_id: id }).filter((e: any) => e.action === 'vote').length).toBe(1);
      });
    });
  });

  describe('GIVEN a follow-up assigned with key F', () => {
    describe('WHEN the assignment is replayed with F', () => {
      it('THEN carol has exactly one todo', async () => {
        // Given
        const { log } = await setup();
        const id = proposed(log);
        const fo = { idempotencyKey: 'fu-1' };
        const fu = { title: 'once', assigned_to: U.carol };
        act(log, id, U.alice, 'assign_followup', fu, fo);
        // When
        act(log, id, U.alice, 'assign_followup', fu, fo);
        // Then
        expect(log.listTodos({ user: U.carol }).total).toBe(1);
      });
    });
  });
});

describe('state survives a JSON round trip including id counters and audit chain', () => {
  async function restoredFromJson() {
    const { log } = await setup();
    const id = proposed(log);
    act(log, id, U.lead, 'approve');
    const json = JSON.parse(JSON.stringify(log.store.toJSON()));
    const restored = await buildLog({ store: MemoryStore.fromJSON(json), clock: () => new Date('2024-04-01T00:00:00Z') });
    return { restored, id };
  }

  describe('GIVEN a store serialised to JSON', () => {
    describe('WHEN a log is rebuilt from it', () => {
      it('THEN the decision is still approved', async () => {
        const { restored, id } = await restoredFromJson();
        expect(restored.getDecision(id, U.alice).status).toBe('approved');
      });
    });
  });

  describe('GIVEN a store restored from JSON', () => {
    describe('WHEN the audit chain and integrity are verified', () => {
      it('THEN both hold', async () => {
        const { restored, id } = await restoredFromJson();
        expect(restored.verifyAuditChain().ok).toBe(true);
        expect(restored.verifyIntegrity(id).ok).toBe(true);
      });
    });
    describe('WHEN a new decision is created', () => {
      it('THEN the counter continues at PRJ-002', async () => {
        const { restored } = await restoredFromJson();
        expect(restored.createDecision({ project: 'PRJ', actor: U.alice, title: 'next' }).id).toBe('PRJ-002');
      });
    });
  });
});

describe('audit hashes do not depend on object key order (stores such as jsonb reorder keys)', () => {
  async function reordered() {
    const { log } = await setup();
    const d = draft(log);
    act(log, d.id, U.alice, 'propose');
    return log;
  }

  describe('GIVEN freshly written audit entries', () => {
    describe('WHEN their hash version is read', () => {
      it('THEN every entry carries hv 2', async () => {
        const log = await reordered();
        expect(log.store.audit.every((e: any) => e.hv === 2)).toBe(true);
      });
    });
  });

  describe('GIVEN audit entries whose keys were stored in reverse order', () => {
    describe('WHEN the chain is verified', () => {
      it('THEN it is still valid', async () => {
        // Given
        const log = await reordered();
        log.store.audit = log.store.audit.map((e: any) => Object.fromEntries(Object.entries(e).sort(([a], [b]) => (a < b ? 1 : -1))));
        // When / Then
        expect(log.verifyAuditChain().ok).toBe(true);
      });
    });
  });

  describe('GIVEN reordered entries with a rewritten actor', () => {
    describe('WHEN the chain is verified', () => {
      it('THEN tampering is still detected', async () => {
        // Given
        const log = await reordered();
        log.store.audit = log.store.audit.map((e: any) => Object.fromEntries(Object.entries(e).sort(([a], [b]) => (a < b ? 1 : -1))));
        log.store.audit[0].actor = 'mallory@evil.com';
        // When / Then
        expect(log.verifyAuditChain().ok).toBe(false);
      });
    });
  });
});

describe('chains written before hash versioning (insertion-order hashes) still verify', () => {
  async function legacyChain() {
    const { log } = await setup();
    log.store.audit.length = 0;
    let prev = '0'.repeat(64);
    for (let seq = 1; seq <= 3; seq++) {
      const e: any = { seq, at: '2024-01-01T00:00:00.000Z', actor: 'a', action: 'create', decision_id: null, before: null, after: null, ip: null, detail: null, prev_hash: prev };
      e.hash = sha256(JSON.stringify(e));
      prev = e.hash;
      log.store.audit.push(e);
    }
    return log;
  }

  describe('GIVEN a three-entry legacy chain', () => {
    describe('WHEN it is verified', () => {
      it('THEN it is ok with no break', async () => {
        const log = await legacyChain();
        expect(log.verifyAuditChain()).toEqual({ ok: true, broken_at: null });
      });
    });
  });

  describe('GIVEN a legacy chain with entry 2 altered', () => {
    describe('WHEN it is verified', () => {
      it('THEN it breaks at seq 2', async () => {
        const log = await legacyChain();
        log.store.audit[1].actor = 'mallory';
        expect(log.verifyAuditChain()).toEqual({ ok: false, broken_at: 2 });
      });
    });
  });
});

describe('new entries can extend a legacy chain', () => {
  describe('GIVEN a one-entry legacy chain', () => {
    describe('WHEN a new owner is created', () => {
      it('THEN the new entry is hv 2, linked to the legacy hash, and the chain verifies', async () => {
        // Given
        const { log } = await setup();
        log.store.audit.length = 0;
        const e: any = { seq: 1, at: '2024-01-01T00:00:00.000Z', actor: 'a', action: 'create', decision_id: null, before: null, after: null, ip: null, detail: null, prev_hash: '0'.repeat(64) };
        e.hash = sha256(JSON.stringify(e));
        log.store.audit.push(e);
        // When
        log.createOwner({ identifier: 'newco' });
        // Then
        expect(log.store.audit.at(-1).hv).toBe(2);
        expect(log.store.audit.at(-1).prev_hash).toBe(e.hash);
        expect(log.verifyAuditChain().ok).toBe(true);
      });
    });
  });
});
