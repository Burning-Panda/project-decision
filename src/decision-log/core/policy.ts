import { NotImplementedError } from '../../common/errors';
import type { TeamRole } from '../teams/team';
import type { Permission } from './permissions';

/** What can be asked for: every permission, plus the owner-only lifecycle actions. */
export type Action = Permission | 'decision:propose' | 'decision:edit_draft' | 'decision:return_to_draft';

/** Everything a rule may look at. The service loads these facts; the rules only compare them. */
export interface AccessRequest {
  subject: {
    id: string;
    /** Role in the resource's team, or null for someone outside that team. */
    role: TeamRole | null;
    /** True for the owner identifier, which acts as organisation admin. */
    orgAdmin: boolean;
  };
  action: Action;
  /** The decision being acted on; omit for team-level actions. */
  resource?: { owner: string };
}

export type DenyReason = 'not_a_member' | 'own_decision' | 'not_owner' | 'missing_permission';

export type AccessVerdict = { allow: true } | { allow: false; reason: DenyReason };

/** Pure: no store, no clock. Default deny; an explicit prohibition beats any grant. */
export function authorize(_request: AccessRequest): AccessVerdict {
  throw new NotImplementedError('authorize');
}
