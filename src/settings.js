import { invalid } from './errors.js';

export const MODES = ['single_approval', 'consensus_voting', 'quorum', 'veto'];
export const MAJORITY_TYPES = ['simple', '2_3_majority', '3_4_majority'];

export const DEFAULT_APPROVAL_SETTINGS = Object.freeze({
  mode: 'single_approval',
  enabled_voting: false,
  consensus_approval_threshold: 0.8,
  consensus_min_votes: 3,
  consensus_allow_revision_request: true,
  quorum_percentage: 50,
  quorum_majority_type: 'simple',
  allow_abstain: true,
  require_reason_on_revision: true,
  auto_approve_after_days: null,
  notification_on_vote: true,
  revision_vote_resets_count: true,
  vote_weights: { member: 1, lead: 1, admin: 1 }, // quorum mode only
});

export function resolveSettings(input = {}, base = DEFAULT_APPROVAL_SETTINGS) {
  const s = { ...base, ...input };
  const weights = input.vote_weights ?? {};
  if (typeof weights !== 'object' || weights === null || Array.isArray(weights)) throw invalid('vote_weights must be an object');
  for (const [role, w] of Object.entries(weights)) {
    if (!(role in DEFAULT_APPROVAL_SETTINGS.vote_weights)) throw invalid(`vote_weights: unknown role "${role}"`);
    if (typeof w !== 'number' || !(w > 0)) throw invalid('vote_weights values must be positive numbers');
  }
  s.vote_weights = { ...base.vote_weights, ...weights };
  if (!MODES.includes(s.mode)) throw invalid(`mode must be one of ${MODES.join(', ')}`);
  if (!(s.consensus_approval_threshold > 0 && s.consensus_approval_threshold <= 1)) throw invalid('consensus_approval_threshold must be in (0, 1]');
  if (!Number.isInteger(s.consensus_min_votes) || s.consensus_min_votes < 1) throw invalid('consensus_min_votes must be a positive integer');
  if (!(s.quorum_percentage >= 1 && s.quorum_percentage <= 100)) throw invalid('quorum_percentage must be between 1 and 100');
  if (!MAJORITY_TYPES.includes(s.quorum_majority_type)) throw invalid(`quorum_majority_type must be one of ${MAJORITY_TYPES.join(', ')}`);
  if (s.auto_approve_after_days !== null && !(Number.isInteger(s.auto_approve_after_days) && s.auto_approve_after_days > 0)) {
    throw invalid('auto_approve_after_days must be null or a positive integer');
  }
  s.enabled_voting = s.mode !== 'single_approval';
  return s;
}
