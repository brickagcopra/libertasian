import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

import { PermissionsService } from './permissions.service';
import { PlatformGrantsService } from './platform-grants.service';

/**
 * Guardrail tests for platform capability.
 *
 * These run the REAL PermissionsService against a fixture database, so
 * hierarchy inheritance and expiry are exercised through the same code path
 * production uses rather than being re-implemented in a mock. Only Prisma and
 * Redis are faked (jest runs with neither).
 *
 * The four refusals below — escalation, separation of duties, cardinality,
 * last-admin — are the ones hand-rolled RBAC reliably forgets. Each has its
 * own test.
 */

// ---------------------------------------------------------------------------
// Fixture world
// ---------------------------------------------------------------------------

interface FixtureRole {
  id: string;
  slug: string;
  name: string;
  isSystem: boolean;
  organizationId: string | null;
  maxPerOrg: number | null;
}

interface FixtureGrant {
  id: string;
  userId: string;
  roleDefinitionId: string;
  grantedByUserId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

interface FixtureUser {
  id: string;
  fullName: string;
  email: string;
  status: string;
  deletedAt: Date | null;
}

interface World {
  roles: FixtureRole[];
  /** roleId → permission codes granted DIRECTLY to that role */
  rolePermissions: Array<{ roleId: string; code: string }>;
  hierarchy: Array<{ parentRoleId: string; childRoleId: string }>;
  constraints: Array<{
    roleAId: string;
    roleBId: string;
    constraintType: string;
  }>;
  grants: FixtureGrant[];
  users: FixtureUser[];
  permissions: Array<{ id: string; code: string }>;
}

const ROLE = {
  admin: 'rd-admin',
  editor: 'rd-editor',
  reviewer: 'rd-reviewer',
  member: 'rd-member',
  orgCustom: 'rd-org-custom',
};

function role(
  id: string,
  slug: string,
  overrides: Partial<FixtureRole> = {},
): FixtureRole {
  return {
    id,
    slug,
    name: slug[0]!.toUpperCase() + slug.slice(1),
    isSystem: true,
    organizationId: null,
    maxPerOrg: null,
    ...overrides,
  };
}

function user(id: string, email: string): FixtureUser {
  return {
    id,
    fullName: `User ${id}`,
    email,
    status: 'active',
    deletedAt: null,
  };
}

function baseWorld(): World {
  return {
    roles: [
      role(ROLE.admin, 'admin'),
      role(ROLE.editor, 'editor'),
      role(ROLE.reviewer, 'reviewer'),
      role(ROLE.member, 'member'),
      role(ROLE.orgCustom, 'firm-paralegal', {
        isSystem: false,
        organizationId: 'org-1',
      }),
    ],
    rolePermissions: [
      // admin holds the platform administration codes directly
      { roleId: ROLE.admin, code: 'admin:dashboard' },
      { roleId: ROLE.admin, code: 'admin:review-queue' },
      { roleId: ROLE.admin, code: 'platform-staff:manage' },
      { roleId: ROLE.admin, code: 'platform-roles:manage' },
      // editor and reviewer both review digests
      { roleId: ROLE.editor, code: 'digests:review' },
      { roleId: ROLE.editor, code: 'corpus:update' },
      { roleId: ROLE.reviewer, code: 'digests:review' },
      { roleId: ROLE.member, code: 'documents:read' },
      { roleId: ROLE.orgCustom, code: 'documents:read' },
    ],
    // admin → editor → member. Parent inherits child permissions.
    hierarchy: [
      { parentRoleId: ROLE.admin, childRoleId: ROLE.editor },
      { parentRoleId: ROLE.admin, childRoleId: ROLE.reviewer },
      { parentRoleId: ROLE.editor, childRoleId: ROLE.member },
    ],
    constraints: [
      {
        roleAId: ROLE.editor,
        roleBId: ROLE.reviewer,
        constraintType: 'mutually_exclusive',
      },
    ],
    grants: [],
    users: [
      user('u-root', 'root@libertasian.com'),
      user('u-target', 'target@libertasian.com'),
      user('u-other', 'other@libertasian.com'),
    ],
    permissions: [
      { id: 'p-admin-dashboard', code: 'admin:dashboard' },
      { id: 'p-digests-review', code: 'digests:review' },
      { id: 'p-documents-read', code: 'documents:read' },
      { id: 'p-corpus-update', code: 'corpus:update' },
    ],
  };
}

/** Is this grant live right now, per the service's expiry predicate? */
function isLive(g: FixtureGrant): boolean {
  return g.expiresAt === null || g.expiresAt.getTime() > Date.now();
}

interface Harness {
  service: PlatformGrantsService;
  world: World;
  auditCalls: Array<Record<string, unknown>>;
  cacheInvalidations: string[];
}

function buildHarness(world: World = baseWorld()): Harness {
  const auditCalls: Array<Record<string, unknown>> = [];
  const cacheInvalidations: string[] = [];

  const hydrate = (g: FixtureGrant) => ({
    ...g,
    user: world.users.find((u) => u.id === g.userId)!,
    roleDefinition: world.roles.find((r) => r.id === g.roleDefinitionId)!,
    grantedBy: g.grantedByUserId
      ? world.users.find((u) => u.id === g.grantedByUserId)
      : null,
  });

  const prisma = {
    // --- used by the REAL PermissionsService -----------------------------
    roleHierarchy: {
      findMany: jest.fn().mockImplementation(() => Promise.resolve(world.hierarchy)),
    },
    rolePermission: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where: { roleId: { in: string[] } } }) =>
          Promise.resolve(
            world.rolePermissions
              .filter((rp) => where.roleId.in.includes(rp.roleId))
              .map((rp) => ({ permission: { code: rp.code } })),
          ),
        ),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },

    // --- platform grants --------------------------------------------------
    platformRoleGrant: {
      findMany: jest
        .fn()
        .mockImplementation(
          (args: {
            where?: { userId?: string; roleDefinitionId?: string; OR?: unknown };
            distinct?: string[];
          }) => {
            let rows = world.grants;
            if (args.where?.userId) {
              rows = rows.filter((g) => g.userId === args.where!.userId);
            }
            if (args.where?.roleDefinitionId) {
              rows = rows.filter(
                (g) => g.roleDefinitionId === args.where!.roleDefinitionId,
              );
            }
            // The only `OR` the service builds is the expiry predicate.
            if (args.where?.OR) rows = rows.filter(isLive);
            if (args.distinct?.includes('userId')) {
              const seen = new Set<string>();
              rows = rows.filter((g) =>
                seen.has(g.userId) ? false : (seen.add(g.userId), true),
              );
            }
            return Promise.resolve(rows.map(hydrate));
          },
        ),
      findUnique: jest
        .fn()
        .mockImplementation(
          (args: {
            where: { userId_roleDefinitionId: { userId: string; roleDefinitionId: string } };
          }) => {
            const key = args.where.userId_roleDefinitionId;
            const found = world.grants.find(
              (g) =>
                g.userId === key.userId &&
                g.roleDefinitionId === key.roleDefinitionId,
            );
            return Promise.resolve(found ? hydrate(found) : null);
          },
        ),
      count: jest
        .fn()
        .mockImplementation(
          (args: { where: { roleDefinitionId?: string; OR?: unknown } }) => {
            let rows = world.grants;
            if (args.where.roleDefinitionId) {
              rows = rows.filter(
                (g) => g.roleDefinitionId === args.where.roleDefinitionId,
              );
            }
            if (args.where.OR) rows = rows.filter(isLive);
            return Promise.resolve(rows.length);
          },
        ),
      create: jest
        .fn()
        .mockImplementation(
          (args: {
            data: {
              userId: string;
              roleDefinitionId: string;
              grantedByUserId: string | null;
              expiresAt: Date | null;
            };
          }) => {
            const created: FixtureGrant = {
              id: `grant-${world.grants.length + 1}`,
              createdAt: new Date(),
              ...args.data,
            };
            world.grants.push(created);
            return Promise.resolve(hydrate(created));
          },
        ),
      delete: jest
        .fn()
        .mockImplementation((args: { where: { id: string } }) => {
          const idx = world.grants.findIndex((g) => g.id === args.where.id);
          const [removed] = world.grants.splice(idx, 1);
          return Promise.resolve(removed);
        }),
    },

    // --- role definitions / constraints / users ---------------------------
    roleDefinition: {
      findUnique: jest
        .fn()
        .mockImplementation((args: { where: { id: string } }) =>
          Promise.resolve(world.roles.find((r) => r.id === args.where.id) ?? null),
        ),
      findFirst: jest
        .fn()
        .mockImplementation(
          (args: { where: { slug?: string; organizationId?: string | null } }) =>
            Promise.resolve(
              world.roles.find(
                (r) =>
                  (args.where.slug === undefined || r.slug === args.where.slug) &&
                  r.organizationId === (args.where.organizationId ?? null),
              ) ?? null,
            ),
        ),
      findMany: jest.fn().mockImplementation(() => Promise.resolve(world.roles)),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    roleConstraint: {
      findMany: jest
        .fn()
        .mockImplementation(
          (args: { where: { OR: Array<{ roleAId?: string; roleBId?: string }> } }) => {
            const roleId =
              args.where.OR[0]?.roleAId ?? args.where.OR[1]?.roleBId ?? '';
            return Promise.resolve(
              world.constraints
                .filter((c) => c.roleAId === roleId || c.roleBId === roleId)
                .map((c) => ({
                  ...c,
                  roleA: world.roles.find((r) => r.id === c.roleAId)!,
                  roleB: world.roles.find((r) => r.id === c.roleBId)!,
                })),
            );
          },
        ),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    permission: {
      findMany: jest
        .fn()
        .mockImplementation((args: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            world.permissions.filter((p) => args.where.id.in.includes(p.id)),
          ),
        ),
    },
    user: {
      findUnique: jest
        .fn()
        .mockImplementation((args: { where: { id: string } }) =>
          Promise.resolve(world.users.find((u) => u.id === args.where.id) ?? null),
        ),
      findMany: jest.fn().mockResolvedValue([]),
    },
    memberRole: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest
      .fn()
      .mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma)),
  };

  // Cache always misses, so every assertion reads through to the fixture data.
  const cache = {
    getCachedPermissions: jest.fn().mockResolvedValue(null),
    setCachedPermissions: jest.fn().mockResolvedValue(undefined),
    getCachedPlatformPermissions: jest.fn().mockResolvedValue(null),
    setCachedPlatformPermissions: jest.fn().mockResolvedValue(undefined),
    invalidatePlatformForUser: jest.fn().mockImplementation((userId: string) => {
      cacheInvalidations.push(userId);
      return Promise.resolve();
    }),
    invalidatePlatformForRole: jest.fn().mockResolvedValue(undefined),
    invalidateForRole: jest.fn().mockResolvedValue(undefined),
  };

  const audit = {
    log: jest.fn().mockImplementation((entry: Record<string, unknown>) => {
      auditCalls.push(entry);
      return Promise.resolve();
    }),
  };

  const permissions = new PermissionsService(prisma as never, cache as never);
  const service = new PlatformGrantsService(
    prisma as never,
    cache as never,
    permissions,
    audit as never,
  );

  return { service, world, auditCalls, cacheInvalidations };
}

