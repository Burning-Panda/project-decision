import { describe, it, expect, beforeEach } from 'bun:test';
import { freshLog, proposedIn, proposed, act, vote, expectCode, U } from './support/index';

// Shape: GIVEN builds the state (beforeEach), WHEN performs the one action (beforeEach), THEN only asserts.
// Actions expected to fail are captured as a thunk in WHEN and invoked by expectCode in THEN.
// THEN may call read-only queries (getDecision, getVersions, ...) to observe the outcome.
// The default team has five members; alice owns the decisions, so bob, carol, david and the lead are the voters.

const CONSENSUS = { mode: 'consensus_voting' };
const QUORUM_50 = { mode: 'quorum', quorum_percentage: 50, quorum_majority_type: 'simple' };
const VETO_7_DAYS = { mode: 'veto', auto_approve_after_days: 7 };

describe('project settings are merged over documented defaults', () => {
  describe('GIVEN a project created with mode consensus_voting', () => {
    const h = freshLog(CONSENSUS);

    describe('WHEN its approval settings are read', () => {
      let s: any;
      beforeEach(() => { s = h.log.getProject('PRJ').approval_settings; });

      it('THEN documented defaults fill the rest', () => {
        expect(s.mode).toBe('consensus_voting');
        expect(s.enabled_voting).toBe(true);
        expect(s.consensus_approval_threshold).toBe(0.8);
        expect(s.consensus_min_votes).toBe(3);
        expect(s.allow_abstain).toBe(true);
        expect(s.require_reason_on_revision).toBe(true);
        expect(s.auto_approve_after_days).toBe(null);
        expect(s.notification_on_vote).toBe(true);
        expect(s.revision_vote_resets_count).toBe(true);
      });
    });
  });

  describe('GIVEN a project created without settings', () => {
    const h = freshLog();

    describe('WHEN its approval settings are read', () => {
      let s: any;
      beforeEach(() => { s = h.log.getProject('PRJ').approval_settings; });

      it('THEN the mode is single_approval', () => {
        expect(s.mode).toBe('single_approval');
      });

      it('THEN voting is disabled', () => {
        expect(s.enabled_voting).toBe(false);
      });
    });
  });
});

describe('invalid approval mode is rejected', () => {
  describe('GIVEN an org admin', () => {
    const h = freshLog();

    describe('WHEN a project is created with mode coin_flip', () => {
      let create: () => unknown;
      beforeEach(() => {
        create = () => h.log.createProject({
          owner: 'acme', identifier: 'BAD', title: 'x', actor: U.org,
          settings: { approval_settings: { mode: 'coin_flip' } },
        });
      });

      it('THEN VALIDATION_ERROR 400', () => {
        expectCode(create, 'VALIDATION_ERROR', 400);
      });
    });
  });
});

// ---- single approval ----
describe('single approval: members and the owner cannot approve; voting is disabled', () => {
  describe('GIVEN a proposed decision', () => {
    const h = proposedIn();

    describe('WHEN a member approves', () => {
      let approve: () => unknown;
      beforeEach(() => { approve = () => act(h.log, h.id, U.bob, 'approve'); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(approve, 'FORBIDDEN', 403);
      });
    });

    describe('WHEN its owner approves', () => {
      let approve: () => unknown;
      beforeEach(() => { approve = () => act(h.log, h.id, U.alice, 'approve'); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(approve, 'FORBIDDEN', 403);
      });
    });

    describe('WHEN a member votes', () => {
      let cast: () => unknown;
      beforeEach(() => { cast = () => vote(h.log, h.id, U.bob, 'approve'); });

      it('THEN VOTING_DISABLED 409', () => {
        expectCode(cast, 'VOTING_DISABLED', 409);
      });
    });
  });

  describe('GIVEN a decision proposed by the lead', () => {
    const h = freshLog();
    let own: string;
    beforeEach(() => { own = proposed(h.log, { actor: U.lead }); });

    describe('WHEN the lead approves their own proposal', () => {
      let approve: () => unknown;
      beforeEach(() => { approve = () => act(h.log, own, U.lead, 'approve'); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(approve, 'FORBIDDEN', 403);
      });
    });
  });
});

