import { describe, it, expect } from 'bun:test';
import { setup, draft, proposed, act, expectCode, U, CONTENT_V1 } from './support/index.js';

describe('decision ids increment per project and project count tracks them', () => {
  async function twoProjects() {
    const ctx = await setup();
    ctx.log.createProject({ owner: 'acme', identifier: 'WEB', title: 'Web', actor: U.org });
    return ctx;
  }

  describe('GIVEN one decision in PRJ', () => {
    describe('WHEN a second is created in PRJ', () => {
      it('THEN it is PRJ-002', async () => {
        // Given
        const { log } = await twoProjects();
        expect(draft(log).id).toBe('PRJ-001');
        // When
        const second = draft(log);
        // Then
        expect(second.id).toBe('PRJ-002');
      });
    });
  });

  describe('GIVEN two decisions in PRJ', () => {
    describe('WHEN a decision is created in WEB', () => {
      it('THEN numbering restarts at WEB-001', async () => {
        // Given
        const { log } = await twoProjects();
        draft(log);
        draft(log);
        // When
        const web = draft(log, { project: 'WEB' });
        // Then
        expect(web.id).toBe('WEB-001');
      });
    });
  });

  describe('GIVEN two decisions in PRJ and one in WEB', () => {
    describe('WHEN PRJ is fetched', () => {
      it('THEN its decision_count is 2', async () => {
        // Given
        const { log } = await twoProjects();
        draft(log);
        draft(log);
        draft(log, { project: 'WEB' });
        // When
        const project = log.getProject('PRJ');
        // Then
        expect(project.decision_count).toBe(2);
      });
    });
    describe('WHEN WEB is fetched', () => {
      it('THEN its decision_count is 1', async () => {
        // Given
        const { log } = await twoProjects();
        draft(log);
        draft(log);
        draft(log, { project: 'WEB' });
        // When
        const project = log.getProject('WEB');
        // Then
        expect(project.decision_count).toBe(1);
      });
    });
  });
});

describe('new decision is an owned draft with the default template when no content given', () => {
  describe('GIVEN a project', () => {
    describe('WHEN alice creates a decision with only a title', () => {
      it('THEN it is a draft she owns in team default as number 1', async () => {
        // Given
        const { log } = await setup();
        // When
        const d = log.createDecision({ project: 'PRJ', actor: U.alice, title: 'Pick a queue' });
        // Then
        expect(d.status).toBe('draft');
        expect(d.owner).toBe(U.alice);
        expect(d.number).toBe(1);
        expect(d.team).toBe('default');
      });
    });
    describe('WHEN a decision is created without content', () => {
      it('THEN the default template sections are present', async () => {
        // Given
        const { log } = await setup();
        // When
        const d = log.createDecision({ project: 'PRJ', actor: U.alice, title: 'Pick a queue' });
        // Then
        for (const h of ['## Context', '## Decision', '## Alternatives Considered', '## Consequences', '## Follow-up Actions']) {
          expect(d.content, `template missing ${h}`).toContain(h);
        }
      });
    });
  });

  describe('GIVEN a freshly created decision', () => {
    describe('WHEN participants are listed', () => {
      it('THEN only the owner appears, with the owner role', async () => {
        // Given
        const { log } = await setup();
        const d = log.createDecision({ project: 'PRJ', actor: U.alice, title: 'Pick a queue' });
        // When
        const people = log.getParticipants(d.id, U.alice);
        // Then
        expect(people.map((p: any) => p.user)).toEqual([U.alice]);
        expect(people[0].roles).toContain('owner');
      });
    });
  });
});

describe('creation validation and permissions', () => {
  describe('GIVEN an outsider', () => {
    describe('WHEN creating a decision', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup();
        expectCode(() => draft(log, { actor: U.outsider }), 'FORBIDDEN', 403);
      });
    });
  });

  describe('GIVEN an unknown project', () => {
    describe('WHEN creating a decision', () => {
      it('THEN NOT_FOUND 404', async () => {
        const { log } = await setup();
        expectCode(() => draft(log, { project: 'NOPE' }), 'NOT_FOUND', 404);
      });
    });
  });

  describe('GIVEN a whitespace-only title', () => {
    describe('WHEN creating a decision', () => {
      it('THEN VALIDATION_ERROR 400', async () => {
        const { log } = await setup();
        expectCode(() => draft(log, { title: '  ' }), 'VALIDATION_ERROR', 400);
      });
    });
  });
});