function grantRow(
  userId: string,
  roleDefinitionId: string,
  expiresAt: Date | null = null,
): FixtureGrant {
  return {
    id: `grant-${userId}-${roleDefinitionId}`,
    userId,
    roleDefinitionId,
    grantedByUserId: null,
    expiresAt,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

// ---------------------------------------------------------------------------

describe('PlatformGrantsService — resolution', () => {
  it('expands the role hierarchy, exactly as getEffectivePermissions does', async () => {
    const h = buildHarness();
    h.world.grants.push(grantRow('u-target', ROLE.admin));

    const perms = await h.service.getPlatformPermissions('u-target');

    // Direct on admin…
    expect(perms).toContain('platform-staff:manage');
    // …inherited from the editor and reviewer children…
    expect(perms).toContain('corpus:update');
    expect(perms).toContain('digests:review');
    // …and from member, two levels down (admin → editor → member).
    expect(perms).toContain('documents:read');
  });

  it('excludes grants whose expires_at has passed', async () => {
    const h = buildHarness();
    h.world.grants.push(
      grantRow('u-target', ROLE.reviewer, new Date(Date.now() - 60_000)),
    );

    expect(await h.service.getPlatformPermissions('u-target')).toEqual([]);
    expect(
      await h.service.hasPlatformPermission('u-target', 'digests:review'),
    ).toBe(false);
  });

  it('keeps a grant whose expires_at is still in the future', async () => {
    const h = buildHarness();
    h.world.grants.push(
      grantRow('u-target', ROLE.reviewer, new Date(Date.now() + 3_600_000)),
    );

    expect(
      await h.service.hasPlatformPermission('u-target', 'digests:review'),
    ).toBe(true);
  });

  it('a user with no grants holds nothing', async () => {
    const h = buildHarness();
    expect(await h.service.getPlatformPermissions('u-target')).toEqual([]);
  });

  it('listUsersWithPlatformPermission returns USER ids, not member ids', async () => {
    const h = buildHarness();
    h.world.grants.push(grantRow('u-root', ROLE.admin));
    h.world.grants.push(grantRow('u-target', ROLE.reviewer));
    h.world.grants.push(grantRow('u-other', ROLE.member));

    const reviewers = await h.service.listUsersWithPlatformPermission(
      'digests:review',
    );

    // digests:review reaches admin through the hierarchy and reviewer directly;
    // the member-only holder is excluded.
    expect(reviewers.map((r) => r.userId).sort()).toEqual([
      'u-root',
      'u-target',
    ]);
    // These are users.id values — digests.assigned_reviewer_user_id is a user id.
    expect(h.world.users.map((u) => u.id)).toEqual(
      expect.arrayContaining(reviewers.map((r) => r.userId)),
    );
  });

  it('the reviewer list and the per-user check agree on every holder', async () => {
    const h = buildHarness();
    h.world.grants.push(grantRow('u-root', ROLE.admin));
    h.world.grants.push(grantRow('u-target', ROLE.reviewer));
    h.world.grants.push(grantRow('u-other', ROLE.member));

    const listed = new Set(
      (await h.service.listUsersWithPlatformPermission('digests:review')).map(
        (r) => r.userId,
      ),
    );

    for (const u of h.world.users) {
      expect({
        userId: u.id,
        listed: listed.has(u.id),
      }).toEqual({
        userId: u.id,
        listed: await h.service.hasPlatformPermission(u.id, 'digests:review'),
      });
    }
  });
});

describe('PlatformGrantsService — grant guardrails', () => {
  it('refuses PRIVILEGE ESCALATION: granting a role the actor does not fully hold', async () => {
    const h = buildHarness();
    // Actor holds reviewer only; admin confers far more.
    h.world.grants.push(grantRow('u-root', ROLE.reviewer));

    await expect(
      h.service.grant('u-target', ROLE.admin, 'u-root'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(h.world.grants).toHaveLength(1);
    expect(
      h.auditCalls.some(
        (c) =>
          c['action'] === 'platform_grant.refused' &&
          (c['metadata'] as Record<string, unknown>)['refusal'] ===
            'privilege_escalation',
      ),
    ).toBe(true);
  });

  it('allows a grant whose permissions are a strict SUBSET of the actor’s', async () => {
    const h = buildHarness();
    h.world.grants.push(grantRow('u-root', ROLE.admin));

    const granted = await h.service.grant('u-target', ROLE.member, 'u-root');

    expect(granted.roleSlug).toBe('member');
    expect(h.cacheInvalidations).toContain('u-target');
  });

  it('refuses SEPARATION OF DUTIES: editor ⊥ reviewer, keyed on the USER', async () => {
    const h = buildHarness();
    h.world.grants.push(grantRow('u-root', ROLE.admin));
    h.world.grants.push(grantRow('u-target', ROLE.editor));

    await expect(
      h.service.grant('u-target', ROLE.reviewer, 'u-root'),
    ).rejects.toThrow(/mutually exclusive/i);

    expect(
      h.auditCalls.some(
        (c) =>
          (c['metadata'] as Record<string, unknown>)?.['refusal'] ===
          'separation_of_duties',
      ),
    ).toBe(true);
  });

  it('refuses CARDINALITY: max_per_org read as the platform-wide holder cap', async () => {
    const h = buildHarness();
    h.world.roles.find((r) => r.id === ROLE.reviewer)!.maxPerOrg = 1;
    h.world.grants.push(grantRow('u-root', ROLE.admin));
    h.world.grants.push(grantRow('u-other', ROLE.reviewer));

    await expect(
      h.service.grant('u-target', ROLE.reviewer, 'u-root'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(
      h.auditCalls.some(
        (c) =>
          (c['metadata'] as Record<string, unknown>)?.['refusal'] ===
          'cardinality',
      ),
    ).toBe(true);
  });

  it('an EXPIRED holder does not consume a cardinality slot', async () => {
    const h = buildHarness();
    h.world.roles.find((r) => r.id === ROLE.reviewer)!.maxPerOrg = 1;
    h.world.grants.push(grantRow('u-root', ROLE.admin));
    h.world.grants.push(
      grantRow('u-other', ROLE.reviewer, new Date(Date.now() - 1000)),
    );

    await expect(
      h.service.grant('u-target', ROLE.reviewer, 'u-root'),
    ).resolves.toMatchObject({ roleSlug: 'reviewer' });
  });

  it('refuses SCOPE: an org-custom role can never become a platform grant', async () => {
    const h = buildHarness();
    h.world.grants.push(grantRow('u-root', ROLE.admin));
    // Give the actor the org role's one permission so escalation is not the reason.
    h.world.rolePermissions.push({ roleId: ROLE.admin, code: 'documents:read' });

    await expect(
      h.service.grant('u-target', ROLE.orgCustom, 'u-root'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(
      h.auditCalls.some(
        (c) =>
          (c['metadata'] as Record<string, unknown>)?.['refusal'] ===
          'org_scoped_role',
      ),
    ).toBe(true);
  });

  it('refuses a grant to an account that does not exist', async () => {
    const h = buildHarness();
    h.world.grants.push(grantRow('u-root', ROLE.admin));

    await expect(
      h.service.grant('u-nobody', ROLE.member, 'u-root'),
    ).rejects.toThrow(/sign up first/i);
  });

  it('refuses a duplicate grant', async () => {
    const h = buildHarness();
    h.world.grants.push(grantRow('u-root', ROLE.admin));
    h.world.grants.push(grantRow('u-target', ROLE.member));

    await expect(
      h.service.grant('u-target', ROLE.member, 'u-root'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('the CLI bootstrap skips ONLY the escalation check, and says so in the audit row', async () => {
    const h = buildHarness();
    // No actor at all — the very first admin.
    const granted = await h.service.grant('u-target', ROLE.admin, null, undefined, {
      bypassEscalationCheck: true,
      source: 'cli:platform-grant (interactive bootstrap)',
    });

    expect(granted.roleSlug).toBe('admin');
    const created = h.auditCalls.find(
      (c) => c['action'] === 'platform_grant.created',
    );
    expect(created?.['metadata']).toMatchObject({
      escalationCheckBypassed: true,
      source: 'cli:platform-grant (interactive bootstrap)',
    });
  });

  it('the CLI bootstrap still honours separation of duties', async () => {
    const h = buildHarness();
    h.world.grants.push(grantRow('u-target', ROLE.editor));

    await expect(
      h.service.grant('u-target', ROLE.reviewer, null, undefined, {
        bypassEscalationCheck: true,
      }),
    ).rejects.toThrow(/mutually exclusive/i);
  });

  it('redacts the target email in the audit metadata', async () => {
    const h = buildHarness();
    h.world.grants.push(grantRow('u-root', ROLE.admin));

    await h.service.grant('u-target', ROLE.member, 'u-root');

    const created = h.auditCalls.find(
      (c) => c['action'] === 'platform_grant.created',
    );
    expect((created?.['metadata'] as Record<string, unknown>)['targetEmail']).toBe(
      't***@libertasian.com',
    );
  });
});

describe('PlatformGrantsService — revoke guardrails', () => {
  it('refuses LAST-ADMIN revoke: nobody would hold any admin:* permission', async () => {
    const h = buildHarness();
    h.world.grants.push(grantRow('u-root', ROLE.admin));

    await expect(
      h.service.revoke('u-root', ROLE.admin, 'u-root'),
    ).rejects.toBeInstanceOf(ConflictException);

    // 409, not a 500, and the grant survives.
    expect(h.world.grants).toHaveLength(1);
    expect(
      h.auditCalls.some(
        (c) =>
          (c['metadata'] as Record<string, unknown>)?.['refusal'] ===
          'last_admin',
      ),
    ).toBe(true);
  });

  it('allows the revoke once a second admin exists', async () => {
    const h = buildHarness();
    h.world.grants.push(grantRow('u-root', ROLE.admin));
    h.world.grants.push(grantRow('u-other', ROLE.admin));

    await h.service.revoke('u-root', ROLE.admin, 'u-other');

    expect(h.world.grants.map((g) => g.userId)).toEqual(['u-other']);
    expect(h.cacheInvalidations).toContain('u-root');
  });

  it('an EXPIRED second admin does not satisfy last-admin protection', async () => {
    const h = buildHarness();
    h.world.grants.push(grantRow('u-root', ROLE.admin));
    h.world.grants.push(
      grantRow('u-other', ROLE.admin, new Date(Date.now() - 1000)),
    );

    await expect(
      h.service.revoke('u-root', ROLE.admin, 'u-root'),
    ).rejects.toThrow(/last-admin/i);
  });

  it('revoking a non-admin role is unaffected by last-admin protection', async () => {
    const h = buildHarness();
    h.world.grants.push(grantRow('u-root', ROLE.admin));
    h.world.grants.push(grantRow('u-target', ROLE.reviewer));

    await h.service.revoke('u-target', ROLE.reviewer, 'u-root');

    expect(h.world.grants.map((g) => g.userId)).toEqual(['u-root']);
  });

  it('revoking a grant that does not exist is a 404, not a silent success', async () => {
    const h = buildHarness();
    h.world.grants.push(grantRow('u-root', ROLE.admin));

    await expect(
      h.service.revoke('u-target', ROLE.reviewer, 'u-root'),
    ).rejects.toThrow(/not found/i);
  });
});

describe('PlatformGrantsService — platform role authoring', () => {
  it('refuses to put a permission into a role that the creator does not hold', async () => {
    const h = buildHarness();
    h.world.grants.push(grantRow('u-root', ROLE.reviewer)); // holds digests:review only

    await expect(
      h.service.createPlatformRole(
        {
          name: 'Corpus Boss',
          slug: 'corpus-boss',
          permissionIds: ['p-admin-dashboard'],
        },
        'u-root',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to edit a built-in role — it must be cloned instead', async () => {
    const h = buildHarness();
    h.world.grants.push(grantRow('u-root', ROLE.admin));

    await expect(
      h.service.updatePlatformRole(ROLE.admin, { name: 'Super Admin' }, 'u-root'),
    ).rejects.toThrow(/built-in role and cannot be edited/i);
  });

  it('refuses to delete a built-in role', async () => {
    const h = buildHarness();
    h.world.grants.push(grantRow('u-root', ROLE.admin));

    await expect(
      h.service.deletePlatformRole(ROLE.reviewer, 'u-root'),
    ).rejects.toThrow(/cannot be deleted/i);
  });

  it('refuses to manage an org-scoped role as a platform role', async () => {
    const h = buildHarness();
    h.world.grants.push(grantRow('u-root', ROLE.admin));

    await expect(
      h.service.updatePlatformRole(ROLE.orgCustom, { name: 'X' }, 'u-root'),
    ).rejects.toThrow(/belongs to an organization/i);
  });
});