// ---- consensus ----
describe('consensus: approves at 3 approvals (80%+), returning 202 when the vote closes it', () => {
  describe('GIVEN consensus mode and a proposed decision', () => {
    const h = proposedIn(CONSENSUS);

    describe('WHEN bob approves', () => {
      let r: any;
      beforeEach(() => { r = vote(h.log, h.id, U.bob, 'approve', 'solid'); });

      it('THEN 200 with a 1-0-0 tally', () => {
        expect(r.status_code).toBe(200);
        expect(r.metadata.vote_tally).toEqual({ approve: 1, request_revision: 0, abstain: 0 });
      });
    });
  });

  describe('GIVEN one approval', () => {
    const h = proposedIn(CONSENSUS);
    beforeEach(() => { vote(h.log, h.id, U.bob, 'approve'); });

    describe('WHEN carol approves', () => {
      let r: any;
      beforeEach(() => { r = vote(h.log, h.id, U.carol, 'approve'); });

      it('THEN the decision stays proposed', () => {
        expect(r.decision.status).toBe('proposed');
      });
    });
  });

  describe('GIVEN two approvals', () => {
    const h = proposedIn(CONSENSUS);
    beforeEach(() => {
      vote(h.log, h.id, U.bob, 'approve');
      vote(h.log, h.id, U.carol, 'approve');
    });

    describe('WHEN david approves', () => {
      let r: any;
      beforeEach(() => { r = vote(h.log, h.id, U.david, 'approve'); });

      it('THEN 202 and the decision is approved by all three', () => {
        expect(r.status_code).toBe(202);
        expect(r.decision.status).toBe('approved');
        expect(r.decision.approvers.length).toBe(3);
      });
    });
  });
});

describe('consensus: 75% approval is not enough', () => {
  describe('GIVEN three approvals and one revision request', () => {
    const h = proposedIn(CONSENSUS);
    beforeEach(() => {
      vote(h.log, h.id, U.bob, 'approve');
      vote(h.log, h.id, U.carol, 'request_revision', 'need monitoring docs');
      vote(h.log, h.id, U.david, 'approve');
    });

    describe('WHEN the fourth voter approves', () => {
      let r: any;
      beforeEach(() => { r = vote(h.log, h.id, U.lead, 'approve'); });

      it('THEN it stays proposed with a 3-1-0 tally', () => {
        expect(r.decision.status).toBe('proposed');
        expect(r.metadata.vote_tally).toEqual({ approve: 3, request_revision: 1, abstain: 0 });
      });
    });
  });
});

describe('consensus: abstentions do not count toward minimum votes or the ratio', () => {
  describe('GIVEN two approvals', () => {
    const h = proposedIn(CONSENSUS);
    beforeEach(() => {
      vote(h.log, h.id, U.bob, 'approve');
      vote(h.log, h.id, U.carol, 'approve');
    });

    describe('WHEN david abstains', () => {
      let r: any;
      beforeEach(() => { r = vote(h.log, h.id, U.david, 'abstain'); });

      it('THEN the decision stays proposed', () => {
        expect(r.decision.status).toBe('proposed');
      });
    });
  });

  describe('GIVEN two approvals and an abstention', () => {
    const h = proposedIn(CONSENSUS);
    beforeEach(() => {
      vote(h.log, h.id, U.bob, 'approve');
      vote(h.log, h.id, U.carol, 'approve');
      vote(h.log, h.id, U.david, 'abstain');
    });

    describe('WHEN the lead approves', () => {
      let r: any;
      beforeEach(() => { r = vote(h.log, h.id, U.lead, 'approve'); });

      it('THEN the decision is approved', () => {
        expect(r.decision.status).toBe('approved');
      });
    });
  });
});

describe('consensus: abstain can be disabled; revision votes need a reason', () => {
  describe('GIVEN allow_abstain=false', () => {
    const h = proposedIn({ ...CONSENSUS, allow_abstain: false });

    describe('WHEN bob abstains', () => {
      let cast: () => unknown;
      beforeEach(() => { cast = () => vote(h.log, h.id, U.bob, 'abstain'); });

      it('THEN VALIDATION_ERROR 400', () => {
        expectCode(cast, 'VALIDATION_ERROR', 400);
      });
    });
  });

  describe('GIVEN consensus mode and a proposed decision', () => {
    const h = proposedIn(CONSENSUS);

    describe('WHEN bob requests a revision without a reason', () => {
      let cast: () => unknown;
      beforeEach(() => { cast = () => vote(h.log, h.id, U.bob, 'request_revision'); });

      it('THEN VALIDATION_ERROR 400', () => {
        expectCode(cast, 'VALIDATION_ERROR', 400);
      });
    });

    describe('WHEN bob casts an unknown vote', () => {
      let cast: () => unknown;
      beforeEach(() => { cast = () => vote(h.log, h.id, U.bob, 'maybe'); });

      it('THEN VALIDATION_ERROR 400', () => {
        expectCode(cast, 'VALIDATION_ERROR', 400);
      });
    });
  });
});

