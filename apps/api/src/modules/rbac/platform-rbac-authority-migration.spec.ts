import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PermissionsService } from './permissions.service';

// tsconfig's rootDir is 'src', so a static import of prisma/seeds fails tsc
// with TS6059. require() keeps the runtime dependency on the REAL seed file
// while keeping it out of the compile graph.
const { HIERARCHY_EDGES, ROLE_PERMISSIONS } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../prisma/seeds/rbac-seed') as {
    HIERARCHY_EDGES: Array<{ parent: string; child: string }>;
    ROLE_PERMISSIONS: Record<string, string[]>;
  };

const MIGRATION_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  'prisma',
  'migrations',
  '20260920120000_platform_rbac_authority',
);

const forward = readFileSync(join(MIGRATION_DIR, 'migration.sql'), 'utf8');
const rollback = readFileSync(join(MIGRATION_DIR, 'down.sql'), 'utf8');

const PLATFORM_ORG_ID = '00000000-0000-0000-0000-000000000001';
const SUPERADMIN_EMAIL = 'bma5871@gmail.com';

/**
 * Migration 20260920120000_platform_rbac_authority.
 *
 * Jest runs with no Postgres, so this asserts the migration on two axes:
 *  1. the SQL itself — scope, idempotency, and a working rollback;
 *  2. the authorization outcome, by resolving the REAL PermissionsService over
 *     a Prisma mock shaped like the post-migration database.
 *
 * Axis 2 is the one that matters most: step 5 of this change rescopes
 * isPlatformAdmin to the platform org, and WITHOUT step 2 of the migration it
 * locks the only superadmin out of his own admin panel.
 */
describe('20260920120000_platform_rbac_authority — SQL', () => {
  it('strips digests:review ONLY from the system owner role', () => {
    const [stripStatement] = forward.split(';');
    expect(stripStatement).toContain('DELETE FROM role_permissions');
    expect(stripStatement).toContain("p.code = 'digests:review'");
    // Scope guards — an org-custom `owner` role, or any other role, is left
    // alone.
    expect(stripStatement).toContain("rd.slug = 'owner'");
    expect(stripStatement).toContain('rd.is_system = true');
    expect(stripStatement).toContain('rd.organization_id IS NULL');
  });

  it('touches no permission other than digests:review', () => {
    // A LIKE/prefix match here would silently strip the whole digests
    // category from every owner.
    expect(forward).not.toMatch(/p\.code\s+LIKE/i);
    const codeMatches = forward.match(/p\.code = '[^']+'/g) ?? [];
    expect([...new Set(codeMatches)]).toEqual(["p.code = 'digests:review'"]);
  });

  it('restores the superadmin by EMAIL on the platform org, never by hardcoded member id', () => {
    expect(forward).toContain(SUPERADMIN_EMAIL);
    expect(forward).toContain(PLATFORM_ORG_ID);
    expect(forward).toContain('INSERT INTO organization_members');
    expect(forward).toContain('INSERT INTO member_roles');
    // member_roles is what getEffectivePermissions reads; the legacy
    // organization_members.role column alone would confer nothing.
    expect(forward).toContain("rd.slug = 'admin'");
  });

  it('requires the platform membership to be ACTIVE', () => {
    // resolvePlatformMemberId filters on status = 'active'; a membership
    // inserted or left in any other state resolves to nobody.
    expect(forward).toContain("status = 'active'");
    expect(forward).toContain("om.status = 'active'");
  });

  it('is idempotent — every insert is guarded by NOT EXISTS', () => {
    const inserts = forward.match(/INSERT INTO/g) ?? [];
    const guards = forward.match(/NOT EXISTS/g) ?? [];
    expect(inserts.length).toBeGreaterThan(0);
    expect(guards.length).toBeGreaterThanOrEqual(inserts.length);
  });

  it('ships a rollback that re-grants digests:review before removing the membership', () => {
    expect(rollback).toContain('INSERT INTO role_permissions');
    expect(rollback).toContain("p.code = 'digests:review'");
    expect(rollback).toContain('DELETE FROM member_roles');
    // Order matters: re-grant first, or there is a window with no reviewers.
    expect(rollback.indexOf('INSERT INTO role_permissions')).toBeLessThan(
      rollback.indexOf('DELETE FROM member_roles'),
    );
    expect(rollback).toMatch(/NOT EXISTS/);
  });
});

