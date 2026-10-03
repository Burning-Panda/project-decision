import { describe, it, expect } from 'bun:test';
import { setup, draft, proposed, act, expectCode, U, CONTENT_V1, CONTENT_V2 } from './support/index';

describe('request_revision needs a reason and a proposed decision; returns 201 with a draft', () => {
  describe('GIVEN a draft', () => {
    describe('WHEN the lead requests a revision', () => {
      it('THEN INVALID_STATE 409', async () => {
        const { log } = await setup();
        const d = draft(log);
        expectCode(() => act(log, d.id, U.lead, 'request_revision', { reason: 'x' }), 'INVALID_STATE', 409);
      });
    });
  });

  describe('GIVEN a proposed decision', () => {
    describe('WHEN the lead requests a revision without a reason', () => {
      it('THEN VALIDATION_ERROR 400', async () => {
        const { log } = await setup();
        const id = proposed(log);
        expectCode(() => act(log, id, U.lead, 'request_revision'), 'VALIDATION_ERROR', 400);
      });
    });
    describe('WHEN an outsider requests a revision', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup();
        const id = proposed(log);
        expectCode(() => act(log, id, U.outsider, 'request_revision', { reason: 'x' }), 'FORBIDDEN', 403);
      });
    });
    describe('WHEN its owner requests a revision', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup();
        const id = proposed(log);
        expectCode(() => act(log, id, U.alice, 'request_revision', { reason: 'x' }), 'FORBIDDEN', 403);
      });
    });
    describe('WHEN the lead requests a revision with a reason', () => {
      it('THEN 201, the decision is a draft and revision 1 records reason and requester', async () => {
        // Given
        const { log } = await setup();
        const id = proposed(log);
        // When
        const r = act(log, id, U.lead, 'request_revision', {
          reason: 'Need clarification on rollback plan', suggested_changes: 'Add rollback section',
        });
        // Then
        expect(r.status_code).toBe(201);
        expect(r.decision.status).toBe('draft');
        expect(r.data.revision.revision_number).toBe(1);
        expect(r.data.revision.reason).toBe('Need clarification on rollback plan');
        expect(r.data.revision.requested_by).toBe(U.lead);
      });
    });
  });
});

describe('revision cycle keeps every version immutable and reachable', () => {
  async function secondRevision() {
    const { log, clock } = await setup();
    const id = proposed(log);
    const v1Hash = log.getDecision(id, U.alice).content_hash;
    clock.advanceDays(1);
    act(log, id, U.lead, 'request_revision', { reason: 'Need rollback plan' });
    log.updateDraft(id, U.alice, { content: CONTENT_V2 });
    const r = act(log, id, U.alice, 'propose');
    return { log, id, v1Hash, r };
  }

  describe('GIVEN a revision was requested and content reworked', () => {
    describe('WHEN the owner re-proposes', () => {
      it('THEN it is revision 2 with a new hash', async () => {
        const { r, v1Hash } = await secondRevision();
        expect(r.decision.current_revision).toBe(2);
        expect(r.decision.content_hash).not.toBe(v1Hash);
      });
    });
  });

  describe('GIVEN two proposals', () => {
    describe('WHEN versions are read', () => {
      it('THEN two exist', async () => {
        const { log, id } = await secondRevision();
        expect(log.getVersions(id, U.alice).length).toBe(2);
      });
    });
    describe('WHEN version 1 is read', () => {
      it('THEN it keeps the original content and hash, outcome and reason, and is not current', async () => {
        const { log, id, v1Hash } = await secondRevision();
        const v1 = log.getVersions(id, U.alice)[0];
        expect(v1.version).toBe(1);
        expect(v1.content).toBe(CONTENT_V1);
        expect(v1.content_hash).toBe(v1Hash);
        expect(v1.outcome).toBe('revision_requested');
        expect(v1.reason).toBe('Need rollback plan');
        expect(v1.current).toBe(false);
      });
    });
    describe('WHEN version 2 is read', () => {
      it('THEN it holds the new content, has no outcome and is current', async () => {
        const { log, id } = await secondRevision();
        const v2 = log.getVersions(id, U.alice)[1];
        expect(v2.content).toBe(CONTENT_V2);
        expect(v2.outcome).toBe(null);
        expect(v2.current).toBe(true);
      });
    });
  });
});