describe('consensus: a voter can change their vote while the decision is open', () => {
  describe('GIVEN bob approved', () => {
    const h = proposedIn(CONSENSUS);
    beforeEach(() => { vote(h.log, h.id, U.bob, 'approve'); });

    describe('WHEN bob changes his vote to request_revision', () => {
      let r: any;
      beforeEach(() => { r = vote(h.log, h.id, U.bob, 'request_revision', 'changed my mind'); });

      it('THEN the tally moves to 0-1-0', () => {
        expect(r.metadata.vote_tally).toEqual({ approve: 0, request_revision: 1, abstain: 0 });
      });

      it('THEN only one vote record remains', () => {
        expect(h.log.getDecision(h.id, U.bob).votes.length).toBe(1);
      });
    });
  });
});

describe('consensus: owner and outsiders cannot vote; only proposed decisions accept votes', () => {
  describe('GIVEN a proposed decision', () => {
    const h = proposedIn(CONSENSUS);

    describe('WHEN its owner votes', () => {
      let cast: () => unknown;
      beforeEach(() => { cast = () => vote(h.log, h.id, U.alice, 'approve'); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(cast, 'FORBIDDEN', 403);
      });
    });

    describe('WHEN an outsider votes', () => {
      let cast: () => unknown;
      beforeEach(() => { cast = () => vote(h.log, h.id, U.outsider, 'approve'); });

      it('THEN FORBIDDEN 403', () => {
        expectCode(cast, 'FORBIDDEN', 403);
      });
    });
  });

  describe('GIVEN a draft decision', () => {
    const h = freshLog(CONSENSUS);
    let id: string;
    beforeEach(() => { id = h.log.createDecision({ project: 'PRJ', actor: U.alice, title: 'draft one' }).id; });

    describe('WHEN bob votes', () => {
      let cast: () => unknown;
      beforeEach(() => { cast = () => vote(h.log, id, U.bob, 'approve'); });

      it('THEN INVALID_STATE 409', () => {
        expectCode(cast, 'INVALID_STATE', 409);
      });
    });
  });
});

describe('consensus: the approve action counts as an approve vote (202)', () => {
  describe('GIVEN consensus mode and a proposed decision', () => {
    const h = proposedIn(CONSENSUS);

    describe('WHEN bob uses the approve action', () => {
      let r: any;
      beforeEach(() => { r = act(h.log, h.id, U.bob, 'approve', { comment: 'LGTM' }); });

      it('THEN 202, one approve in the tally, and the decision stays proposed', () => {
        expect(r.status_code).toBe(202);
        expect(r.metadata.vote_tally.approve).toBe(1);
        expect(r.decision.status).toBe('proposed');
      });
    });
  });
});

describe('consensus: the request_revision action is a revision request, not a vote', () => {
  describe('GIVEN consensus mode and a proposed decision bob approved', () => {
    const h = proposedIn(CONSENSUS);
    beforeEach(() => { vote(h.log, h.id, U.bob, 'approve'); });

    describe('WHEN the lead uses the request_revision action', () => {
      let r: any;
      beforeEach(() => { r = act(h.log, h.id, U.lead, 'request_revision', { reason: 'tighten scope' }); });

      it('THEN 201 and the decision is back in draft', () => {
        expect(r.status_code).toBe(201);
        expect(r.decision.status).toBe('draft');
      });

      it('THEN it is not counted as a request_revision vote', () => {
        expect(r.decision.vote_tally.request_revision).toBe(0);
      });
    });
  });
});

// ---- quorum ----
describe('quorum: needs turnout before a majority can approve', () => {
  describe('GIVEN a 50% quorum', () => {
    const h = proposedIn(QUORUM_50);

    describe('WHEN only bob (1 of 4) approves', () => {
      let r: any;
      beforeEach(() => { r = vote(h.log, h.id, U.bob, 'approve'); });

      it('THEN the decision stays proposed', () => {
        expect(r.decision.status).toBe('proposed');
      });
    });
  });

  describe('GIVEN a 50% quorum and one approval', () => {
    const h = proposedIn(QUORUM_50);
    beforeEach(() => { vote(h.log, h.id, U.bob, 'approve'); });

    describe('WHEN carol (2 of 4) approves', () => {
      let r: any;
      beforeEach(() => { r = vote(h.log, h.id, U.carol, 'approve'); });

      it('THEN the decision is approved', () => {
        expect(r.decision.status).toBe('approved');
      });
    });
  });
});

