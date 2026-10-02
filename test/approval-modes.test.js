import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, proposed, act, assertCode, U } from './helpers.js';

const vote = (log, id, who, v, comment) => act(log, id, who, 'vote', { vote: v, comment });

test('project settings are merged over documented defaults', () => {
  const { log } = setup({ mode: 'consensus_voting' });
  const s = log.getProject('PRJ').approval_settings;
  assert.equal(s.mode, 'consensus_voting');
  assert.equal(s.enabled_voting, true);
  assert.equal(s.consensus_approval_threshold, 0.8);
  assert.equal(s.consensus_min_votes, 3);
  assert.equal(s.allow_abstain, true);
  assert.equal(s.require_reason_on_revision, true);
  assert.equal(s.auto_approve_after_days, null);
  assert.equal(s.notification_on_vote, true);
  assert.equal(s.revision_vote_resets_count, true);
  assert.equal(setup().log.getProject('PRJ').approval_settings.mode, 'single_approval');
  assert.equal(setup().log.getProject('PRJ').approval_settings.enabled_voting, false);
});

test('invalid approval mode is rejected', () => {
  const { log } = setup();
  assertCode(() => log.createProject({ owner: 'acme', identifier: 'BAD', title: 'x', actor: U.org,
    settings: { approval_settings: { mode: 'coin_flip' } } }), 'VALIDATION_ERROR', 400);
});

// ---- single approval ----
test('single approval: members and the owner cannot approve; voting is disabled', () => {
  const { log } = setup();
  const id = proposed(log);
  assertCode(() => act(log, id, U.bob, 'approve'), 'FORBIDDEN', 403);
  assertCode(() => act(log, id, U.alice, 'approve'), 'FORBIDDEN', 403);
  assertCode(() => vote(log, id, U.bob, 'approve'), 'VOTING_DISABLED', 409);
  const own = proposed(log, { actor: U.lead });
  assertCode(() => act(log, own, U.lead, 'approve'), 'FORBIDDEN', 403);
});

// ---- consensus ----
test('consensus: approves at 3 approvals (80%+), returning 202 when the vote closes it', () => {
  const { log } = setup({ mode: 'consensus_voting' });
  const id = proposed(log);
  const r1 = vote(log, id, U.bob, 'approve', 'solid');
  assert.equal(r1.status_code, 200);
  assert.deepEqual(r1.metadata.vote_tally, { approve: 1, request_revision: 0, abstain: 0 });
  assert.equal(vote(log, id, U.carol, 'approve').decision.status, 'proposed');
  const r3 = vote(log, id, U.david, 'approve');
  assert.equal(r3.status_code, 202);
  assert.equal(r3.decision.status, 'approved');
  assert.equal(r3.decision.approvers.length, 3);
});

test('consensus: 75% approval is not enough', () => {
  const { log } = setup({ mode: 'consensus_voting' });
  const id = proposed(log);
  vote(log, id, U.bob, 'approve');
  vote(log, id, U.carol, 'request_revision', 'need monitoring docs');
  vote(log, id, U.david, 'approve');
  const r = vote(log, id, U.lead, 'approve');
  assert.equal(r.decision.status, 'proposed');
  assert.deepEqual(r.metadata.vote_tally, { approve: 3, request_revision: 1, abstain: 0 });
});

test('consensus: abstentions do not count toward minimum votes or the ratio', () => {
  const { log } = setup({ mode: 'consensus_voting' });
  const id = proposed(log);
  vote(log, id, U.bob, 'approve');
  vote(log, id, U.carol, 'approve');
  assert.equal(vote(log, id, U.david, 'abstain').decision.status, 'proposed');
  assert.equal(vote(log, id, U.lead, 'approve').decision.status, 'approved');
});

test('consensus: abstain can be disabled; revision votes need a reason', () => {
  const { log } = setup({ mode: 'consensus_voting', allow_abstain: false });
  const id = proposed(log);
  assertCode(() => vote(log, id, U.bob, 'abstain'), 'VALIDATION_ERROR', 400);
  assertCode(() => vote(log, id, U.bob, 'request_revision'), 'VALIDATION_ERROR', 400);
  assertCode(() => vote(log, id, U.bob, 'maybe'), 'VALIDATION_ERROR', 400);
});

test('consensus: a voter can change their vote while the decision is open', () => {
  const { log } = setup({ mode: 'consensus_voting' });
  const id = proposed(log);
  vote(log, id, U.bob, 'approve');
  const r = vote(log, id, U.bob, 'request_revision', 'changed my mind');
  assert.deepEqual(r.metadata.vote_tally, { approve: 0, request_revision: 1, abstain: 0 });
  assert.equal(log.getDecision(id, U.bob).votes.length, 1);
});

test('consensus: owner and outsiders cannot vote; only proposed decisions accept votes', () => {
  const { log } = setup({ mode: 'consensus_voting' });
  const id = proposed(log);
  assertCode(() => vote(log, id, U.alice, 'approve'), 'FORBIDDEN', 403);
  assertCode(() => vote(log, id, U.outsider, 'approve'), 'FORBIDDEN', 403);
  const d = log.createDecision({ project: 'PRJ', actor: U.alice, title: 'draft one' });
  assertCode(() => vote(log, d.id, U.bob, 'approve'), 'INVALID_STATE', 409);
});

