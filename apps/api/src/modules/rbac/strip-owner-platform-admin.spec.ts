import { PermissionsService } from './permissions.service';

// tsconfig's rootDir is 'src', so a static import of prisma/seeds fails tsc
// with TS6059. require() keeps the runtime dependency on the REAL seed file
// (ts-jest still transforms it) while keeping it out of the compile graph.
const { HIERARCHY_EDGES, PERMISSIONS, ROLE_PERMISSIONS } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../prisma/seeds/rbac-seed') as {
    HIERARCHY_EDGES: Array<{ parent: string; child: string }>;
    PERMISSIONS: Array<{ code: string }>;
    ROLE_PERMISSIONS: Record<string, string[]>;
  };

/**
 * Regression test for migration
 * `20260702120000_strip_owner_platform_admin` and the matching rbac-seed change.
 *
 * Context: every self-registered user owns a personal workspace and is linked
 * to the shared SYSTEM 'owner' role. That role was seeded with ALL permission
 * codes — including the 13 cross-tenant platform admin:* codes — so
 * jwt.strategy's derivation `perms.some(p => p.startsWith('admin:'))` resolved
 * isPlatformAdmin=true for EVERY signup, exposing /admin/users,
 * /admin/subscriptions, /admin/accounting, etc. across all organizations.
 *
 * The fix has two inseparable halves, both asserted here:
 *  1. Strip admin:* from the owner role's direct permission grants.
 *  2. Remove the owner→admin hierarchy edge — PermissionsService BFS inherits
 *     permissions DOWNWARD (parent gains child permissions), so the edge alone
 *     would re-grant every admin:* code to every owner even after the strip.
 *
 * Platform admin is re-granted only to an explicit email allowlist by linking
 * their membership to the SYSTEM 'admin' role (see the migration).
 */

const PLATFORM_ADMIN_CODES = PERMISSIONS.filter((p) =>
  p.code.startsWith('admin:'),
).map((p) => p.code);

describe('strip_owner_platform_admin — seed-level invariants', () => {
  it('the permission catalogue contains exactly the 13 platform admin:* codes', () => {
    expect([...PLATFORM_ADMIN_CODES].sort()).toEqual([
      'admin:ai-settings',
      'admin:billing',
      'admin:corpus-health',
      'admin:coverage-gaps',
      'admin:dashboard',
      'admin:documents',
      'admin:duplicates',
      'admin:ingestion',
      'admin:knowledge-graph',
      'admin:plans',
      'admin:review-queue',
      'admin:settings',
      'admin:users',
    ]);
  });

  it('the owner role holds zero admin:* codes', () => {
    const ownerCodes = ROLE_PERMISSIONS['owner'] ?? [];
    expect(ownerCodes.length).toBeGreaterThan(0);
    expect(ownerCodes.filter((c) => c.startsWith('admin:'))).toEqual([]);
  });

  it('the owner role still holds representative tenant permissions', () => {
    expect(ROLE_PERMISSIONS['owner']).toEqual(
      expect.arrayContaining([
        'documents:read',
        'matters:read',
        'uploads:read',
        'subscriptions:manage',
        'members:invite',
        'roles:create',
        'audit-logs:read',
      ]),
    );
  });

  it('the owner role is every non-admin:* code (nothing else was stripped)', () => {
    const expected = PERMISSIONS.map((p) => p.code).filter(
      (c) => !c.startsWith('admin:'),
    );
    expect([...(ROLE_PERMISSIONS['owner'] ?? [])].sort()).toEqual(
      [...new Set(expected)].sort(),
    );
  });

  it('the admin role still holds all 13 admin:* codes (allowlist path intact)', () => {
    expect(ROLE_PERMISSIONS['admin']).toEqual(
      expect.arrayContaining(PLATFORM_ADMIN_CODES),
    );
  });

  it('the hierarchy has NO owner→* edge (owner must not inherit admin:* downward)', () => {
    expect(HIERARCHY_EDGES.filter((e) => e.parent === 'owner')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Downstream authorization through the REAL PermissionsService, with Prisma
// mocked to reflect the post-migration database state (jest runs with no
// Postgres). Role→permission rows and hierarchy edges are derived from the
// seed constants so this cannot drift from what actually gets seeded.
// ---------------------------------------------------------------------------

describe('strip_owner_platform_admin — downstream authorization', () => {
  const ROLE_ID: Record<string, string> = {
    owner: 'rd-owner-sys',
    admin: 'rd-admin-sys',
    editor: 'rd-editor-sys',
    reviewer: 'rd-reviewer-sys',
    member: 'rd-member-sys',
    student: 'rd-student-sys',
  };

  /** role_permissions fixture rows derived from the seed mapping */
  const rolePermissionRows = Object.entries(ROLE_PERMISSIONS).flatMap(
    ([slug, codes]) => codes.map((code) => ({ roleId: ROLE_ID[slug]!, code })),
  );

  /** role_hierarchy fixture rows derived from the seed edges */
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

  it('a member holding ONLY the system owner role resolves isPlatformAdmin=false', async () => {
    const service = buildService([ROLE_ID['owner']!]);
    const perms = await service.getEffectivePermissions('member-owner-only');

    // Tenant permissions are intact...
    expect(perms).toEqual(
      expect.arrayContaining(['documents:read', 'matters:read', 'uploads:read']),
    );
    // ...but the jwt.strategy derivation `perms.some(p => p.startsWith('admin:'))`
    // — i.e. isPlatformAdmin — resolves false: no direct admin:* grant and no
    // owner→admin hierarchy edge to inherit one through.
    expect(perms.some((p) => p.startsWith('admin:'))).toBe(false);
  });

  it('an allowlisted member holding owner + system admin roles resolves isPlatformAdmin=true', async () => {
    const service = buildService([ROLE_ID['owner']!, ROLE_ID['admin']!]);
    const perms = await service.getEffectivePermissions('member-allowlisted');

    expect(perms).toEqual(expect.arrayContaining(PLATFORM_ADMIN_CODES));
    expect(perms.some((p) => p.startsWith('admin:'))).toBe(true);
  });
});
