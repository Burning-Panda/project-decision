import { describe, it, expect, beforeEach } from 'bun:test';
import { setup, proposed, act, vote, expectCode, U } from './support/index';

describe('project settings are merged over documented defaults', () => {
  describe('GIVEN a project created with mode consensus_voting', () => {
    describe('WHEN its approval settings are read', () => {
      it('THEN documented defaults fill the rest', async () => {
        // Given
        const { log } = await setup({ mode: 'consensus_voting' });
        // When
        const s = log.getProject('PRJ').approval_settings;
        // Then
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
    describe('WHEN its mode is read', () => {
      it('THEN it is single_approval', async () => {
        const { log } = await setup();
        expect(log.getProject('PRJ').approval_settings.mode).toBe('single_approval');
      });
    });
    describe('WHEN enabled_voting is read', () => {
      it('THEN voting is disabled', async () => {
        const { log } = await setup();
        expect(log.getProject('PRJ').approval_settings.enabled_voting).toBe(false);
      });
    });
  });
});

describe('invalid approval mode is rejected', () => {
  describe('GIVEN an org admin', () => {
    describe('WHEN a project is created with mode coin_flip', () => {
      it('THEN VALIDATION_ERROR 400', async () => {
        const { log } = await setup();
        expectCode(() => log.createProject({
          owner: 'acme', identifier: 'BAD', title: 'x', actor: U.org,
          settings: { approval_settings: { mode: 'coin_flip' } },
        }), 'VALIDATION_ERROR', 400);
      });
    });
  });
});

// ---- single approval ----
describe('single approval: members and the owner cannot approve; voting is disabled', () => {
  describe('GIVEN a proposed decision', () => {
    describe('WHEN a member approves', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup();
        const id = proposed(log);
        expectCode(() => act(log, id, U.bob, 'approve'), 'FORBIDDEN', 403);
      });
    });
    describe('WHEN its owner approves', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup();
        const id = proposed(log);
        expectCode(() => act(log, id, U.alice, 'approve'), 'FORBIDDEN', 403);
      });
    });
    describe('WHEN a member votes', () => {
      it('THEN VOTING_DISABLED 409', async () => {
        const { log } = await setup();
        const id = proposed(log);
        expectCode(() => vote(log, id, U.bob, 'approve'), 'VOTING_DISABLED', 409);
      });
    });
  });

  describe('GIVEN a decision proposed by the lead', () => {
    describe('WHEN the lead approves their own proposal', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup();
        const own = proposed(log, { actor: U.lead });
        expectCode(() => act(log, own, U.lead, 'approve'), 'FORBIDDEN', 403);
      });
    });
  });
});

// ---- consensus ----
describe('consensus: approves at 3 approvals (80%+), returning 202 when the vote closes it', () => {
  describe('GIVEN consensus mode and a proposed decision', () => {
    describe('WHEN bob approves', () => {
      it('THEN 200 with a 1-0-0 tally', async () => {
        // Given
        const { log } = await setup({ mode: 'consensus_voting' });
        const id = proposed(log);
        // When
        const r1 = vote(log, id, U.bob, 'approve', 'solid');
        // Then
        expect(r1.status_code).toBe(200);
        expect(r1.metadata.vote_tally).toEqual({ approve: 1, request_revision: 0, abstain: 0 });
      });
    });
  });

  describe('GIVEN one approval', () => {
    describe('WHEN carol approves', () => {
      it('THEN the decision stays proposed', async () => {
        // Given
        const { log } = await setup({ mode: 'consensus_voting' });
        const id = proposed(log);
        vote(log, id, U.bob, 'approve');
        // When
        const r2 = vote(log, id, U.carol, 'approve');
        // Then
        expect(r2.decision.status).toBe('proposed');
      });
    });
  });

  describe('GIVEN two approvals', () => {
    describe('WHEN david approves', () => {
      it('THEN 202 and the decision is approved by all three', async () => {
        // Given
        const { log } = await setup({ mode: 'consensus_voting' });
        const id = proposed(log);
        vote(log, id, U.bob, 'approve');
        vote(log, id, U.carol, 'approve');
        // When
        const r3 = vote(log, id, U.david, 'approve');
        // Then
        expect(r3.status_code).toBe(202);
        expect(r3.decision.status).toBe('approved');
        expect(r3.decision.approvers.length).toBe(3);
      });
    });
  });
});

