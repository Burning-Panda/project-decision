import { NotImplementedError } from '../../common/errors';
import type { TeamRole } from '../teams/team';

/** Every capability the rules talk about. Code asks for a permission, never for a role name. */
export const PERMISSIONS = [
  'decision:read',
  'decision:create',
  'decision:vote',
  'decision:approve',
  'decision:decline',
  'team:manage_members',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** The permissions a role grants. Roles are only named bundles of permissions. */
export function permissionsOf(_role: TeamRole): readonly Permission[] {
  throw new NotImplementedError('permissionsOf');
}

export function hasPermission(_role: TeamRole | null, _permission: Permission): boolean {
  throw new NotImplementedError('hasPermission');
}
