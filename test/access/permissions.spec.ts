import { describe, it, expect, beforeEach } from 'bun:test';
import { PERMISSIONS, permissionsOf, hasPermission } from '../support/index';

// Pure functions: roles are only named bundles of permissions. Code asks for a permission, never for a role name.
const sorted = (xs: readonly string[]) => [...xs].sort();

describe('permissionsOf: each role grants a fixed bundle of permissions', () => {
  const bundles: Array<[string, string[]]> = [
    ['member', ['decision:read', 'decision:create', 'decision:vote']],
    ['lead', ['decision:read', 'decision:create', 'decision:vote', 'decision:approve', 'decision:decline']],
    ['admin', ['decision:read', 'decision:create', 'decision:vote', 'decision:approve', 'decision:decline', 'team:manage_members']],
  ];

  for (const [role, expected] of bundles) {
    describe(`GIVEN the role ${role}`, () => {
      describe('WHEN its permissions are listed', () => {
        let granted: readonly string[];
        beforeEach(() => { granted = permissionsOf(role as any); });

        it('THEN they are exactly the documented bundle', () => {
          expect(sorted(granted)).toEqual(sorted(expected));
        });
      });
    });
  }
});

describe('permissionsOf: the roles nest and no permission is dead', () => {
  describe('GIVEN the three roles', () => {
    describe('WHEN their bundles are compared', () => {
      it('THEN every lead permission is also an admin permission, and every member permission a lead permission', () => {
        expect(permissionsOf('member').every((p) => permissionsOf('lead').includes(p))).toBe(true);
        expect(permissionsOf('lead').every((p) => permissionsOf('admin').includes(p))).toBe(true);
      });
      it('THEN every known permission is granted to at least one role', () => {
        for (const p of PERMISSIONS) {
          expect((['member', 'lead', 'admin'] as const).some((r) => permissionsOf(r).includes(p)), `${p} is granted to nobody`).toBe(true);
        }
      });
    });
  });
});

describe('hasPermission asks for a capability, not a role name', () => {
  describe('GIVEN a lead', () => {
    describe('WHEN asked about approving and about managing members', () => {
      it('THEN it may approve but not manage members', () => {
        expect(hasPermission('lead', 'decision:approve')).toBe(true);
        expect(hasPermission('lead', 'team:manage_members')).toBe(false);
      });
    });
  });

  describe('GIVEN someone with no role in the team', () => {
    describe('WHEN asked about any permission', () => {
      it('THEN the answer is no (default deny)', () => {
        for (const p of PERMISSIONS) expect(hasPermission(null, p), p).toBe(false);
      });
    });
  });

  describe('GIVEN a role that does not exist', () => {
    describe('WHEN asked about any permission', () => {
      it('THEN the answer is no, and nothing throws', () => {
        for (const p of PERMISSIONS) expect(hasPermission('superuser' as any, p), p).toBe(false);
      });
    });
  });
});