describe('quorum: a tie is not a majority; a third vote breaks it', () => {
  describe('GIVEN one approval', () => {
    const h = proposedIn(QUORUM_50);
    beforeEach(() => { vote(h.log, h.id, U.bob, 'approve'); });

    describe('WHEN carol requests a revision (a tie)', () => {
      let r: any;
      beforeEach(() => { r = vote(h.log, h.id, U.carol, 'request_revision', 'unclear'); });

      it('THEN the decision stays proposed', () => {
        expect(r.decision.status).toBe('proposed');
      });
    });
  });

  describe('GIVEN a tied vote', () => {
    const h = proposedIn(QUORUM_50);
    beforeEach(() => {
      vote(h.log, h.id, U.bob, 'approve');
      vote(h.log, h.id, U.carol, 'request_revision', 'unclear');
    });

    describe('WHEN david approves', () => {
      let r: any;
      beforeEach(() => { r = vote(h.log, h.id, U.david, 'approve'); });

      it('THEN the decision is approved', () => {
        expect(r.decision.status).toBe('approved');
      });
    });
  });
});

describe('quorum: 2/3 majority', () => {
  /** A 50% quorum with this majority rule, and a 1-1 split between bob and carol. */
  function oneOneSplit(majority: string) {
    const h = proposedIn({ ...QUORUM_50, quorum_majority_type: majority });
    beforeEach(() => {
      vote(h.log, h.id, U.bob, 'approve');
      vote(h.log, h.id, U.carol, 'request_revision', 'hmm');
    });
    return h;
  }

  describe('GIVEN a 2_3_majority rule and a 1-1 split', () => {
    const h = oneOneSplit('2_3_majority');

    describe('WHEN david approves (2/3)', () => {
      let r: any;
      beforeEach(() => { r = vote(h.log, h.id, U.david, 'approve'); });

      it('THEN the decision is approved', () => {
        expect(r.decision.status).toBe('approved');
      });
    });
  });

  describe('GIVEN a 3_4_majority rule and a 1-1 split', () => {
    const h = oneOneSplit('3_4_majority');

    describe('WHEN david approves (2/3 < 3/4)', () => {
      let r: any;
      beforeEach(() => { r = vote(h.log, h.id, U.david, 'approve'); });

      it('THEN the decision stays proposed', () => {
        expect(r.decision.status).toBe('proposed');
      });
    });
  });
});

// ---- veto ----
describe('veto: auto-approves after the window unless blocked', () => {
  describe('GIVEN a 7-day veto window, 6 days in', () => {
    const h = proposedIn(VETO_7_DAYS);
    beforeEach(() => { h.clock.advanceDays(6); });

    describe('WHEN a sweep runs', () => {
      let swept: string[];
      beforeEach(() => { swept = h.log.sweep(); });

      it('THEN nothing is approved', () => {
        expect(swept).toEqual([]);
        expect(h.log.getDecision(h.id, U.alice).status).toBe('proposed');
      });
    });
  });

  describe('GIVEN a 7-day veto window, 7 days in', () => {
    const h = proposedIn(VETO_7_DAYS);
    beforeEach(() => { h.clock.advanceDays(7); });

    describe('WHEN a sweep runs', () => {
      let swept: string[];
      beforeEach(() => { swept = h.log.sweep(); });

      it('THEN the decision is auto-approved with no approvers', () => {
        expect(swept).toEqual([h.id]);
        const d = h.log.getDecision(h.id, U.alice);
        expect(d.status).toBe('approved');
        expect(d.approvers).toEqual([]);
      });
    });
  });
});

