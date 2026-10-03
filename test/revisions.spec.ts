import { describe, it, expect, beforeEach } from 'bun:test';
import { freshLog, proposedIn, draft, act, expectCode, U, CONTENT_V1, CONTENT_V2 } from './support/index';

// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.
// Actions expected to fail are captured as a thunk in WHEN and invoked by expectCode in THEN.
// THEN may call read-only queries (getDecision, getVersions, ...) to observe the outcome.

const CONSENSUS = { mode: 'consensus_voting' };

type Reworked = ReturnType<typeof proposedIn> & { v1Hash: string };

/** Call inside a describe(): PRJ-001 proposed, sent back for revision a day later and reworked to CONTENT_V2. */
function reworked(): Reworked {
  const h = proposedIn() as Reworked;
  beforeEach(() => {
    h.v1Hash = h.log.getDecision(h.id, U.alice).content_hash;
    h.clock.advanceDays(1);
    act(h.log, h.id, U.lead, 'request_revision', { reason: 'Need rollback plan' });
    h.log.updateDraft(h.id, U.alice, { content: CONTENT_V2 });
  });
  return h;
}

/** Call inside a describe(): as reworked(), then re-proposed as revision 2. */
function secondRevision(): Reworked {
  const h = reworked();
  beforeEach(() => { act(h.log, h.id, U.alice, 'propose'); });
  return h;
}

