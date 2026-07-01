import { PermissionsService } from './permissions.service';

/**
 * Regression test for migration
 * `20260611120000_backfill_legacy_member_roles`.
 *
 * Context: authorization drifted between two systems. The legacy
 * `organization_members.role` enum is the old model; the new RBAC model uses
 * `member_roles` rows linking a member to a system `role_definitions` row
 * (matched by slug, is_system = true, organization_id IS NULL).
 * `PermissionsService.getEffectivePermissions` and the `isPlatformAdmin`
 * derivation in jwt.strategy read ONLY from `member_roles`, so a member with a
 * legacy `role='owner'` but no `member_roles` row resolves to ZERO permissions
 * → isPlatformAdmin=false → paywall preview, despite owning the platform.
 *
 * The fix is a pure data backfill (no schema change, no code-path change). This
 * test ports the migration's exact set-semantics to an in-memory fixture so the
 * effect is asserted without a live database (jest here runs with mocked Prisma,
 * no Postgres), then verifies the downstream authorization outcome through the
 * real PermissionsService.
 */

// ---------------------------------------------------------------------------
// Faithful in-memory port of the backfill SQL.
//
//   INSERT INTO member_roles (...)
//   SELECT gen_random_uuid(), om.id, rd.id, om.user_id, now()
//   FROM organization_members om
//   JOIN role_definitions rd
//     ON rd.slug = om.role AND rd.is_system = true AND rd.organization_id IS NULL
//   WHERE NOT EXISTS (
//     SELECT 1 FROM member_roles mr
//     WHERE mr.organization_member_id = om.id AND mr.role_definition_id = rd.id
//   );
// ---------------------------------------------------------------------------

interface RoleDefRow {
  id: string;
  slug: string;
  isSystem: boolean;
  organizationId: string | null;
}
interface MemberRow {
  id: string;
  role: string;
  userId: string;
}
interface MemberRoleRow {
  organizationMemberId: string;
  roleDefinitionId: string;
  assignedByUserId: string | null;
}

/**
 * Returns the rows the backfill INSERT would add, given the current fixture
 * state. Mutates nothing — caller appends the result to simulate the INSERT.
 */
function runBackfill(
  members: MemberRow[],
  roleDefs: RoleDefRow[],
  existing: MemberRoleRow[],
): MemberRoleRow[] {
  const inserted: MemberRoleRow[] = [];
  for (const om of members) {
    // JOIN role_definitions rd ON rd.slug = om.role AND rd.is_system = true
    //   AND rd.organization_id IS NULL
    const rd = roleDefs.find(
      (r) => r.slug === om.role && r.isSystem === true && r.organizationId === null,
    );
    if (!rd) continue; // legacy role with no matching system role_definition → skipped

    // WHERE NOT EXISTS (already-linked guard — idempotency)
    const alreadyLinked = [...existing, ...inserted].some(
      (mr) => mr.organizationMemberId === om.id && mr.roleDefinitionId === rd.id,
    );
    if (alreadyLinked) continue;

    inserted.push({
      organizationMemberId: om.id,
      roleDefinitionId: rd.id,
      assignedByUserId: om.userId, // SELECT ... om.user_id
    });
  }
  return inserted;
}

