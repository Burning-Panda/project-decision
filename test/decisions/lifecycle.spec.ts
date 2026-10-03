import { describe, it, expect, beforeEach } from 'bun:test';
import { freshLog, proposedIn, draft, proposed, act, expectCode, U, CONTENT_V1, type LogHandle } from '../support/index';

// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.
// Actions expected to fail are captured as a thunk in WHEN and invoked by expectCode in THEN.
// THEN may call read-only queries (getDecision, getVersions, ...) to observe the outcome.

describe('decision ids increment per project and project count tracks them', () => {
  /** A fresh log with a second project, WEB. */
  function twoProjects() {
    const h = freshLog();
    beforeEach(() => { h.log.createProject({ owner: 'acme', identifier: 'WEB', title: 'Web', actor: U.org }); });
    return h;
  }

  describe('GIVEN one decision in PRJ', () => {
    const h = twoProjects();
    let first: any;
    beforeEach(() => { first = draft(h.log); });

    describe('WHEN a second is created in PRJ', () => {
      let second: any;
      beforeEach(() => { second = draft(h.log); });

      it('THEN the first is PRJ-001 and the second PRJ-002', () => {
        expect(first.id).toBe('PRJ-001');
        expect(second.id).toBe('PRJ-002');
      });
    });
  });

  describe('GIVEN two decisions in PRJ', () => {
    const h = twoProjects();
    beforeEach(() => { draft(h.log); draft(h.log); });

    describe('WHEN a decision is created in WEB', () => {
      let web: any;
      beforeEach(() => { web = draft(h.log, { project: 'WEB' }); });

      it('THEN numbering restarts at WEB-001', () => {
        expect(web.id).toBe('WEB-001');
      });
    });
  });

  describe('GIVEN two decisions in PRJ and one in WEB', () => {
    const h = twoProjects();
    beforeEach(() => { draft(h.log); draft(h.log); draft(h.log, { project: 'WEB' }); });

    describe('WHEN PRJ is fetched', () => {
      let project: any;
      beforeEach(() => { project = h.log.getProject('PRJ'); });

      it('THEN its decision_count is 2', () => {
        expect(project.decision_count).toBe(2);
      });
    });

    describe('WHEN WEB is fetched', () => {
      let project: any;
      beforeEach(() => { project = h.log.getProject('WEB'); });

      it('THEN its decision_count is 1', () => {
        expect(project.decision_count).toBe(1);
      });
    });
  });
});

describe('new decision is an owned draft with the default template when no content given', () => {
  describe('GIVEN a project', () => {
    const h = freshLog();

    describe('WHEN alice creates a decision with only a title', () => {
      let d: any;
      beforeEach(() => { d = h.log.createDecision({ project: 'PRJ', actor: U.alice, title: 'Pick a queue' }); });

      it('THEN it is a draft she owns in team default as number 1', () => {
        expect(d.status).toBe('draft');
        expect(d.owner).toBe(U.alice);
        expect(d.number).toBe(1);
        expect(d.team).toBe('default');
      });

      it('THEN the default template sections are present', () => {
        for (const heading of ['## Context', '## Decision', '## Alternatives Considered', '## Consequences', '## Follow-up Actions']) {
          expect(d.content, `template missing ${heading}`).toContain(heading);
        }
      });
    });
  });

  describe('GIVEN a freshly created decision', () => {
    const h = freshLog();
    let id: string;
    beforeEach(() => { id = h.log.createDecision({ project: 'PRJ', actor: U.alice, title: 'Pick a queue' }).id; });

    describe('WHEN participants are listed', () => {
      let people: any[];
      beforeEach(() => { people = h.log.getParticipants(id, U.alice); });

      it('THEN only the owner appears, with the owner role', () => {
        expect(people.map((p) => p.user)).toEqual([U.alice]);
        expect(people[0].roles).toContain('owner');
      });
    });
  });
});