describe('veto: a veto needs a reason and sends the decision back to draft', () => {
  describe('GIVEN veto mode and a proposed decision', () => {
    const h = proposedIn(VETO_7_DAYS);

    describe('WHEN bob vetoes without a reason', () => {
      let cast: () => unknown;
      beforeEach(() => { cast = () => vote(h.log, h.id, U.bob, 'request_revision'); });

      it('THEN VALIDATION_ERROR 400', () => {
        expectCode(cast, 'VALIDATION_ERROR', 400);
      });
    });

    describe('WHEN bob vetoes with a reason', () => {
      let r: any;
      beforeEach(() => { r = vote(h.log, h.id, U.bob, 'request_revision', 'Conflicts with PRJ-010'); });

      it('THEN the decision returns to draft and the version records the reason', () => {
        expect(r.decision.status).toBe('draft');
        expect(h.log.getVersions(h.id, U.bob)[0].reason).toBe('Conflicts with PRJ-010');
      });
    });
  });

  describe('GIVEN a decision vetoed 30 days ago', () => {
    const h = proposedIn(VETO_7_DAYS);
    beforeEach(() => {
      vote(h.log, h.id, U.bob, 'request_revision', 'Conflicts with PRJ-010');
      h.clock.advanceDays(30);
    });

    describe('WHEN a sweep runs', () => {
      let swept: string[];
      beforeEach(() => { swept = h.log.sweep(); });

      it('THEN nothing is auto-approved', () => {
        expect(swept).toEqual([]);
      });
    });
  });
});

describe('veto: a lead can still approve explicitly', () => {
  describe('GIVEN veto mode and a proposed decision', () => {
    const h = proposedIn(VETO_7_DAYS);

    describe('WHEN the lead approves', () => {
      let r: any;
      beforeEach(() => { r = act(h.log, h.id, U.lead, 'approve'); });

      it('THEN it is approved', () => {
        expect(r.decision.status).toBe('approved');
      });
    });
  });
});

// ---- weighted quorum ----
describe('quorum: role weights make a lead count for more', () => {
  describe('GIVEN a 50% quorum with lead weight 3 (total weight 6)', () => {
    const h = proposedIn({ mode: 'quorum', quorum_percentage: 50, vote_weights: { lead: 3 } });

    describe('WHEN the lead alone approves', () => {
      let r: any;
      beforeEach(() => { r = vote(h.log, h.id, U.lead, 'approve'); });

      it('THEN the decision is approved', () => {
        expect(r.decision.status).toBe('approved');
      });

      it('THEN the tally still reports head-counts', () => {
        expect(r.metadata.vote_tally).toEqual({ approve: 1, request_revision: 0, abstain: 0 });
      });
    });
  });
});

describe('quorum: weighted opposition outweighs more numerous approvals', () => {
  describe('GIVEN lead weight 3 and two approvals', () => {
    const h = proposedIn({ mode: 'quorum', quorum_percentage: 50, vote_weights: { lead: 3 } });
    beforeEach(() => {
      vote(h.log, h.id, U.bob, 'approve');
      vote(h.log, h.id, U.carol, 'approve');
    });

    describe('WHEN the weight-3 lead requests a revision (2 vs 3)', () => {
      let r: any;
      beforeEach(() => { r = vote(h.log, h.id, U.lead, 'request_revision', 'blocking concern'); });

      it('THEN the decision stays proposed', () => {
        expect(r.decision.status).toBe('proposed');
      });
    });
  });
});

describe('without weights the same lead vote is not enough', () => {
  describe('GIVEN a 50% quorum with default weights', () => {
    const h = proposedIn({ mode: 'quorum', quorum_percentage: 50 });

    describe('WHEN the lead alone approves', () => {
      let r: any;
      beforeEach(() => { r = vote(h.log, h.id, U.lead, 'approve'); });

      it('THEN the decision stays proposed', () => {
        expect(r.decision.status).toBe('proposed');
      });
    });
  });
});

describe('vote_weights are validated', () => {
  const invalid: Array<[string, unknown]> = [
    ['a weight of 0', { lead: 0 }],
    ['a non-numeric weight', { lead: 'heavy' }],
    ['a weight for an unknown role', { king: 2 }],
  ];
  for (const [label, weights] of invalid) {
    describe('GIVEN project settings', () => {
      const h = freshLog();

      describe(`WHEN ${label} is set`, () => {
        let update: () => unknown;
        beforeEach(() => { update = () => h.log.updateProjectSettings('PRJ', U.org, { approval_settings: { vote_weights: weights } }); });

        it('THEN VALIDATION_ERROR 400', () => {
          expectCode(update, 'VALIDATION_ERROR', 400);
        });
      });
    });
  }

  describe('GIVEN default settings', () => {
    const h = freshLog();

    describe('WHEN vote_weights are read', () => {
      let weights: any;
      beforeEach(() => { weights = h.log.getProject('PRJ').approval_settings.vote_weights; });

      it('THEN member weighs 1', () => {
        expect(weights.member).toBe(1);
      });
    });
  });
});