describe('20260920120000_platform_rbac_authority — resolved authorization', () => {
  const ROLE_ID: Record<string, string> = {
    owner: 'rd-owner-sys',
    admin: 'rd-admin-sys',
    editor: 'rd-editor-sys',
    reviewer: 'rd-reviewer-sys',
    member: 'rd-member-sys',
    student: 'rd-student-sys',
  };

  /**
   * role_permissions AFTER the migration: derived from the real seed, then
   * with digests:review removed from `owner` exactly as step 1 does. The seed
   * already excludes it (they were changed together), so this also asserts
   * the two halves agree.
   */
  const rolePermissionRows = Object.entries(ROLE_PERMISSIONS).flatMap(
    ([slug, codes]) =>
      codes
        .filter((code) => !(slug === 'owner' && code === 'digests:review'))
        .map((code) => ({ roleId: ROLE_ID[slug]!, code })),
  );

  const hierarchyRows = HIERARCHY_EDGES.map((e) => ({
    parentRoleId: ROLE_ID[e.parent]!,
    childRoleId: ROLE_ID[e.child]!,
  }));

  /** organization_members + member_roles as the migration leaves them. */
  const MEMBERS = [
    // Step 2: the superadmin, on the PLATFORM org, holding system `admin`.
    {
      id: 'm-brick-platform',
      userId: 'u-brick',
      organizationId: PLATFORM_ORG_ID,
      roleIds: [ROLE_ID['admin']!],
    },
    // Untouched by this migration: his personal workspace still carries the
    // `admin` grant from 20260702120000_strip_owner_platform_admin. It must
    // not be what makes him an admin any more, but it must not break him
    // either.
    {
      id: 'm-brick-personal',
      userId: 'u-brick',
      organizationId: 'org-brick-personal',
      roleIds: [ROLE_ID['owner']!, ROLE_ID['admin']!],
    },
    // An ordinary signup.
    {
      id: 'm-john',
      userId: 'u-john',
      organizationId: 'org-john-personal',
      roleIds: [ROLE_ID['owner']!],
    },
  ];

  function buildService() {
    const prisma = {
      organizationMember: {
        findFirst: jest.fn(
          ({
            where,
          }: {
            where: { userId: string; organizationId: string; status: string };
          }) => {
            const hit = MEMBERS.find(
              (m) =>
                m.userId === where.userId &&
                m.organizationId === where.organizationId,
            );
            return Promise.resolve(
              hit && where.status === 'active' ? { id: hit.id } : null,
            );
          },
        ),
        findMany: jest.fn().mockResolvedValue([]),
      },
      memberRole: {
        findMany: jest.fn(
          ({ where }: { where: { organizationMemberId: string } }) =>
            Promise.resolve(
              (
                MEMBERS.find((m) => m.id === where.organizationMemberId)
                  ?.roleIds ?? []
              ).map((id) => ({ roleDefinitionId: id })),
            ),
        ),
      },
      roleHierarchy: { findMany: jest.fn().mockResolvedValue(hierarchyRows) },
      rolePermission: {
        findMany: jest.fn(
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
    const config = { get: jest.fn().mockReturnValue(PLATFORM_ORG_ID) };
    return new PermissionsService(
      prisma as never,
      cache as never,
      config as never,
    );
  }

  it("brick's account still resolves isPlatformAdmin = true after the migration", async () => {
    // Step 6b of the change exists precisely for this assertion. Delete it and
    // step 5 locks the only superadmin out of the admin panel on deploy.
    await expect(buildService().isPlatformAdmin('u-brick')).resolves.toBe(true);
  });

  it('brick remains assignable as a reviewer', async () => {
    await expect(
      buildService().hasPlatformPermission('u-brick', 'digests:review'),
    ).resolves.toBe(true);
  });

  it('an ordinary signup no longer resolves digests:review anywhere', async () => {
    const service = buildService();

    await expect(
      service.hasPlatformPermission('u-john', 'digests:review'),
    ).resolves.toBe(false);
    // ...and not on his own workspace either: the grant is gone from the
    // shared system owner role, so the review-queue guard denies him even
    // though it resolves against his current org.
    await expect(
      service.getEffectivePermissions('m-john'),
    ).resolves.not.toContain('digests:review');
  });

  it('a personal-workspace owner keeps every other tenant permission', async () => {
    const perms = await buildService().getEffectivePermissions('m-john');

    expect(perms).toEqual(
      expect.arrayContaining([
        'digests:read',
        'digests:create',
        'documents:read',
        'members:invite',
      ]),
    );
  });

  it('an unrelated account is not made an admin by the migration', async () => {
    await expect(buildService().isPlatformAdmin('u-john')).resolves.toBe(false);
  });
});