describe('consensus: 75% approval is not enough', () => {
  describe('GIVEN three approvals and one revision request', () => {
    describe('WHEN the fourth voter approves', () => {
      it('THEN it stays proposed with a 3-1-0 tally', async () => {
        // Given
        const { log } = await setup({ mode: 'consensus_voting' });
        const id = proposed(log);
        vote(log, id, U.bob, 'approve');
        vote(log, id, U.carol, 'request_revision', 'need monitoring docs');
        vote(log, id, U.david, 'approve');
        // When
        const r = vote(log, id, U.lead, 'approve');
        // Then
        expect(r.decision.status).toBe('proposed');
        expect(r.metadata.vote_tally).toEqual({ approve: 3, request_revision: 1, abstain: 0 });
      });
    });
  });
});

describe('consensus: abstentions do not count toward minimum votes or the ratio', () => {
  describe('GIVEN two approvals', () => {
    describe('WHEN david abstains', () => {
      it('THEN the decision stays proposed', async () => {
        // Given
        const { log } = await setup({ mode: 'consensus_voting' });
        const id = proposed(log);
        vote(log, id, U.bob, 'approve');
        vote(log, id, U.carol, 'approve');
        // When
        const r = vote(log, id, U.david, 'abstain');
        // Then
        expect(r.decision.status).toBe('proposed');
      });
    });
  });

  describe('GIVEN two approvals and an abstention', () => {
    describe('WHEN the lead approves', () => {
      it('THEN the decision is approved', async () => {
        // Given
        const { log } = await setup({ mode: 'consensus_voting' });
        const id = proposed(log);
        vote(log, id, U.bob, 'approve');
        vote(log, id, U.carol, 'approve');
        vote(log, id, U.david, 'abstain');
        // When
        const r = vote(log, id, U.lead, 'approve');
        // Then
        expect(r.decision.status).toBe('approved');
      });
    });
  });
});

describe('consensus: abstain can be disabled; revision votes need a reason', () => {
  const noAbstain = () => setup({ mode: 'consensus_voting', allow_abstain: false });

  describe('GIVEN allow_abstain=false', () => {
    describe('WHEN bob abstains', () => {
      it('THEN VALIDATION_ERROR 400', async () => {
        const { log } = await noAbstain();
        const id = proposed(log);
        expectCode(() => vote(log, id, U.bob, 'abstain'), 'VALIDATION_ERROR', 400);
      });
    });
  });

  describe('GIVEN consensus mode', () => {
    describe('WHEN bob requests a revision without a reason', () => {
      it('THEN VALIDATION_ERROR 400', async () => {
        const { log } = await noAbstain();
        const id = proposed(log);
        expectCode(() => vote(log, id, U.bob, 'request_revision'), 'VALIDATION_ERROR', 400);
      });
    });
    describe('WHEN bob casts an unknown vote', () => {
      it('THEN VALIDATION_ERROR 400', async () => {
        const { log } = await noAbstain();
        const id = proposed(log);
        expectCode(() => vote(log, id, U.bob, 'maybe'), 'VALIDATION_ERROR', 400);
      });
    });
  });
});

describe('consensus: a voter can change their vote while the decision is open', () => {
  async function bobApproved() {
    const { log } = await setup({ mode: 'consensus_voting' });
    const id = proposed(log);
    vote(log, id, U.bob, 'approve');
    return { log, id };
  }

  describe('GIVEN bob approved', () => {
    describe('WHEN bob requests a revision', () => {
      it('THEN the tally moves to 0-1-0', async () => {
        // Given
        const { log, id } = await bobApproved();
        // When
        const r = vote(log, id, U.bob, 'request_revision', 'changed my mind');
        // Then
        expect(r.metadata.vote_tally).toEqual({ approve: 0, request_revision: 1, abstain: 0 });
      });
    });
    describe('WHEN bob changes his vote', () => {
      it('THEN only one vote record remains', async () => {
        // Given
        const { log, id } = await bobApproved();
        // When
        vote(log, id, U.bob, 'request_revision', 'changed my mind');
        // Then
        expect(log.getDecision(id, U.bob).votes.length).toBe(1);
      });
    });
  });
});