describe('creation validation and permissions', () => {
  describe('GIVEN a project', () => {
    const h = freshLog();

    describe('WHEN an outsider creates a decision', () => {
      let create: () => unknown;
      beforeEach(() => { create = () => draft(h.log, { actor: U.outsider }); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(create, 'FORBIDDEN', 403);
      });
    });

    describe('WHEN a decision is created in an unknown project', () => {
      let create: () => unknown;
      beforeEach(() => { create = () => draft(h.log, { project: 'NOPE' }); });

      it('THEN NOT_FOUND 404', () => {
        expectCode(create, 'NOT_FOUND', 404);
      });
    });

    describe('WHEN a decision is created with a whitespace-only title', () => {
      let create: () => unknown;
      beforeEach(() => { create = () => draft(h.log, { title: '  ' }); });

      it('THEN VALIDATION_ERROR 400', () => {
        expectCode(create, 'VALIDATION_ERROR', 400);
      });
    });
  });
});

describe('drafts are editable by the owner only; updated_at does not move on content edits', () => {
  describe('GIVEN alice\'s draft, one hour old', () => {
    const h = freshLog();
    let d: any;
    beforeEach(() => {
      d = draft(h.log);
      h.clock.advanceHours(1);
    });

    describe('WHEN alice edits title and content', () => {
      let edited: any;
      beforeEach(() => { edited = h.log.updateDraft(d.id, U.alice, { title: 'New title', content: 'edited' }); });

      it('THEN both change', () => {
        expect(edited.title).toBe('New title');
        expect(edited.content).toBe('edited');
      });

      it('THEN updated_at does not move', () => {
        expect(edited.updated_at).toBe(d.updated_at);
      });
    });

    describe('WHEN bob edits it', () => {
      let edit: () => unknown;
      beforeEach(() => { edit = () => h.log.updateDraft(d.id, U.bob, { content: 'x' }); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(edit, 'FORBIDDEN', 403);
      });
    });
  });
});