describe('diff groups changes by section path and accepts "v1" style refs', () => {
  async function twoVersions() {
    const { log } = await setup();
    const id = proposed(log);
    act(log, id, U.lead, 'request_revision', { reason: 'timeline' });
    log.updateDraft(id, U.alice, { content: CONTENT_V2 });
    act(log, id, U.alice, 'propose');
    return { log, id };
  }

  describe('GIVEN versions 1 and 2', () => {
    describe('WHEN bob diffs v1 to v2', () => {
      it('THEN from and to resolve to 1 and 2', async () => {
        const { log, id } = await twoVersions();
        const diff = log.diff(id, U.bob, { from: 'v1', to: 'v2' });
        expect(diff.from).toBe(1);
        expect(diff.to).toBe(2);
      });
    });
    describe('WHEN diffed', () => {
      it('THEN the Decision section lists the removed and added lines', async () => {
        const { log, id } = await twoVersions();
        const decision = log.diff(id, U.bob, { from: 'v1', to: 'v2' }).changes.find((c: any) => c.section === 'Decision');
        expect(decision.removed).toEqual(['Move to PostgreSQL 16 and deprecate MySQL']);
        expect(decision.added).toEqual(['Move to PostgreSQL 16 within 90 days, maintain MySQL fallback for 30 days']);
      });

      it('THEN nested sections use a path and unchanged sections are omitted', async () => {
        const { log, id } = await twoVersions();
        const diff = log.diff(id, U.bob, { from: 'v1', to: 'v2' });
        const neg = diff.changes.find((c: any) => c.section === 'Consequences > Negative');
        expect(neg.removed.length).toBe(1);
        expect(neg.added.length).toBe(1);
        expect(diff.changes.some((c: any) => c.section === 'Context')).toBe(false);
      });

      it('THEN stats total two added and two removed lines', async () => {
        const { log, id } = await twoVersions();
        expect(log.diff(id, U.bob, { from: 'v1', to: 'v2' }).stats).toEqual({ added: 2, removed: 2 });
      });
    });
    describe('WHEN a version is diffed against itself', () => {
      it('THEN there are no changes', async () => {
        const { log, id } = await twoVersions();
        expect(log.diff(id, U.bob, { from: 2, to: 2 }).changes).toEqual([]);
      });
    });
    describe('WHEN diffing to version 9', () => {
      it('THEN NOT_FOUND 404', async () => {
        const { log, id } = await twoVersions();
        expectCode(() => log.diff(id, U.bob, { from: 1, to: 9 }), 'NOT_FOUND', 404);
      });
    });
  });
});

describe('votes are scoped to a revision and reset on re-proposal by default', () => {
  describe('GIVEN two approvals and a revision request', () => {
    describe('WHEN the owner re-proposes', () => {
      it('THEN votes and tally are reset', async () => {
        // Given
        const { log } = await setup({ mode: 'consensus_voting' });
        const id = proposed(log);
        act(log, id, U.bob, 'vote', { vote: 'approve' });
        act(log, id, U.carol, 'vote', { vote: 'approve' });
        act(log, id, U.lead, 'request_revision', { reason: 'tighten scope' });
        // When
        act(log, id, U.alice, 'propose');
        // Then
        const d = log.getDecision(id, U.alice);
        expect(d.votes.length).toBe(0);
        expect(d.vote_tally.approve).toBe(0);
      });
    });
  });
});

describe('with revision_vote_resets_count=false approvals carry over', () => {
  async function carriedOver() {
    const { log } = await setup({ mode: 'consensus_voting', revision_vote_resets_count: false });
    const id = proposed(log);
    act(log, id, U.bob, 'vote', { vote: 'approve' });
    act(log, id, U.carol, 'vote', { vote: 'approve' });
    act(log, id, U.lead, 'request_revision', { reason: 'tighten scope' });
    act(log, id, U.alice, 'propose');
    return { log, id };
  }

  describe('GIVEN revision_vote_resets_count=false', () => {
    describe('WHEN the owner re-proposes', () => {
      it('THEN both approvals are kept', async () => {
        const { log, id } = await carriedOver();
        expect(log.getDecision(id, U.alice).vote_tally.approve).toBe(2);
      });
    });
  });

  describe('GIVEN two carried-over approvals', () => {
    describe('WHEN david approves', () => {
      it('THEN the decision is approved', async () => {
        const { log, id } = await carriedOver();
        expect(act(log, id, U.david, 'vote', { vote: 'approve' }).decision.status).toBe('approved');
      });
    });
  });
});
