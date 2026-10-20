import { PermissionsService } from './permissions.service';

// tsconfig's rootDir is 'src', so a static import of prisma/seeds fails tsc
// with TS6059. require() keeps the runtime dependency on the REAL seed file
// (ts-jest still transforms it) while keeping it out of the compile graph.
const { HIERARCHY_EDGES, ROLE_PERMISSIONS } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../prisma/seeds/rbac-seed') as {
    HIERARCHY_EDGES: Array<{ parent: string; child: string }>;
    ROLE_PERMISSIONS: Record<string, string[]>;
  };

/**
 * Regression test for migration
 * `20260921120000_backfill_member_roles_for_legacy_owners` and the matching
 * registration dual-write.
 *
 * Authorization reads `member_roles` ONLY — neither
 * PermissionsService.getEffectivePermissions nor the isPlatformAdmin
 * derivation looks at the legacy `organization_members.role` column. Both
 * registration paths wrote only that column, so every signup after the
 * 2026-06-11 backfill resolved to ZERO permissions. 43 active owners on prod,
 * measured 2026-09-21.
 *
 * The thing that makes the backfill safe is its ordering against
 * `20260920140000_platform_role_grants`: before that migration the system
 * `owner` role still carries `digests:review`, and DigestsAdminController
 * accepts {digests:review, admin:review-queue} with mode 'any' — so
 * backfilling first would hand the editorial review queue to all 43. The
 * assertion that a backfilled owner does NOT gain `digests:review` is the
 * whole point of this file.
 */

// ---------------------------------------------------------------------------
// Faithful in-memory port of the backfill SQL:
//
//   INSERT INTO member_roles (...)
//   SELECT gen_random_uuid(), om.id, rd.id, om.user_id, now()
//   FROM organization_members om
//   JOIN role_definitions rd
//     ON rd.slug = om.role AND rd.is_system = true AND rd.organization_id IS NULL
//   WHERE om.status = 'active'
//     AND NOT EXISTS (
//       SELECT 1 FROM member_roles mr
//       WHERE mr.organization_member_id = om.id AND mr.role_definition_id = rd.id
//     );
// ---------------------------------------------------------------------------

interface RoleDefRow {
  id: string;
  slug: string;
  isSystem: boolean;
  organizationId: string | null;
}

interface MemberRow {
  id: string;
  userId: string;
  /** The legacy organization_members.role string column. */
  role: string;
  status: string;
}

interface MemberRoleRow {
  organizationMemberId: string;
  roleDefinitionId: string;
}

function runBackfill(
  members: MemberRow[],
  roleDefs: RoleDefRow[],
  existing: MemberRoleRow[],
): MemberRoleRow[] {
  const inserted: MemberRoleRow[] = [];

  for (const member of members) {
    if (member.status !== 'active') continue;

    const match = roleDefs.find(
      (rd) =>
        rd.slug === member.role &&
        rd.isSystem &&
        rd.organizationId === null,
    );
    if (!match) continue;

    const alreadyLinked = [...existing, ...inserted].some(
      (mr) =>
        mr.organizationMemberId === member.id &&
        mr.roleDefinitionId === match.id,
    );
    if (alreadyLinked) continue;

    inserted.push({
      organizationMemberId: member.id,
      roleDefinitionId: match.id,
    });
  }

  return inserted;
}

const ROLE_ID: Record<string, string> = {
  owner: 'rd-owner-sys',
  admin: 'rd-admin-sys',
  editor: 'rd-editor-sys',
  reviewer: 'rd-reviewer-sys',
  member: 'rd-member-sys',
  student: 'rd-student-sys',
};

const SYSTEM_ROLES: RoleDefRow[] = Object.entries(ROLE_ID).map(
  ([slug, id]) => ({ id, slug, isSystem: true, organizationId: null }),
);

/** An org-custom role that happens to share the 'owner' slug. Must be ignored. */
const ORG_CUSTOM_OWNER: RoleDefRow = {
  id: 'rd-owner-org',
  slug: 'owner',
  isSystem: false,
  organizationId: 'org-1',
};

/**
 * The prod shape: 43 active owners with no member_roles row. The exact count
 * is what the migration was measured against, so it is fixed here rather than
 * left as "a few".
 */
const LEGACY_OWNER_COUNT = 43;

function legacyOwners(count = LEGACY_OWNER_COUNT): MemberRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `member-${i}`,
    userId: `user-${i}`,
    role: 'owner',
    status: 'active',
  }));
}

// ---------------------------------------------------------------------------