describe('consensus: owner and outsiders cannot vote; only proposed decisions accept votes', () => {
  describe('GIVEN a proposed decision', () => {
    describe('WHEN its owner votes', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup({ mode: 'consensus_voting' });
        const id = proposed(log);
        expectCode(() => vote(log, id, U.alice, 'approve'), 'FORBIDDEN', 403);
      });
    });
    describe('WHEN an outsider votes', () => {
      it('THEN FORBIDDEN 403', async () => {
        const { log } = await setup({ mode: 'consensus_voting' });
        const id = proposed(log);
        expectCode(() => vote(log, id, U.outsider, 'approve'), 'FORBIDDEN', 403);
      });
    });
  });

  describe('GIVEN a draft decision', () => {
    describe('WHEN bob votes', () => {
      it('THEN INVALID_STATE 409', async () => {
        const { log } = await setup({ mode: 'consensus_voting' });
        const d = log.createDecision({ project: 'PRJ', actor: U.alice, title: 'draft one' });
        expectCode(() => vote(log, d.id, U.bob, 'approve'), 'INVALID_STATE', 409);
      });
    });
  });
});

describe('consensus: the approve action counts as an approve vote (202)', () => {
  describe('GIVEN consensus mode', () => {
    describe('WHEN bob uses the approve action', () => {
      it('THEN 202, one approve in the tally, and the decision stays proposed', async () => {
        // Given
        const { log } = await setup({ mode: 'consensus_voting' });
        const id = proposed(log);
        // When
        const r = act(log, id, U.bob, 'approve', { comment: 'LGTM' });
        // Then
        expect(r.status_code).toBe(202);
        expect(r.metadata.vote_tally.approve).toBe(1);
        expect(r.decision.status).toBe('proposed');
      });
    });
  });
});

