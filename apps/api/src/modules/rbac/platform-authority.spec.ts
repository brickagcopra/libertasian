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

const PLATFORM_ORG_ID = '00000000-0000-0000-0000-000000000001';
const PERSONAL_ORG_ID = 'personal-workspace-org';

const ROLE_ID: Record<string, string> = {
  owner: 'rd-owner-sys',
  admin: 'rd-admin-sys',
  editor: 'rd-editor-sys',
  reviewer: 'rd-reviewer-sys',
  member: 'rd-member-sys',
  student: 'rd-student-sys',
};

/** role_permissions fixture rows derived from the REAL seed mapping. */
const rolePermissionRows = Object.entries(ROLE_PERMISSIONS).flatMap(
  ([slug, codes]) => codes.map((code) => ({ roleId: ROLE_ID[slug]!, code })),
);

/** role_hierarchy fixture rows derived from the REAL seed edges. */
const hierarchyRows = HIERARCHY_EDGES.map((e) => ({
  parentRoleId: ROLE_ID[e.parent]!,
  childRoleId: ROLE_ID[e.child]!,
}));

interface MemberFixture {
  id: string;
  userId: string;
  organizationId: string;
  status?: string;
  roleIds: string[];
  /** Expiry applied to EVERY role in roleIds; undefined = never expires. */
  expiresAt?: Date | null;
  fullName?: string | null;
  email?: string;
}

/**
 * Builds a PermissionsService over a Prisma mock that behaves like the real
 * tables for the three things platform resolution depends on: active
 * membership lookup, non-expired member_roles, and the hierarchy/permission
 * join. Jest runs with no Postgres, so this is the closest faithful stand-in.
 */