describe('backfill_member_roles_for_legacy_owners — set semantics', () => {
  it('links all 43 legacy owners, one row each', () => {
    const inserted = runBackfill(legacyOwners(), SYSTEM_ROLES, []);

    expect(inserted).toHaveLength(LEGACY_OWNER_COUNT);
    expect(inserted.every((r) => r.roleDefinitionId === ROLE_ID['owner'])).toBe(
      true,
    );
    expect(new Set(inserted.map((r) => r.organizationMemberId)).size).toBe(
      LEGACY_OWNER_COUNT,
    );
  });

  it('is idempotent — a second run inserts nothing', () => {
    const members = legacyOwners();
    const first = runBackfill(members, SYSTEM_ROLES, []);
    const second = runBackfill(members, SYSTEM_ROLES, first);

    expect(second).toEqual([]);
  });

  it('skips a membership that already has its link', () => {
    const members = legacyOwners(3);
    const existing: MemberRoleRow[] = [
      { organizationMemberId: 'member-0', roleDefinitionId: ROLE_ID['owner']! },
    ];

    const inserted = runBackfill(members, SYSTEM_ROLES, existing);

    expect(inserted.map((r) => r.organizationMemberId)).toEqual([
      'member-1',
      'member-2',
    ]);
  });

  it('skips inactive memberships', () => {
    const members: MemberRow[] = [
      { id: 'm-active', userId: 'u-1', role: 'owner', status: 'active' },
      { id: 'm-removed', userId: 'u-2', role: 'owner', status: 'removed' },
      { id: 'm-invited', userId: 'u-3', role: 'owner', status: 'invited' },
    ];

    const inserted = runBackfill(members, SYSTEM_ROLES, []);

    expect(inserted.map((r) => r.organizationMemberId)).toEqual(['m-active']);
  });

  it('never links an ORG-CUSTOM role that shares the slug', () => {
    // `organization_id IS NULL AND is_system = true` in the JOIN is what stops
    // a tenant's own "owner" role becoming the system one.
    const members = legacyOwners(1);

    const inserted = runBackfill(members, [ORG_CUSTOM_OWNER, ...SYSTEM_ROLES], []);

    expect(inserted).toEqual([
      { organizationMemberId: 'member-0', roleDefinitionId: ROLE_ID['owner'] },
    ]);
  });

  it('links each legacy role to its own system role, not just owner', () => {
    const members: MemberRow[] = [
      { id: 'm-1', userId: 'u-1', role: 'owner', status: 'active' },
      { id: 'm-2', userId: 'u-2', role: 'member', status: 'active' },
      { id: 'm-3', userId: 'u-3', role: 'editor', status: 'active' },
    ];

    const inserted = runBackfill(members, SYSTEM_ROLES, []);

    expect(inserted).toEqual([
      { organizationMemberId: 'm-1', roleDefinitionId: ROLE_ID['owner'] },
      { organizationMemberId: 'm-2', roleDefinitionId: ROLE_ID['member'] },
      { organizationMemberId: 'm-3', roleDefinitionId: ROLE_ID['editor'] },
    ]);
  });

  it('skips a legacy role with no matching system role rather than guessing', () => {
    const members: MemberRow[] = [
      { id: 'm-odd', userId: 'u-1', role: 'superuser', status: 'active' },
    ];

    expect(runBackfill(members, SYSTEM_ROLES, [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// What a backfilled owner can actually do, resolved through the REAL
// PermissionsService against the REAL seed matrix.
// ---------------------------------------------------------------------------

describe('backfill_member_roles_for_legacy_owners — resulting permissions', () => {
  const rolePermissionRows = Object.entries(ROLE_PERMISSIONS).flatMap(
    ([slug, codes]) => codes.map((code) => ({ roleId: ROLE_ID[slug]!, code })),
  );

  const hierarchyRows = HIERARCHY_EDGES.map((e) => ({
    parentRoleId: ROLE_ID[e.parent]!,
    childRoleId: ROLE_ID[e.child]!,
  }));

  function buildService(directRoleIds: string[]): PermissionsService {
    const prisma = {
      memberRole: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            directRoleIds.map((id) => ({ roleDefinitionId: id })),
          ),
      },
      roleHierarchy: { findMany: jest.fn().mockResolvedValue(hierarchyRows) },
      rolePermission: {
        findMany: jest.fn().mockImplementation(
          ({ where }: { where: { roleId: { in: string[] } } }) =>
            Promise.resolve(
              rolePermissionRows
                .filter((r) => where.roleId.in.includes(r.roleId))
                .map((r) => ({ permission: { code: r.code } })),
            ),
        ),
      },
    };
    const cache = {
      getCachedPermissions: jest.fn().mockResolvedValue(null),
      setCachedPermissions: jest.fn().mockResolvedValue(undefined),
    };
    return new PermissionsService(prisma as never, cache as never);
  }

  it('a membership with NO member_roles row resolves to zero permissions', () => {
    // The state all 43 are in today, and the reason the backfill exists.
    return expect(
      buildService([]).getEffectivePermissions('member-unlinked'),
    ).resolves.toEqual([]);
  });

  it('a backfilled owner gains exactly the owner role’s permissions', async () => {
    const perms = await buildService([
      ROLE_ID['owner']!,
    ]).getEffectivePermissions('member-backfilled');

    expect([...perms].sort()).toEqual([...ROLE_PERMISSIONS['owner']!].sort());
  });

  it('a backfilled owner does NOT gain digests:review', async () => {
    // This is what makes the ordering load-bearing. Run before
    // 20260920140000_platform_role_grants strips digests:review from the
    // system owner role, this backfill would hand the editorial review queue
    // to 43 ordinary signups — DigestsAdminController accepts
    // {digests:review, admin:review-queue} with mode 'any'.
    const perms = await buildService([
      ROLE_ID['owner']!,
    ]).getEffectivePermissions('member-backfilled');

    expect(perms).not.toContain('digests:review');
    expect(perms).not.toContain('admin:review-queue');
  });

  it('a backfilled owner is not a platform admin and holds no platform code', async () => {
    const perms = await buildService([
      ROLE_ID['owner']!,
    ]).getEffectivePermissions('member-backfilled');

    // jwt.strategy's derivation: perms.some(p => p.startsWith('admin:')).
    expect(perms.some((p) => p.startsWith('admin:'))).toBe(false);
    expect(perms).not.toContain('platform-staff:manage');
    expect(perms).not.toContain('platform-roles:manage');
  });

  it('a backfilled owner does gain ordinary workspace authority', async () => {
    const perms = await buildService([
      ROLE_ID['owner']!,
    ]).getEffectivePermissions('member-backfilled');

    expect(perms).toEqual(
      expect.arrayContaining([
        'documents:read',
        'matters:read',
        'digests:create',
        'members:invite',
        'subscriptions:manage',
      ]),
    );
  });
});