describe('request_revision needs a reason and a proposed decision; returns 201 with a draft', () => {
  describe('GIVEN a draft', () => {
    const h = freshLog();
    let id: string;
    beforeEach(() => { id = draft(h.log).id; });

    describe('WHEN the lead requests a revision', () => {
      let request: () => unknown;
      beforeEach(() => { request = () => act(h.log, id, U.lead, 'request_revision', { reason: 'x' }); });

      it('THEN INVALID_STATE 409', () => {
        expectCode(request, 'INVALID_STATE', 409);
      });
    });
  });

  describe('GIVEN a proposed decision', () => {
    const h = proposedIn();

    describe('WHEN the lead requests a revision without a reason', () => {
      let request: () => unknown;
      beforeEach(() => { request = () => act(h.log, h.id, U.lead, 'request_revision'); });

      it('THEN VALIDATION_ERROR 400', () => {
        expectCode(request, 'VALIDATION_ERROR', 400);
      });
    });

    describe('WHEN an outsider requests a revision', () => {
      let request: () => unknown;
      beforeEach(() => { request = () => act(h.log, h.id, U.outsider, 'request_revision', { reason: 'x' }); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(request, 'FORBIDDEN', 403);
      });
    });

    describe('WHEN its owner requests a revision', () => {
      let request: () => unknown;
      beforeEach(() => { request = () => act(h.log, h.id, U.alice, 'request_revision', { reason: 'x' }); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(request, 'FORBIDDEN', 403);
      });
    });

    describe('WHEN the lead requests a revision with a reason', () => {
      let r: any;
      beforeEach(() => {
        r = act(h.log, h.id, U.lead, 'request_revision', {
          reason: 'Need clarification on rollback plan', suggested_changes: 'Add rollback section',
        });
      });

      it('THEN 201, the decision is a draft and revision 1 records reason and requester', () => {
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
  describe('GIVEN a revision was requested a day later and the content reworked', () => {
    const h = reworked();

    describe('WHEN the owner re-proposes', () => {
      let r: any;
      beforeEach(() => { r = act(h.log, h.id, U.alice, 'propose'); });

      it('THEN it is revision 2 with a new hash', () => {
        expect(r.decision.current_revision).toBe(2);
        expect(r.decision.content_hash).not.toBe(h.v1Hash);
      });
    });
  });

  describe('GIVEN two proposals', () => {
    const h = secondRevision();

    describe('WHEN versions are read', () => {
      let versions: any[];
      beforeEach(() => { versions = h.log.getVersions(h.id, U.alice); });

      it('THEN two exist', () => {
        expect(versions.length).toBe(2);
      });

      it('THEN version 1 keeps the original content and hash, outcome and reason, and is not current', () => {
        const v1 = versions[0];
        expect(v1.version).toBe(1);
        expect(v1.content).toBe(CONTENT_V1);
        expect(v1.content_hash).toBe(h.v1Hash);
        expect(v1.outcome).toBe('revision_requested');
        expect(v1.reason).toBe('Need rollback plan');
        expect(v1.current).toBe(false);
      });

      it('THEN version 2 holds the new content, has no outcome and is current', () => {
        const v2 = versions[1];
        expect(v2.content).toBe(CONTENT_V2);
        expect(v2.outcome).toBe(null);
        expect(v2.current).toBe(true);
      });
    });
  });
});

describe('diff groups changes by section path and accepts "v1" style refs', () => {
  describe('GIVEN versions 1 and 2', () => {
    const h = secondRevision();

    describe('WHEN bob diffs v1 to v2', () => {
      let diff: any;
      beforeEach(() => { diff = h.log.diff(h.id, U.bob, { from: 'v1', to: 'v2' }); });

      it('THEN from and to resolve to 1 and 2', () => {
        expect(diff.from).toBe(1);
        expect(diff.to).toBe(2);
      });

      it('THEN the Decision section lists the removed and added lines', () => {
        const decision = diff.changes.find((c: any) => c.section === 'Decision');
        expect(decision.removed).toEqual(['Move to PostgreSQL 16 and deprecate MySQL']);
        expect(decision.added).toEqual(['Move to PostgreSQL 16 within 90 days, maintain MySQL fallback for 30 days']);
      });

      it('THEN nested sections use a path and unchanged sections are omitted', () => {
        const neg = diff.changes.find((c: any) => c.section === 'Consequences > Negative');
        expect(neg.removed.length).toBe(1);
        expect(neg.added.length).toBe(1);
        expect(diff.changes.some((c: any) => c.section === 'Context')).toBe(false);
      });

      it('THEN stats total two added and two removed lines', () => {
        expect(diff.stats).toEqual({ added: 2, removed: 2 });
      });
    });

    describe('WHEN a version is diffed against itself', () => {
      let diff: any;
      beforeEach(() => { diff = h.log.diff(h.id, U.bob, { from: 2, to: 2 }); });

      it('THEN there are no changes', () => {
        expect(diff.changes).toEqual([]);
      });
    });

    describe('WHEN diffing to version 9', () => {
      let compare: () => unknown;
      beforeEach(() => { compare = () => h.log.diff(h.id, U.bob, { from: 1, to: 9 }); });

      it('THEN NOT_FOUND 404', () => {
        expectCode(compare, 'NOT_FOUND', 404);
      });
    });
  });
});

describe('votes are scoped to a revision and reset on re-proposal by default', () => {
  describe('GIVEN two approvals and a revision request', () => {
    const h = proposedIn(CONSENSUS);
    beforeEach(() => {
      act(h.log, h.id, U.bob, 'vote', { vote: 'approve' });
      act(h.log, h.id, U.carol, 'vote', { vote: 'approve' });
      act(h.log, h.id, U.lead, 'request_revision', { reason: 'tighten scope' });
    });

    describe('WHEN the owner re-proposes', () => {
      beforeEach(() => { act(h.log, h.id, U.alice, 'propose'); });

      it('THEN votes and tally are reset', () => {
        const d = h.log.getDecision(h.id, U.alice);
        expect(d.votes.length).toBe(0);
        expect(d.vote_tally.approve).toBe(0);
      });
    });
  });
});

describe('with revision_vote_resets_count=false approvals carry over', () => {
  /** Two approvals, a revision request, with votes carried over the revision. */
  function twoApprovalsThenRevision() {
    const h = proposedIn({ ...CONSENSUS, revision_vote_resets_count: false });
    beforeEach(() => {
      act(h.log, h.id, U.bob, 'vote', { vote: 'approve' });
      act(h.log, h.id, U.carol, 'vote', { vote: 'approve' });
      act(h.log, h.id, U.lead, 'request_revision', { reason: 'tighten scope' });
    });
    return h;
  }

  describe('GIVEN revision_vote_resets_count=false, two approvals and a revision request', () => {
    const h = twoApprovalsThenRevision();

    describe('WHEN the owner re-proposes', () => {
      beforeEach(() => { act(h.log, h.id, U.alice, 'propose'); });

      it('THEN both approvals are kept', () => {
        expect(h.log.getDecision(h.id, U.alice).vote_tally.approve).toBe(2);
      });
    });
  });

  describe('GIVEN two carried-over approvals on the re-proposed decision', () => {
    const h = twoApprovalsThenRevision();
    beforeEach(() => { act(h.log, h.id, U.alice, 'propose'); });

    describe('WHEN david approves', () => {
      let r: any;
      beforeEach(() => { r = act(h.log, h.id, U.david, 'vote', { vote: 'approve' }); });

      it('THEN the decision is approved', () => {
        expect(r.decision.status).toBe('approved');
      });
    });
  });
});