function buildService(members: MemberFixture[]) {
  const prisma = {
    organizationMember: {
      findFirst: jest.fn(
        ({
          where,
        }: {
          where: { userId: string; organizationId: string; status: string };
        }) => {
          const hit = members.find(
            (m) =>
              m.userId === where.userId &&
              m.organizationId === where.organizationId &&
              (m.status ?? 'active') === where.status,
          );
          return Promise.resolve(hit ? { id: hit.id } : null);
        },
      ),
      findMany: jest.fn(
        ({ where }: { where: { organizationId: string; status: string } }) =>
          Promise.resolve(
            members
              .filter(
                (m) =>
                  m.organizationId === where.organizationId &&
                  (m.status ?? 'active') === where.status,
              )
              .map((m) => ({
                id: m.id,
                userId: m.userId,
                user: {
                  fullName: m.fullName ?? null,
                  email: m.email ?? 'nobody@example.com',
                },
              })),
          ),
      ),
    },
    memberRole: {
      findMany: jest.fn(
        ({ where }: { where: { organizationMemberId: string } }) => {
          const member = members.find(
            (m) => m.id === where.organizationMemberId,
          );
          if (!member) return Promise.resolve([]);
          // Mirrors the service's OR: [{expiresAt: null}, {expiresAt: {gt: now}}]
          const expired =
            member.expiresAt != null && member.expiresAt <= new Date();
          if (expired) return Promise.resolve([]);
          return Promise.resolve(
            member.roleIds.map((id) => ({ roleDefinitionId: id })),
          );
        },
      ),
    },
    roleHierarchy: { findMany: jest.fn().mockResolvedValue(hierarchyRows) },
    rolePermission: {
      findMany: jest.fn(({ where }: { where: { roleId: { in: string[] } } }) =>
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

describe('PermissionsService — platform authority', () => {
  describe('hasPlatformPermission', () => {
    it('grants digests:review to a reviewer ON THE PLATFORM ORG', async () => {
      const service = buildService([
        {
          id: 'm-rev',
          userId: 'u-rev',
          organizationId: PLATFORM_ORG_ID,
          roleIds: [ROLE_ID['reviewer']!],
        },
      ]);

      await expect(
        service.hasPlatformPermission('u-rev', 'digests:review'),
      ).resolves.toBe(true);
    });

    it('counts a permission inherited through the role hierarchy', async () => {
      // admin → reviewer is a seeded edge and getEffectivePermissions expands
      // parent→child, so `admin` must resolve digests:review even where the
      // grant lives on `reviewer`. Anything that reads permissions has to
      // expand the same way or it under-grants silently.
      const service = buildService([
        {
          id: 'm-adm',
          userId: 'u-adm',
          organizationId: PLATFORM_ORG_ID,
          roleIds: [ROLE_ID['admin']!],
        },
      ]);

      await expect(
        service.hasPlatformPermission('u-adm', 'digests:review'),
      ).resolves.toBe(true);
    });

    it('grants digests:review to a platform editor', async () => {
      const service = buildService([
        {
          id: 'm-ed',
          userId: 'u-ed',
          organizationId: PLATFORM_ORG_ID,
          roleIds: [ROLE_ID['editor']!],
        },
      ]);

      await expect(
        service.hasPlatformPermission('u-ed', 'digests:review'),
      ).resolves.toBe(true);
    });

    it('DENIES an owner whose only membership is a personal workspace', async () => {
      // The live authorization hole: an ordinary signup held owner on his own
      // workspace and got HTTP 200 on the admin review queue.
      const service = buildService([
        {
          id: 'm-own',
          userId: 'u-own',
          organizationId: PERSONAL_ORG_ID,
          roleIds: [ROLE_ID['owner']!],
        },
      ]);

      await expect(
        service.hasPlatformPermission('u-own', 'digests:review'),
      ).resolves.toBe(false);
    });

    it('EXCLUDES an expired member_roles grant', async () => {
      const service = buildService([
        {
          id: 'm-exp',
          userId: 'u-exp',
          organizationId: PLATFORM_ORG_ID,
          roleIds: [ROLE_ID['reviewer']!],
          expiresAt: new Date(Date.now() - 60_000),
        },
      ]);

      await expect(
        service.hasPlatformPermission('u-exp', 'digests:review'),
      ).resolves.toBe(false);
    });

    it('HONOURS a still-valid temporary grant', async () => {
      const service = buildService([
        {
          id: 'm-tmp',
          userId: 'u-tmp',
          organizationId: PLATFORM_ORG_ID,
          roleIds: [ROLE_ID['reviewer']!],
          expiresAt: new Date(Date.now() + 60 * 60_000),
        },
      ]);

      await expect(
        service.hasPlatformPermission('u-tmp', 'digests:review'),
      ).resolves.toBe(true);
    });

    it('DENIES a suspended platform membership', async () => {
      const service = buildService([
        {
          id: 'm-sus',
          userId: 'u-sus',
          organizationId: PLATFORM_ORG_ID,
          status: 'suspended',
          roleIds: [ROLE_ID['admin']!],
        },
      ]);

      await expect(
        service.hasPlatformPermission('u-sus', 'digests:review'),
      ).resolves.toBe(false);
    });
  });

  describe('isPlatformAdmin', () => {
    it('is true for an admin role held on the platform org', async () => {
      const service = buildService([
        {
          id: 'm-brick',
          userId: 'u-brick',
          organizationId: PLATFORM_ORG_ID,
          roleIds: [ROLE_ID['admin']!],
        },
      ]);

      await expect(service.isPlatformAdmin('u-brick')).resolves.toBe(true);
    });

    it('is false for an admin role held on a PERSONAL workspace', async () => {
      // This is the change that closes the leak: the same grant, on the wrong
      // org, confers nothing.
      const service = buildService([
        {
          id: 'm-x',
          userId: 'u-x',
          organizationId: PERSONAL_ORG_ID,
          roleIds: [ROLE_ID['admin']!],
        },
      ]);

      await expect(service.isPlatformAdmin('u-x')).resolves.toBe(false);
    });

    it('is false for a platform reviewer (holds no admin:* code)', async () => {
      // Guards the SubscriptionGuard bypass: isPlatformAdmin === true is a
      // complete paywall bypass, so reviewer must never satisfy it.
      const service = buildService([
        {
          id: 'm-rev',
          userId: 'u-rev',
          organizationId: PLATFORM_ORG_ID,
          roleIds: [ROLE_ID['reviewer']!],
        },
      ]);

      await expect(service.isPlatformAdmin('u-rev')).resolves.toBe(false);
    });

    it('is false for a personal-workspace owner', async () => {
      const service = buildService([
        {
          id: 'm-own',
          userId: 'u-own',
          organizationId: PERSONAL_ORG_ID,
          roleIds: [ROLE_ID['owner']!],
        },
      ]);

      await expect(service.isPlatformAdmin('u-own')).resolves.toBe(false);
    });

    it('fails CLOSED when resolution throws', async () => {
      const service = buildService([]);
      (
        service as unknown as {
          getPlatformPermissions: () => Promise<string[]>;
        }
      ).getPlatformPermissions = jest
        .fn()
        .mockRejectedValue(new Error('redis down'));

      await expect(service.isPlatformAdmin('u-any')).resolves.toBe(false);
    });
  });

  describe('listPlatformMembersWithPermission', () => {
    const roster: MemberFixture[] = [
      {
        id: 'm-admin',
        userId: 'u-admin',
        organizationId: PLATFORM_ORG_ID,
        roleIds: [ROLE_ID['admin']!],
        fullName: 'Ada Admin',
        email: 'ada@libertasian.com',
      },
      {
        id: 'm-editor',
        userId: 'u-editor',
        organizationId: PLATFORM_ORG_ID,
        roleIds: [ROLE_ID['editor']!],
        fullName: 'Edd Editor',
        email: 'edd@libertasian.com',
      },
      {
        id: 'm-reviewer',
        userId: 'u-reviewer',
        organizationId: PLATFORM_ORG_ID,
        roleIds: [ROLE_ID['reviewer']!],
        fullName: 'Rey Reviewer',
        email: 'rey@libertasian.com',
      },
      {
        id: 'm-student',
        userId: 'u-student',
        organizationId: PLATFORM_ORG_ID,
        roleIds: [ROLE_ID['student']!],
        fullName: 'Stu Student',
        email: 'stu@libertasian.com',
      },
      {
        id: 'm-outsider',
        userId: 'u-outsider',
        organizationId: PERSONAL_ORG_ID,
        roleIds: [ROLE_ID['owner']!],
        fullName: 'Ordinary Signup',
        email: 'signup@example.com',
      },
      {
        id: 'm-expired',
        userId: 'u-expired',
        organizationId: PLATFORM_ORG_ID,
        roleIds: [ROLE_ID['reviewer']!],
        expiresAt: new Date(Date.now() - 60_000),
        fullName: 'Lapsed Reviewer',
        email: 'lapsed@libertasian.com',
      },
    ];

    it('returns admin/editor/reviewer; excludes student, outsiders and expired grants', async () => {
      const service = buildService(roster);

      const found =
        await service.listPlatformMembersWithPermission('digests:review');

      expect(found.map((f) => f.userId).sort()).toEqual([
        'u-admin',
        'u-editor',
        'u-reviewer',
      ]);
    });

    it('returns USER ids, not member ids', async () => {
      // digests.assigned_reviewer_user_id is a user id. Returning a member id
      // does not error — it writes a UUID matching no user, and the digest is
      // assigned to nobody, silently.
      const service = buildService(roster);

      const found =
        await service.listPlatformMembersWithPermission('digests:review');
      const admin = found.find((f) => f.email === 'ada@libertasian.com');

      expect(admin?.userId).toBe('u-admin');
      expect(admin?.memberId).toBe('m-admin');
      expect(admin?.fullName).toBe('Ada Admin');
    });

    /**
     * P6 — one source of truth per question. The list the UI offers and the
     * check an assignment runs must be the same query. This asserts they agree
     * member-for-member over the whole fixture, in both directions.
     */
    it('agrees with hasPlatformPermission for every member of the fixture', async () => {
      const service = buildService(roster);

      const listed = new Set(
        (await service.listPlatformMembersWithPermission('digests:review')).map(
          (m) => m.userId,
        ),
      );

      for (const member of roster) {
        const checked = await service.hasPlatformPermission(
          member.userId,
          'digests:review',
        );
        expect({
          user: member.userId,
          listed: listed.has(member.userId),
        }).toEqual({ user: member.userId, listed: checked });
      }
    });
  });
});