describe('backfill_legacy_member_roles migration', () => {
  // System role definitions (organization_id IS NULL, is_system = true)
  const ROLE_OWNER_SYS: RoleDefRow = {
    id: 'rd-owner-sys',
    slug: 'owner',
    isSystem: true,
    organizationId: null,
  };
  const ROLE_ADMIN_SYS: RoleDefRow = {
    id: 'rd-admin-sys',
    slug: 'admin',
    isSystem: true,
    organizationId: null,
  };
  // Decoys that must NOT be matched by the JOIN:
  const ROLE_OWNER_ORG_SCOPED: RoleDefRow = {
    id: 'rd-owner-org',
    slug: 'owner',
    isSystem: true,
    organizationId: 'org-1', // organization_id IS NOT NULL → excluded
  };
  const ROLE_OWNER_NON_SYSTEM: RoleDefRow = {
    id: 'rd-owner-custom',
    slug: 'owner',
    isSystem: false, // is_system = false → excluded
    organizationId: null,
  };

  const roleDefs = [
    ROLE_OWNER_SYS,
    ROLE_ADMIN_SYS,
    ROLE_OWNER_ORG_SCOPED,
    ROLE_OWNER_NON_SYSTEM,
  ];

  describe('SQL effect on fixture', () => {
    it('backfills an orphaned legacy owner with the system owner role_definition', () => {
      const members: MemberRow[] = [
        { id: 'm-orphan-owner', role: 'owner', userId: 'u-1' },
      ];
      const existing: MemberRoleRow[] = []; // no member_roles row yet

      const inserted = runBackfill(members, roleDefs, existing);

      expect(inserted).toEqual([
        {
          organizationMemberId: 'm-orphan-owner',
          roleDefinitionId: 'rd-owner-sys',
          assignedByUserId: 'u-1',
        },
      ]);
      // Must NOT link the org-scoped or non-system owner defs
      expect(inserted.map((r) => r.roleDefinitionId)).not.toContain('rd-owner-org');
      expect(inserted.map((r) => r.roleDefinitionId)).not.toContain('rd-owner-custom');
    });

    it('skips members already linked to their system role (NOT EXISTS guard)', () => {
      const members: MemberRow[] = [
        { id: 'm-linked-admin', role: 'admin', userId: 'u-2' },
      ];
      const existing: MemberRoleRow[] = [
        {
          organizationMemberId: 'm-linked-admin',
          roleDefinitionId: 'rd-admin-sys',
          assignedByUserId: 'u-9',
        },
      ];

      const inserted = runBackfill(members, roleDefs, existing);

      expect(inserted).toEqual([]);
    });

    it('skips legacy roles that have no matching system role_definition', () => {
      const members: MemberRow[] = [
        { id: 'm-guest', role: 'guest', userId: 'u-3' }, // no 'guest' system role
      ];

      const inserted = runBackfill(members, roleDefs, []);

      expect(inserted).toEqual([]);
    });

    it('is a no-op on a fully-linked DB (re-run idempotency)', () => {
      // Mixed prod-like fixture: 12 owners, 1 editor + extras
      const members: MemberRow[] = [
        ...Array.from({ length: 12 }, (_, i) => ({
          id: `m-owner-${i}`,
          role: 'owner',
          userId: `u-owner-${i}`,
        })),
        { id: 'm-admin', role: 'admin', userId: 'u-admin' },
      ];

      // First run links everyone.
      const firstRun = runBackfill(members, roleDefs, []);
      expect(firstRun).toHaveLength(13);

      // Second run against the now-linked state must insert nothing.
      const secondRun = runBackfill(members, roleDefs, firstRun);
      expect(secondRun).toEqual([]);

      // Third run for good measure — still a no-op.
      const thirdRun = runBackfill(members, roleDefs, [...firstRun, ...secondRun]);
      expect(thirdRun).toEqual([]);
    });
  });

  describe('downstream authorization after backfill', () => {
    it('an orphaned owner regains tenant perms; isPlatformAdmin stays false', async () => {
      // 1. Orphaned owner: legacy role='owner', zero member_roles.
      const members: MemberRow[] = [
        { id: 'member-owner', role: 'owner', userId: 'u-owner' },
      ];
      const inserted = runBackfill(members, roleDefs, []);
      expect(inserted).toHaveLength(1);
      const firstInserted = inserted[0];
      if (!firstInserted) throw new Error('expected exactly one inserted row');
      const ownerRoleId = firstInserted.roleDefinitionId; // 'rd-owner-sys'

      // 2. Resolve effective permissions through the REAL service, with Prisma
      //    mocked to reflect the post-backfill member_roles state. The owner
      //    system role grants all TENANT permissions — the admin:* family was
      //    stripped by 20260702120000_strip_owner_platform_admin (platform
      //    admin now comes only from the allowlisted system 'admin' role; see
      //    strip-owner-platform-admin.spec.ts).
      const prisma = {
        memberRole: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ roleDefinitionId: ownerRoleId }]),
        },
        roleHierarchy: { findMany: jest.fn().mockResolvedValue([]) },
        rolePermission: {
          findMany: jest.fn().mockResolvedValue([
            { permission: { code: 'documents:read' } },
            { permission: { code: 'matters:read' } },
            { permission: { code: 'subscriptions:manage' } },
          ]),
        },
      };
      const cache = {
        getCachedPermissions: jest.fn().mockResolvedValue(null),
        setCachedPermissions: jest.fn().mockResolvedValue(undefined),
      };

      const service = new PermissionsService(prisma as never, cache as never);
      const perms = await service.getEffectivePermissions('member-owner');

      // 3a. getEffectivePermissions restores the owner's tenant perms (the
      //     paywall-preview bug this backfill fixed).
      expect(perms).toEqual(
        expect.arrayContaining(['documents:read', 'subscriptions:manage']),
      );

      // 3b. The jwt.strategy derivation `perms.some(p => p.startsWith('admin:'))`
      //     — i.e. isPlatformAdmin — stays false: ownership no longer confers
      //     platform administration.
      const isPlatformAdmin = perms.some((p) => p.startsWith('admin:'));
      expect(isPlatformAdmin).toBe(false);
    });

    it('without backfill an orphaned owner has no perms and isPlatformAdmin=false', async () => {
      // Sanity check on the bug being fixed: no member_roles row → empty perms.
      const prisma = {
        memberRole: { findMany: jest.fn().mockResolvedValue([]) },
        roleHierarchy: { findMany: jest.fn() },
        rolePermission: { findMany: jest.fn() },
      };
      const cache = {
        getCachedPermissions: jest.fn().mockResolvedValue(null),
        setCachedPermissions: jest.fn().mockResolvedValue(undefined),
      };

      const service = new PermissionsService(prisma as never, cache as never);
      const perms = await service.getEffectivePermissions('member-owner');

      expect(perms).toEqual([]);
      expect(perms.some((p) => p.startsWith('admin:'))).toBe(false);
    });
  });
});
