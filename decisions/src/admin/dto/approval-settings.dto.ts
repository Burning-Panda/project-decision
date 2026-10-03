export class ApprovalSettingsDto {
  mode?: 'single_approval' | 'consensus_voting' | 'quorum' | 'veto';
  enabled_voting?: boolean;
  consensus_approval_threshold?: number;
  consensus_min_votes?: number;
  allow_abstain?: boolean;
  require_reason_on_revision?: boolean;
  auto_approve_after_days?: number | null;
  notification_on_vote?: boolean;
  revision_vote_resets_count?: boolean;
  quorum_percentage?: number;
  quorum_majority_type?: 'simple' | '2_3_majority' | '3_4_majority';
  vote_weights?: Record<string, number>;
}
