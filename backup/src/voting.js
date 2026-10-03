/**
 * Pure vote evaluation. `tally` is {approve, request_revision, abstain};
 * `eligible` is the number of people who may vote (team members minus the owner).
 * Returns true when the decision should be approved.
 *
 * consensus_voting: non-abstain votes >= consensus_min_votes AND approve share >= threshold.
 * quorum:           (role-weighted) turnout (incl. abstentions) >= quorum_percentage AND approve share meets the majority type.
 * single_approval / veto: never closed by votes (approver action or auto-approve sweep).
 */
export function tallyVotes(votes, weightOf = () => 1) {
  const t = { approve: 0, request_revision: 0, abstain: 0 };
  for (const v of votes) t[v.vote] += weightOf(v.voter);
  return t;
}

export function isApproved(settings, tally, eligible) {
  const decisive = tally.approve + tally.request_revision;
  if (settings.mode === 'consensus_voting') {
    return decisive >= settings.consensus_min_votes
      && tally.approve >= settings.consensus_approval_threshold * decisive - 1e-9;
  }
  if (settings.mode === 'quorum') {
    const turnout = decisive + tally.abstain;
    if (eligible === 0 || turnout * 100 < settings.quorum_percentage * eligible) return false;
    if (decisive === 0) return false;
    switch (settings.quorum_majority_type) {
      case '2_3_majority': return tally.approve * 3 >= decisive * 2;
      case '3_4_majority': return tally.approve * 4 >= decisive * 3;
      default: return tally.approve * 2 > decisive;
    }
  }
  return false;
}