describe('drafts are editable by the owner only; updated_at does not move on content edits', () => {
  describe('GIVEN a draft one hour old', () => {
    describe('WHEN the owner edits title and content', () => {
      it('THEN both change', async () => {
        // Given
        const { log, clock } = await setup();
        const d = draft(log);
        clock.advanceHours(1);
        // When
        const edited = log.updateDraft(d.id, U.alice, { title: 'New title', content: 'edited' });
        // Then
        expect(edited.title).toBe('New title');
        expect(edited.content).toBe('edited');
      });
    });
    describe('WHEN the owner edits it', () => {
      it('THEN updated_at does not move', async () => {
        // Given
        const { log, clock } = await setup();
        const d = draft(log);
        clock.advanceHours(1);
        // When
        const edited = log.updateDraft(d.id, U.alice, { title: 'New title', content: 'edited' });
        // Then
        expect(edited.updated_at).toBe(d.updated_at);
      });
    });
  });

  describe('GIVEN a draft owned by alice', () => {
    describe('WHEN bob edits it', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup();
        const d = draft(log);
        expectCode(() => log.updateDraft(d.id, U.bob, { content: 'x' }), 'FORBIDDEN', 403);
      });
    });
  });
});

describe('propose locks content, hashes it with sha256 and snapshots revision 1', () => {
  async function proposeAfterTwoHours() {
    const { log, clock } = await setup();
    const d = draft(log);
    clock.advanceHours(2);
    const r = act(log, d.id, U.alice, 'propose');
    return { log, d, r };
  }

  describe('GIVEN a draft', () => {
    describe('WHEN the owner proposes', () => {
      it('THEN the response reports a successful propose that yields status proposed', async () => {
        // Given / When
        const { r } = await proposeAfterTwoHours();
        // Then
        expect(r.success).toBe(true);
        expect(r.status_code).toBe(200);
        expect(r.action_performed).toBe('propose');
        expect(r.decision.status).toBe('proposed');
      });

      it('THEN content is locked with a sha256 hash at revision 1', async () => {
        // Given / When
        const { r } = await proposeAfterTwoHours();
        // Then
        expect(r.decision.content_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(r.decision.proposed_at).toBeTruthy();
        expect(r.decision.immutable_from).toBeTruthy();
        expect(r.decision.current_revision).toBe(1);
      });

      it('THEN metadata records the draft to proposed transition and updated_at moves', async () => {
        // Given / When
        const { r, d } = await proposeAfterTwoHours();
        // Then
        expect(r.metadata.previous_state).toBe('draft');
        expect(r.metadata.new_state).toBe('proposed');
        expect(r.decision.updated_at).not.toBe(d.updated_at);
      });

      it('THEN exactly one version snapshot exists', async () => {
        // Given / When
        const { log, d } = await proposeAfterTwoHours();
        // Then
        expect(log.getVersions(d.id, U.alice).length).toBe(1);
      });
    });
  });
});

describe('propose may carry final content; only the owner may propose', () => {
  describe('GIVEN a draft', () => {
    describe('WHEN bob proposes it', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup();
        const d = draft(log);
        expectCode(() => act(log, d.id, U.bob, 'propose'), 'FORBIDDEN', 403);
      });
    });
    describe('WHEN the owner proposes with final content', () => {
      it('THEN the decision carries that content', async () => {
        // Given
        const { log } = await setup();
        const d = draft(log);
        // When
        const r = act(log, d.id, U.alice, 'propose', { content: '## Decision\nFinal wording' });
        // Then
        expect(r.decision.content).toBe('## Decision\nFinal wording');
      });
    });
  });
});