test('consensus: the approve action counts as an approve vote (202)', () => {
  const { log } = setup({ mode: 'consensus_voting' });
  const id = proposed(log);
  const r = act(log, id, U.bob, 'approve', { comment: 'LGTM' });
  assert.equal(r.status_code, 202);
  assert.equal(r.metadata.vote_tally.approve, 1);
  assert.equal(r.decision.status, 'proposed');
});

// ---- quorum ----
test('quorum: needs turnout before a majority can approve', () => {
  const { log } = setup({ mode: 'quorum', quorum_percentage: 50, quorum_majority_type: 'simple' });
  const id = proposed(log);
  assert.equal(vote(log, id, U.bob, 'approve').decision.status, 'proposed'); // 1 of 4 voters
  assert.equal(vote(log, id, U.carol, 'approve').decision.status, 'approved'); // 2 of 4
});

test('quorum: a tie is not a majority; a third vote breaks it', () => {
  const { log } = setup({ mode: 'quorum', quorum_percentage: 50, quorum_majority_type: 'simple' });
  const id = proposed(log);
  vote(log, id, U.bob, 'approve');
  const tie = vote(log, id, U.carol, 'request_revision', 'unclear');
  assert.equal(tie.decision.status, 'proposed');
  assert.equal(vote(log, id, U.david, 'approve').decision.status, 'approved');
});

test('quorum: 2/3 majority', () => {
  const { log } = setup({ mode: 'quorum', quorum_percentage: 50, quorum_majority_type: '2_3_majority' });
  const id = proposed(log);
  vote(log, id, U.bob, 'approve');
  vote(log, id, U.carol, 'request_revision', 'hmm');
  assert.equal(vote(log, id, U.david, 'approve').decision.status, 'approved'); // 2/3
  const strict = setup({ mode: 'quorum', quorum_percentage: 50, quorum_majority_type: '3_4_majority' });
  const id2 = proposed(strict.log);
  vote(strict.log, id2, U.bob, 'approve');
  vote(strict.log, id2, U.carol, 'request_revision', 'hmm');
  assert.equal(vote(strict.log, id2, U.david, 'approve').decision.status, 'proposed'); // 2/3 < 3/4
});

// ---- veto ----
test('veto: auto-approves after the window unless blocked', () => {
  const { log, clock } = setup({ mode: 'veto', auto_approve_after_days: 7 });
  const id = proposed(log);
  clock.advanceDays(6);
  assert.deepEqual(log.sweep(), []);
  assert.equal(log.getDecision(id, U.alice).status, 'proposed');
  clock.advanceDays(1);
  assert.deepEqual(log.sweep(), [id]);
  const d = log.getDecision(id, U.alice);
  assert.equal(d.status, 'approved');
  assert.deepEqual(d.approvers, []);
});

test('veto: a veto needs a reason and sends the decision back to draft', () => {
  const { log, clock } = setup({ mode: 'veto', auto_approve_after_days: 7 });
  const id = proposed(log);
  assertCode(() => vote(log, id, U.bob, 'request_revision'), 'VALIDATION_ERROR', 400);
  const r = vote(log, id, U.bob, 'request_revision', 'Conflicts with PRJ-010');
  assert.equal(r.decision.status, 'draft');
  assert.equal(log.getVersions(id, U.bob)[0].reason, 'Conflicts with PRJ-010');
  clock.advanceDays(30);
  assert.deepEqual(log.sweep(), []);
});

test('veto: a lead can still approve explicitly', () => {
  const { log } = setup({ mode: 'veto', auto_approve_after_days: 7 });
  const id = proposed(log);
  assert.equal(act(log, id, U.lead, 'approve').decision.status, 'approved');
});

// ---- weighted quorum ----
test('quorum: role weights make a lead count for more', () => {
  const { log } = setup({ mode: 'quorum', quorum_percentage: 50, vote_weights: { lead: 3 } });
  const id = proposed(log);
  // total weight = 1+1+1+3 = 6; the lead alone is 50% turnout and a unanimous majority
  const r = vote(log, id, U.lead, 'approve');
  assert.equal(r.decision.status, 'approved');
  assert.deepEqual(r.metadata.vote_tally, { approve: 1, request_revision: 0, abstain: 0 }, 'tally still reports head-counts');
});

test('quorum: weighted opposition outweighs more numerous approvals', () => {
  const { log } = setup({ mode: 'quorum', quorum_percentage: 50, vote_weights: { lead: 3 } });
  const id = proposed(log);
  vote(log, id, U.bob, 'approve');
  vote(log, id, U.carol, 'approve');
  const r = vote(log, id, U.lead, 'request_revision', 'blocking concern'); // 2 vs 3
  assert.equal(r.decision.status, 'proposed');
});

test('without weights the same lead vote is not enough', () => {
  const { log } = setup({ mode: 'quorum', quorum_percentage: 50 });
  const id = proposed(log);
  assert.equal(vote(log, id, U.lead, 'approve').decision.status, 'proposed');
});

test('vote_weights are validated', () => {
  const { log } = setup();
  const bad = (w) => assertCode(() => log.updateProjectSettings('PRJ', U.org, { approval_settings: { vote_weights: w } }), 'VALIDATION_ERROR', 400);
  bad({ lead: 0 });
  bad({ lead: 'heavy' });
  bad({ king: 2 });
  assert.equal(log.getProject('PRJ').approval_settings.vote_weights.member, 1);
});