describe('consensus: the request_revision action is a revision request, not a vote', () => {
  describe('GIVEN consensus mode and a proposed decision bob approved', () => {
    let log: any;
    let id: string;
    beforeEach(async () => {
      ({ log } = await setup({ mode: 'consensus_voting' }));
      id = proposed(log);
      vote(log, id, U.bob, 'approve');
    });

    describe('WHEN the lead uses the request_revision action', () => {
      let r: any;
      beforeEach(() => { r = act(log, id, U.lead, 'request_revision', { reason: 'tighten scope' }); });

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
  const quorum = () => setup({ mode: 'quorum', quorum_percentage: 50, quorum_majority_type: 'simple' });

  describe('GIVEN a 50% quorum', () => {
    describe('WHEN only bob (1 of 4) approves', () => {
      it('THEN the decision stays proposed', async () => {
        const { log } = await quorum();
        const id = proposed(log);
        expect(vote(log, id, U.bob, 'approve').decision.status).toBe('proposed');
      });
    });
  });

  describe('GIVEN a 50% quorum and one approval', () => {
    describe('WHEN carol (2 of 4) approves', () => {
      it('THEN the decision is approved', async () => {
        // Given
        const { log } = await quorum();
        const id = proposed(log);
        vote(log, id, U.bob, 'approve');
        // When
        const r = vote(log, id, U.carol, 'approve');
        // Then
        expect(r.decision.status).toBe('approved');
      });
    });
  });
});

describe('quorum: a tie is not a majority; a third vote breaks it', () => {
  const tied = async () => {
    const { log } = await setup({ mode: 'quorum', quorum_percentage: 50, quorum_majority_type: 'simple' });
    const id = proposed(log);
    vote(log, id, U.bob, 'approve');
    return { log, id };
  };

  describe('GIVEN one approval', () => {
    describe('WHEN carol requests a revision (a tie)', () => {
      it('THEN the decision stays proposed', async () => {
        const { log, id } = await tied();
        const tie = vote(log, id, U.carol, 'request_revision', 'unclear');
        expect(tie.decision.status).toBe('proposed');
      });
    });
  });

  describe('GIVEN a tied vote', () => {
    describe('WHEN david approves', () => {
      it('THEN the decision is approved', async () => {
        // Given
        const { log, id } = await tied();
        vote(log, id, U.carol, 'request_revision', 'unclear');
        // When
        const r = vote(log, id, U.david, 'approve');
        // Then
        expect(r.decision.status).toBe('approved');
      });
    });
  });
});

describe('quorum: 2/3 majority', () => {
  async function twoThirdsSplit(majority: string) {
    const { log } = await setup({ mode: 'quorum', quorum_percentage: 50, quorum_majority_type: majority });
    const id = proposed(log);
    vote(log, id, U.bob, 'approve');
    vote(log, id, U.carol, 'request_revision', 'hmm');
    return { log, id };
  }

  describe('GIVEN a 2_3_majority rule and a 1-1 split', () => {
    describe('WHEN david approves (2/3)', () => {
      it('THEN the decision is approved', async () => {
        const { log, id } = await twoThirdsSplit('2_3_majority');
        expect(vote(log, id, U.david, 'approve').decision.status).toBe('approved');
      });
    });
  });

  describe('GIVEN a 3_4_majority rule and a 1-1 split', () => {
    describe('WHEN david approves (2/3 < 3/4)', () => {
      it('THEN the decision stays proposed', async () => {
        const { log, id } = await twoThirdsSplit('3_4_majority');
        expect(vote(log, id, U.david, 'approve').decision.status).toBe('proposed');
      });
    });
  });
});

// ---- veto ----
describe('veto: auto-approves after the window unless blocked', () => {
  const vetoWindow = async () => {
    const { log, clock } = await setup({ mode: 'veto', auto_approve_after_days: 7 });
    return { log, clock, id: proposed(log) };
  };

  describe('GIVEN a 7-day veto window', () => {
    describe('WHEN a sweep runs on day 6', () => {
      it('THEN nothing is approved', async () => {
        // Given
        const { log, clock, id } = await vetoWindow();
        clock.advanceDays(6);
        // When
        const swept = log.sweep();
        // Then
        expect(swept).toEqual([]);
        expect(log.getDecision(id, U.alice).status).toBe('proposed');
      });
    });
    describe('WHEN a sweep runs on day 7', () => {
      it('THEN the decision is auto-approved with no approvers', async () => {
        // Given
        const { log, clock, id } = await vetoWindow();
        clock.advanceDays(7);
        // When
        const swept = log.sweep();
        // Then
        expect(swept).toEqual([id]);
        const d = log.getDecision(id, U.alice);
        expect(d.status).toBe('approved');
        expect(d.approvers).toEqual([]);
      });
    });
  });
});

describe('veto: a veto needs a reason and sends the decision back to draft', () => {
  const veto = async () => {
    const { log, clock } = await setup({ mode: 'veto', auto_approve_after_days: 7 });
    return { log, clock, id: proposed(log) };
  };

  describe('GIVEN veto mode', () => {
    describe('WHEN bob vetoes without a reason', () => {
      it('THEN VALIDATION_ERROR 400', async () => {
        const { log, id } = await veto();
        expectCode(() => vote(log, id, U.bob, 'request_revision'), 'VALIDATION_ERROR', 400);
      });
    });
    describe('WHEN bob vetoes with a reason', () => {
      it('THEN the decision returns to draft and the version records the reason', async () => {
        // Given
        const { log, id } = await veto();
        // When
        const r = vote(log, id, U.bob, 'request_revision', 'Conflicts with PRJ-010');
        // Then
        expect(r.decision.status).toBe('draft');
        expect(log.getVersions(id, U.bob)[0].reason).toBe('Conflicts with PRJ-010');
      });
    });
  });

  describe('GIVEN a vetoed decision', () => {
    describe('WHEN 30 days pass and a sweep runs', () => {
      it('THEN nothing is auto-approved', async () => {
        // Given
        const { log, clock, id } = await veto();
        vote(log, id, U.bob, 'request_revision', 'Conflicts with PRJ-010');
        clock.advanceDays(30);
        // When
        const swept = log.sweep();
        // Then
        expect(swept).toEqual([]);
      });
    });
  });
});

describe('veto: a lead can still approve explicitly', () => {
  describe('GIVEN veto mode and a proposed decision', () => {
    describe('WHEN the lead approves', () => {
      it('THEN it is approved', async () => {
        const { log } = await setup({ mode: 'veto', auto_approve_after_days: 7 });
        const id = proposed(log);
        expect(act(log, id, U.lead, 'approve').decision.status).toBe('approved');
      });
    });
  });
});

// ---- weighted quorum ----
describe('quorum: role weights make a lead count for more', () => {
  describe('GIVEN lead weight 3 (total weight 6)', () => {
    describe('WHEN the lead alone approves', () => {
      it('THEN the decision is approved', async () => {
        // Given
        const { log } = await setup({ mode: 'quorum', quorum_percentage: 50, vote_weights: { lead: 3 } });
        const id = proposed(log);
        // When
        const r = vote(log, id, U.lead, 'approve');
        // Then
        expect(r.decision.status).toBe('approved');
      });
    });
  });

  describe('GIVEN lead weight 3', () => {
    describe('WHEN the lead approves', () => {
      it('THEN the tally still reports head-counts', async () => {
        const { log } = await setup({ mode: 'quorum', quorum_percentage: 50, vote_weights: { lead: 3 } });
        const id = proposed(log);
        const r = vote(log, id, U.lead, 'approve');
        expect(r.metadata.vote_tally).toEqual({ approve: 1, request_revision: 0, abstain: 0 });
      });
    });
  });
});

describe('quorum: weighted opposition outweighs more numerous approvals', () => {
  describe('GIVEN two approvals', () => {
    describe('WHEN the weight-3 lead requests a revision (2 vs 3)', () => {
      it('THEN the decision stays proposed', async () => {
        // Given
        const { log } = await setup({ mode: 'quorum', quorum_percentage: 50, vote_weights: { lead: 3 } });
        const id = proposed(log);
        vote(log, id, U.bob, 'approve');
        vote(log, id, U.carol, 'approve');
        // When
        const r = vote(log, id, U.lead, 'request_revision', 'blocking concern');
        // Then
        expect(r.decision.status).toBe('proposed');
      });
    });
  });
});

describe('without weights the same lead vote is not enough', () => {
  describe('GIVEN a 50% quorum with default weights', () => {
    describe('WHEN the lead alone approves', () => {
      it('THEN the decision stays proposed', async () => {
        const { log } = await setup({ mode: 'quorum', quorum_percentage: 50 });
        const id = proposed(log);
        expect(vote(log, id, U.lead, 'approve').decision.status).toBe('proposed');
      });
    });
  });
});

describe('vote_weights are validated', () => {
  const rejects = async (weights: unknown) => {
    const { log } = await setup();
    expectCode(() => log.updateProjectSettings('PRJ', U.org, { approval_settings: { vote_weights: weights } }), 'VALIDATION_ERROR', 400);
  };

  describe('GIVEN project settings', () => {
    describe('WHEN a weight of 0 is set', () => {
      it('THEN VALIDATION_ERROR 400', () => rejects({ lead: 0 }));
    });
    describe('WHEN a non-numeric weight is set', () => {
      it('THEN VALIDATION_ERROR 400', () => rejects({ lead: 'heavy' }));
    });
    describe('WHEN an unknown role is weighted', () => {
      it('THEN VALIDATION_ERROR 400', () => rejects({ king: 2 }));
    });
  });

  describe('GIVEN default settings', () => {
    describe('WHEN vote_weights are read', () => {
      it('THEN member weighs 1', async () => {
        const { log } = await setup();
        expect(log.getProject('PRJ').approval_settings.vote_weights.member).toBe(1);
      });
    });
  });
});