describe('content cannot be edited or deleted once proposed', () => {
  describe('GIVEN a proposed decision', () => {
    describe('WHEN the owner edits content', () => {
      it('THEN IMMUTABLE_CONTENT 409', async () => {
        const { log } = await setup();
        const id = proposed(log);
        expectCode(() => log.updateDraft(id, U.alice, { content: 'sneaky' }), 'IMMUTABLE_CONTENT', 409);
      });
    });
    describe('WHEN the owner deletes it', () => {
      it('THEN INVALID_STATE 409', async () => {
        const { log } = await setup();
        const id = proposed(log);
        expectCode(() => log.deleteDraft(id, U.alice), 'INVALID_STATE', 409);
      });
    });
  });
});

describe('only drafts can be deleted, and only by their owner', () => {
  describe('GIVEN a draft owned by alice', () => {
    describe('WHEN bob deletes it', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup();
        const d = draft(log);
        expectCode(() => log.deleteDraft(d.id, U.bob), 'FORBIDDEN', 403);
      });
    });
    describe('WHEN alice deletes it', () => {
      it('THEN fetching it is NOT_FOUND 404', async () => {
        // Given
        const { log } = await setup();
        const d = draft(log);
        // When
        log.deleteDraft(d.id, U.alice);
        // Then
        expectCode(() => log.getDecision(d.id, U.alice), 'NOT_FOUND', 404);
      });
    });
  });
});

describe('unknown actions and wrong-state actions give actionable errors', () => {
  describe('GIVEN a draft', () => {
    describe('WHEN an unknown action is performed', () => {
      it('THEN UNKNOWN_ACTION 400', async () => {
        const { log } = await setup();
        const d = draft(log);
        expectCode(() => act(log, d.id, U.alice, 'teleport'), 'UNKNOWN_ACTION', 400);
      });
    });
    describe('WHEN the lead approves it', () => {
      it('THEN INVALID_STATE 409 listing propose as allowed from state draft', async () => {
        // Given
        const { log } = await setup();
        const d = draft(log);
        // When
        const e = expectCode(() => act(log, d.id, U.lead, 'approve'), 'INVALID_STATE', 409);
        // Then
        expect(e.details.allowed_actions).toContain('propose');
        expect(e.details.current_state).toBe('draft');
      });
    });
  });

  describe('GIVEN no such decision', () => {
    describe('WHEN an action targets PRJ-999', () => {
      it('THEN NOT_FOUND 404', async () => {
        const { log } = await setup();
        expectCode(() => act(log, 'PRJ-999', U.alice, 'propose'), 'NOT_FOUND', 404);
      });
    });
  });
});

describe('single approval: a lead approves, content and hash are untouched', () => {
  async function approveAfterFiveHours() {
    const { log, clock } = await setup();
    const id = proposed(log);
    const before = log.getDecision(id, U.alice);
    clock.advanceHours(5);
    const r = act(log, id, U.lead, 'approve', { comment: 'Ship it' });
    return { log, id, before, r };
  }

  describe('GIVEN a proposed decision', () => {
    describe('WHEN the lead approves', () => {
      it('THEN it is approved with 200 and an approved_at', async () => {
        const { r } = await approveAfterFiveHours();
        expect(r.status_code).toBe(200);
        expect(r.decision.status).toBe('approved');
        expect(r.decision.approved_at).toBeTruthy();
      });

      it('THEN content and hash are unchanged', async () => {
        const { r, before } = await approveAfterFiveHours();
        expect(r.decision.content).toBe(before.content);
        expect(r.decision.content_hash).toBe(before.content_hash);
      });

      it('THEN the lead is the sole timestamped approver and integrity holds', async () => {
        const { r, log, id } = await approveAfterFiveHours();
        expect(r.decision.approvers.map((a: any) => a.user)).toEqual([U.lead]);
        expect(r.decision.approvers[0].approved_at).toBeTruthy();
        expect(log.verifyIntegrity(id).ok).toBe(true);
      });
    });
  });
});