describe('propose locks content, hashes it with sha256 and snapshots revision 1', () => {
  describe('GIVEN a draft two hours old', () => {
    const h = freshLog();
    let d: any;
    beforeEach(() => {
      d = draft(h.log);
      h.clock.advanceHours(2);
    });

    describe('WHEN the owner proposes', () => {
      let r: any;
      beforeEach(() => { r = act(h.log, d.id, U.alice, 'propose'); });

      it('THEN the response reports a successful propose that yields status proposed', () => {
        expect(r.success).toBe(true);
        expect(r.status_code).toBe(200);
        expect(r.action_performed).toBe('propose');
        expect(r.decision.status).toBe('proposed');
      });

      it('THEN content is locked with a sha256 hash at revision 1', () => {
        expect(r.decision.content_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(r.decision.proposed_at).toBeTruthy();
        expect(r.decision.immutable_from).toBeTruthy();
        expect(r.decision.current_revision).toBe(1);
      });

      it('THEN metadata records the draft to proposed transition and updated_at moves', () => {
        expect(r.metadata.previous_state).toBe('draft');
        expect(r.metadata.new_state).toBe('proposed');
        expect(r.decision.updated_at).not.toBe(d.updated_at);
      });

      it('THEN exactly one version snapshot exists', () => {
        expect(h.log.getVersions(d.id, U.alice).length).toBe(1);
      });
    });
  });
});

describe('propose may carry final content; only the owner may propose', () => {
  describe('GIVEN alice\'s draft', () => {
    const h = freshLog();
    let d: any;
    beforeEach(() => { d = draft(h.log); });

    describe('WHEN bob proposes it', () => {
      let propose: () => unknown;
      beforeEach(() => { propose = () => act(h.log, d.id, U.bob, 'propose'); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(propose, 'FORBIDDEN', 403);
      });
    });

    describe('WHEN alice proposes with final content', () => {
      let r: any;
      beforeEach(() => { r = act(h.log, d.id, U.alice, 'propose', { content: '## Decision\nFinal wording' }); });

      it('THEN the decision carries that content', () => {
        expect(r.decision.content).toBe('## Decision\nFinal wording');
      });
    });
  });
});

describe('content cannot be edited or deleted once proposed', () => {
  describe('GIVEN a proposed decision', () => {
    const h = freshLog();
    let id: string;
    beforeEach(() => { id = proposed(h.log); });

    describe('WHEN the owner edits content', () => {
      let edit: () => unknown;
      beforeEach(() => { edit = () => h.log.updateDraft(id, U.alice, { content: 'sneaky' }); });

      it('THEN IMMUTABLE_CONTENT 409', () => {
        expectCode(edit, 'IMMUTABLE_CONTENT', 409);
      });
    });

    describe('WHEN the owner deletes it', () => {
      let remove: () => unknown;
      beforeEach(() => { remove = () => h.log.deleteDraft(id, U.alice); });

      it('THEN INVALID_STATE 409', () => {
        expectCode(remove, 'INVALID_STATE', 409);
      });
    });
  });
});

describe('only drafts can be deleted, and only by their owner', () => {
  describe('GIVEN a draft owned by alice', () => {
    const h = freshLog();
    let d: any;
    beforeEach(() => { d = draft(h.log); });

    describe('WHEN bob deletes it', () => {
      let remove: () => unknown;
      beforeEach(() => { remove = () => h.log.deleteDraft(d.id, U.bob); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(remove, 'FORBIDDEN', 403);
      });
    });

    describe('WHEN alice deletes it', () => {
      beforeEach(() => { h.log.deleteDraft(d.id, U.alice); });

      it('THEN fetching it is NOT_FOUND 404', () => {
        expectCode(() => h.log.getDecision(d.id, U.alice), 'NOT_FOUND', 404);
      });
    });
  });
});

describe('unknown actions and wrong-state actions give actionable errors', () => {
  describe('GIVEN a draft', () => {
    const h = freshLog();
    let d: any;
    beforeEach(() => { d = draft(h.log); });

    describe('WHEN an unknown action is performed', () => {
      let perform: () => unknown;
      beforeEach(() => { perform = () => act(h.log, d.id, U.alice, 'teleport'); });

      it('THEN UNKNOWN_ACTION 400', () => {
        expectCode(perform, 'UNKNOWN_ACTION', 400);
      });
    });

    describe('WHEN the lead approves it', () => {
      let approve: () => unknown;
      beforeEach(() => { approve = () => act(h.log, d.id, U.lead, 'approve'); });

      it('THEN INVALID_STATE 409 listing propose as allowed from state draft', () => {
        const e = expectCode(approve, 'INVALID_STATE', 409);
        expect(e.details.allowed_actions).toContain('propose');
        expect(e.details.current_state).toBe('draft');
      });
    });
  });

  describe('GIVEN no such decision', () => {
    const h = freshLog();

    describe('WHEN an action targets PRJ-999', () => {
      let perform: () => unknown;
      beforeEach(() => { perform = () => act(h.log, 'PRJ-999', U.alice, 'propose'); });

      it('THEN NOT_FOUND 404', () => {
        expectCode(perform, 'NOT_FOUND', 404);
      });
    });
  });
});

describe('single approval: a lead approves, content and hash are untouched', () => {
  describe('GIVEN a decision proposed five hours ago', () => {
    const h = freshLog();
    let id: string;
    let before: any;
    beforeEach(() => {
      id = proposed(h.log);
      before = h.log.getDecision(id, U.alice);
      h.clock.advanceHours(5);
    });

    describe('WHEN the lead approves', () => {
      let r: any;
      beforeEach(() => { r = act(h.log, id, U.lead, 'approve', { comment: 'Ship it' }); });

      it('THEN it is approved with 200 and an approved_at', () => {
        expect(r.status_code).toBe(200);
        expect(r.decision.status).toBe('approved');
        expect(r.decision.approved_at).toBeTruthy();
      });

      it('THEN content and hash are unchanged', () => {
        expect(r.decision.content).toBe(before.content);
        expect(r.decision.content_hash).toBe(before.content_hash);
      });

      it('THEN the lead is the sole timestamped approver and integrity holds', () => {
        expect(r.decision.approvers.map((a: any) => a.user)).toEqual([U.lead]);
        expect(r.decision.approvers[0].approved_at).toBeTruthy();
        expect(h.log.verifyIntegrity(id).ok).toBe(true);
      });
    });
  });
});

describe('approving an approved decision suggests superseding', () => {
  describe('GIVEN an approved decision', () => {
    const h = freshLog();
    let id: string;
    beforeEach(() => {
      id = proposed(h.log);
      act(h.log, id, U.lead, 'approve');
    });

    describe('WHEN the lead approves again', () => {
      let approve: () => unknown;
      beforeEach(() => { approve = () => act(h.log, id, U.lead, 'approve'); });

      it('THEN INVALID_STATE 409 from state approved offering create_superseding_decision', () => {
        const e = expectCode(approve, 'INVALID_STATE', 409);
        expect(e.details.current_state).toBe('approved');
        expect(e.details.alternatives.some((a: any) => a.action === 'create_superseding_decision')).toBe(true);
      });
    });
  });
});

describe('decline needs a reason, stores it outside the document and allows return to draft', () => {
  const REASON = 'Too risky without rollback plan';

  describe('GIVEN a proposed decision', () => {
    const h = freshLog();
    let id: string;
    beforeEach(() => { id = proposed(h.log); });

    describe('WHEN the lead declines without a reason', () => {
      let decline: () => unknown;
      beforeEach(() => { decline = () => act(h.log, id, U.lead, 'decline'); });

      it('THEN VALIDATION_ERROR 400', () => {
        expectCode(decline, 'VALIDATION_ERROR', 400);
      });
    });

    describe('WHEN the lead declines with a reason', () => {
      let r: any;
      beforeEach(() => { r = act(h.log, id, U.lead, 'decline', { reason: REASON }); });

      it('THEN it is declined and the reason is attributed to the lead', () => {
        expect(r.decision.status).toBe('declined');
        expect(r.decision.decline.reason).toBe(REASON);
        expect(r.decision.decline.by).toBe(U.lead);
      });

      it('THEN the reason is kept out of the document content', () => {
        expect(r.decision.content).not.toContain('Too risky');
      });
    });
  });

  describe('GIVEN a declined decision', () => {
    const h = freshLog();
    let id: string;
    beforeEach(() => {
      id = proposed(h.log);
      act(h.log, id, U.lead, 'decline', { reason: REASON });
    });

    describe('WHEN bob returns it to draft', () => {
      let reopen: () => unknown;
      beforeEach(() => { reopen = () => act(h.log, id, U.bob, 'return_to_draft'); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(reopen, 'FORBIDDEN', 403);
      });
    });

    describe('WHEN the owner returns it to draft', () => {
      let r: any;
      beforeEach(() => { r = act(h.log, id, U.alice, 'return_to_draft'); });

      it('THEN its status is draft', () => {
        expect(r.decision.status).toBe('draft');
      });
    });
  });

  describe('GIVEN a declined decision returned to draft', () => {
    const h = freshLog();
    let id: string;
    beforeEach(() => {
      id = proposed(h.log);
      act(h.log, id, U.lead, 'decline', { reason: REASON });
      act(h.log, id, U.alice, 'return_to_draft');
    });

    describe('WHEN the owner reworks the content', () => {
      beforeEach(() => { h.log.updateDraft(id, U.alice, { content: 'reworked' }); });

      it('THEN the declined version is preserved', () => {
        const versions = h.log.getVersions(id, U.alice);
        expect(versions.length).toBe(1);
        expect(versions[0].content).toBe(CONTENT_V1);
      });
    });
  });
});

describe('superseding creates a linked draft; original is marked once the new one is approved', () => {
  const SUCCESSOR = { title: 'Use CockroachDB instead', content: 'new' };

  /** A fresh log whose PRJ-001 is approved. */
  function approved() {
    const h = freshLog() as LogHandle & { id: string };
    beforeEach(() => {
      h.id = proposed(h.log);
      act(h.log, h.id, U.lead, 'approve');
    });
    return h;
  }

  describe('GIVEN a proposed (not yet approved) decision', () => {
    const h = freshLog();
    let id: string;
    beforeEach(() => { id = proposed(h.log); });

    describe('WHEN bob creates a superseding decision', () => {
      let supersede: () => unknown;
      beforeEach(() => { supersede = () => act(h.log, id, U.bob, 'create_superseding_decision', { title: 'x' }); });

      it('THEN INVALID_STATE 409', () => {
        expectCode(supersede, 'INVALID_STATE', 409);
      });
    });
  });

  describe('GIVEN an approved decision', () => {
    const h = approved();

    describe('WHEN bob creates a superseding decision', () => {
      let r: any;
      beforeEach(() => { r = act(h.log, h.id, U.bob, 'create_superseding_decision', SUCCESSOR); });

      it('THEN a PRJ-002 draft owned by bob links back with 201', () => {
        expect(r.status_code).toBe(201);
        expect(r.decision.id).toBe('PRJ-002');
        expect(r.decision.status).toBe('draft');
        expect(r.decision.owner).toBe(U.bob);
        expect(r.decision.supersedes_id).toBe(h.id);
      });

      it('THEN the original is not yet marked superseded', () => {
        expect(h.log.getDecision(h.id, U.bob).is_superseded).toBe(false);
      });
    });
  });

  describe('GIVEN a proposed superseding decision', () => {
    const h = approved();
    let next: any;
    beforeEach(() => {
      next = act(h.log, h.id, U.bob, 'create_superseding_decision', SUCCESSOR).decision;
      act(h.log, next.id, U.bob, 'propose');
    });

    describe('WHEN the lead approves it', () => {
      beforeEach(() => { act(h.log, next.id, U.lead, 'approve'); });

      it('THEN the original is marked superseded yet stays approved', () => {
        const old = h.log.getDecision(h.id, U.bob);
        expect(old.is_superseded).toBe(true);
        expect(old.superseded_by_id).toBe('PRJ-002');
        expect(old.status).toBe('approved');
      });

      it('THEN PRJ-002 has a supersedes link to the original', () => {
        const related = h.log.getRelated('PRJ-002', U.bob);
        expect(related.some((x: any) => x.related_decision_id === h.id && x.type === 'supersedes')).toBe(true);
      });
    });
  });
});

describe('integrity check detects tampering and records a violation', () => {
  describe('GIVEN an untouched proposed decision', () => {
    const h = freshLog();
    let id: string;
    beforeEach(() => { id = proposed(h.log); });

    describe('WHEN integrity is verified', () => {
      let res: any;
      beforeEach(() => { res = h.log.verifyIntegrity(id); });

      it('THEN ok', () => {
        expect(res.ok).toBe(true);
      });
    });
  });

  describe('GIVEN a proposed decision whose stored content was altered', () => {
    const h = freshLog();
    let id: string;
    beforeEach(() => {
      id = proposed(h.log);
      h.log.store.decisions.get(id).content = 'tampered';
    });

    describe('WHEN integrity is verified', () => {
      let res: any;
      beforeEach(() => { res = h.log.verifyIntegrity(id); });

      it('THEN it fails with differing hashes', () => {
        expect(res.ok).toBe(false);
        expect(res.expected_hash).not.toBe(res.current_hash);
      });

      it('THEN an integrity_violation audit entry is recorded', () => {
        expect(h.log.auditTrail({ decision_id: id }).some((e: any) => e.action === 'integrity_violation')).toBe(true);
      });
    });
  });
});

describe('renderDecisionDocument produces the standard header, approvers and sections', () => {
  describe('GIVEN an approved decision', () => {
    const h = freshLog();
    let id: string;
    beforeEach(() => {
      id = proposed(h.log);
      act(h.log, id, U.lead, 'approve');
    });

    describe('WHEN the document is rendered', () => {
      let md: string;
      beforeEach(() => { md = h.log.renderDecisionDocument(id, U.alice); });

      it('THEN it has the standard header, status, dates, owner, approver line and sections', () => {
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

describe('only a lead or an admin may decline, whatever the approval mode', () => {
  const REASON = 'Too risky without rollback plan';
  const refused: Array<[string, string]> = [['a member', U.bob], ['its owner', U.alice], ['an outsider', U.outsider]];

  for (const [who, actor] of refused) {
    describe('GIVEN a proposed decision', () => {
      const h = proposedIn();

      describe(`WHEN ${who} declines it`, () => {
        let decline: () => unknown;
        beforeEach(() => { decline = () => act(h.log, h.id, actor, 'decline', { reason: REASON }); });

        it('THEN FORBIDDEN 403', () => {
          expectCode(decline, 'FORBIDDEN', 403);
        });
      });
    });
  }

  describe('GIVEN a proposed decision', () => {
    const h = proposedIn();

    describe('WHEN the org admin declines it', () => {
      let r: any;
      beforeEach(() => { r = act(h.log, h.id, U.org, 'decline', { reason: REASON }); });

      it('THEN it is declined', () => {
        expect(r.decision.status).toBe('declined');
      });
    });
  });

  describe('GIVEN consensus mode and a proposed decision', () => {
    const h = proposedIn({ mode: 'consensus_voting' });

    describe('WHEN the lead declines it', () => {
      let r: any;
      beforeEach(() => { r = act(h.log, h.id, U.lead, 'decline', { reason: REASON }); });

      it('THEN it is declined outright, not counted as a vote', () => {
        expect(r.decision.status).toBe('declined');
        expect(r.decision.vote_tally.request_revision).toBe(0);
      });
    });
  });
});