describe('approving an approved decision suggests superseding', () => {
  describe('GIVEN an approved decision', () => {
    describe('WHEN the lead approves again', () => {
      it('THEN INVALID_STATE 409 from state approved offering create_superseding_decision', async () => {
        // Given
        const { log } = await setup();
        const id = proposed(log);
        act(log, id, U.lead, 'approve');
        // When
        const e = expectCode(() => act(log, id, U.lead, 'approve'), 'INVALID_STATE', 409);
        // Then
        expect(e.details.current_state).toBe('approved');
        expect(e.details.alternatives.some((a: any) => a.action === 'create_superseding_decision')).toBe(true);
      });
    });
  });
});

describe('decline needs a reason, stores it outside the document and allows return to draft', () => {
  async function proposedDecision() {
    const { log } = await setup();
    return { log, id: proposed(log) };
  }

  describe('GIVEN a proposed decision', () => {
    describe('WHEN the lead declines without a reason', () => {
      it('THEN VALIDATION_ERROR 400', async () => {
        const { log, id } = await proposedDecision();
        expectCode(() => act(log, id, U.lead, 'decline'), 'VALIDATION_ERROR', 400);
      });
    });
    describe('WHEN the lead declines with a reason', () => {
      it('THEN it is declined and the reason is attributed to the lead', async () => {
        // Given
        const { log, id } = await proposedDecision();
        // When
        const r = act(log, id, U.lead, 'decline', { reason: 'Too risky without rollback plan' });
        // Then
        expect(r.decision.status).toBe('declined');
        expect(r.decision.decline.reason).toBe('Too risky without rollback plan');
        expect(r.decision.decline.by).toBe(U.lead);
      });

      it('THEN the reason is kept out of the document content', async () => {
        const { log, id } = await proposedDecision();
        const r = act(log, id, U.lead, 'decline', { reason: 'Too risky without rollback plan' });
        expect(r.decision.content.includes('Too risky')).toBe(false);
      });
    });
  });

  describe('GIVEN a declined decision', () => {
    describe('WHEN bob returns it to draft', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log, id } = await proposedDecision();
        act(log, id, U.lead, 'decline', { reason: 'Too risky without rollback plan' });
        expectCode(() => act(log, id, U.bob, 'return_to_draft'), 'FORBIDDEN', 403);
      });
    });
    describe('WHEN the owner returns it to draft', () => {
      it('THEN its status is draft', async () => {
        // Given
        const { log, id } = await proposedDecision();
        act(log, id, U.lead, 'decline', { reason: 'Too risky without rollback plan' });
        // When
        const back = act(log, id, U.alice, 'return_to_draft');
        // Then
        expect(back.decision.status).toBe('draft');
      });
    });
  });

  describe('GIVEN a declined decision returned to draft', () => {
    describe('WHEN the owner reworks the content', () => {
      it('THEN the declined version is preserved', async () => {
        // Given
        const { log, id } = await proposedDecision();
        act(log, id, U.lead, 'decline', { reason: 'Too risky without rollback plan' });
        act(log, id, U.alice, 'return_to_draft');
        // When
        log.updateDraft(id, U.alice, { content: 'reworked' });
        // Then
        const versions = log.getVersions(id, U.alice);
        expect(versions.length).toBe(1);
        expect(versions[0].content).toBe(CONTENT_V1);
      });
    });
  });
});

describe('superseding creates a linked draft; original is marked once the new one is approved', () => {
  async function approved() {
    const { log } = await setup();
    const id = proposed(log);
    act(log, id, U.lead, 'approve');
    return { log, id };
  }

  describe('GIVEN a proposed (not yet approved) decision', () => {
    describe('WHEN bob creates a superseding decision', () => {
      it('THEN INVALID_STATE 409', async () => {
        const { log } = await setup();
        const id = proposed(log);
        expectCode(() => act(log, id, U.bob, 'create_superseding_decision', { title: 'x' }), 'INVALID_STATE', 409);
      });
    });
  });

  describe('GIVEN an approved decision', () => {
    describe('WHEN bob creates a superseding decision', () => {
      it('THEN a PRJ-002 draft owned by bob links back with 201', async () => {
        // Given
        const { log, id } = await approved();
        // When
        const r = act(log, id, U.bob, 'create_superseding_decision', { title: 'Use CockroachDB instead', content: 'new' });
        // Then
        expect(r.status_code).toBe(201);
        expect(r.decision.id).toBe('PRJ-002');
        expect(r.decision.status).toBe('draft');
        expect(r.decision.owner).toBe(U.bob);
        expect(r.decision.supersedes_id).toBe(id);
      });
    });
    describe('WHEN a superseding draft is created', () => {
      it('THEN the original is not yet marked superseded', async () => {
        // Given
        const { log, id } = await approved();
        // When
        act(log, id, U.bob, 'create_superseding_decision', { title: 'Use CockroachDB instead', content: 'new' });
        // Then
        expect(log.getDecision(id, U.bob).is_superseded).toBe(false);
      });
    });
  });

  describe('GIVEN a proposed superseding decision', () => {
    describe('WHEN the lead approves it', () => {
      it('THEN the original is marked superseded yet stays approved', async () => {
        // Given
        const { log, id } = await approved();
        const next = act(log, id, U.bob, 'create_superseding_decision', { title: 'Use CockroachDB instead', content: 'new' }).decision;
        act(log, next.id, U.bob, 'propose');
        // When
        act(log, next.id, U.lead, 'approve');
        // Then
        const old = log.getDecision(id, U.bob);
        expect(old.is_superseded).toBe(true);
        expect(old.superseded_by_id).toBe('PRJ-002');
        expect(old.status).toBe('approved');
      });

      it('THEN PRJ-002 has a supersedes link to the original', async () => {
        // Given
        const { log, id } = await approved();
        const next = act(log, id, U.bob, 'create_superseding_decision', { title: 'Use CockroachDB instead', content: 'new' }).decision;
        act(log, next.id, U.bob, 'propose');
        // When
        act(log, next.id, U.lead, 'approve');
        // Then
        expect(log.getRelated('PRJ-002', U.bob).some((x: any) => x.related_decision_id === id && x.type === 'supersedes')).toBe(true);
      });
    });
  });
});

describe('integrity check detects tampering and records a violation', () => {
  describe('GIVEN an untouched proposed decision', () => {
    describe('WHEN integrity is verified', () => {
      it('THEN ok', async () => {
        const { log } = await setup();
        const id = proposed(log);
        expect(log.verifyIntegrity(id).ok).toBe(true);
      });
    });
  });

  describe('GIVEN a proposed decision whose stored content was altered', () => {
    describe('WHEN integrity is verified', () => {
      it('THEN it fails with differing hashes', async () => {
        // Given
        const { log } = await setup();
        const id = proposed(log);
        log.store.decisions.get(id).content = 'tampered';
        // When
        const res = log.verifyIntegrity(id);
        // Then
        expect(res.ok).toBe(false);
        expect(res.expected_hash).not.toBe(res.current_hash);
      });

      it('THEN an integrity_violation audit entry is recorded', async () => {
        // Given
        const { log } = await setup();
        const id = proposed(log);
        log.store.decisions.get(id).content = 'tampered';
        // When
        log.verifyIntegrity(id);
        // Then
        expect(log.auditTrail({ decision_id: id }).some((e: any) => e.action === 'integrity_violation')).toBe(true);
      });
    });
  });
});

describe('renderDecisionDocument produces the standard header, approvers and sections', () => {
  describe('GIVEN an approved decision', () => {
    describe('WHEN the document is rendered', () => {
      it('THEN it has the standard header, status, dates, owner, approver line and sections', async () => {
        // Given
        const { log } = await setup();
        const id = proposed(log);
        act(log, id, U.lead, 'approve');
        // When
        const md = log.renderDecisionDocument(id, U.alice);
        // Then
        expect(md).toMatch(/^# PRJ-001: Migrate to new database/);
        expect(md).toMatch(/- Status: Approved/);
        expect(md).toMatch(/- Date Created: 2024-03-20/);
        expect(md).toMatch(/- Owner: alice@acme.com/);
        expect(md).toMatch(/lead@acme.com - Approved on 2024-03-20/);
        expect(md).toMatch(/## Decision/);
      });
    });
  });
});
