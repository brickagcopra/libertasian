import { ForbiddenException } from '@nestjs/common';

import { RolesService } from './roles.service';
import {
  PLATFORM_CAPABILITY_REFUSAL,
  findPlatformScopedCodes,
  isPlatformScopedCode,
} from './platform-scope';

/**
 * Privilege escalation, verified on prod 2026-09-22.
 *
 * Every signup owns a personal workspace, and the `owner` system role holds
 * members:update-role and roles:create/roles:update. RolesService.assignRole
 * accepted any isSystem role in any org with no escalation check, so an owner
 * could POST /rbac/members/{ownMemberId}/roles with the system admin role id —
 * which GET /rbac/roles happily lists — and come back a platform admin, because
 * jwt.strategy derives isPlatformAdmin from the presence of any `admin:` code
 * in the caller's WORKSPACE permissions. A probe with a nonexistent role id
 * returned 404 from the service, proving every guard in front of it passed.
 *
 * These tests pin the containment, not the exploit.
 */
describe('workspace roles can never confer platform capability', () => {
  // Shaped after the real seeded code sets, so a change to what `admin` and
  // `editor` carry shows up here rather than in production.
  const SYSTEM_ADMIN_CODES = [
    'documents:read',
    'admin:dashboard',
    'admin:users',
    'admin:billing',
  ];
  const SYSTEM_EDITOR_CODES = [
    'admin:dashboard',
    'admin:corpus-health',
    'admin:ingestion',
    'admin:review-queue',
    'admin:coverage-gaps',
    'admin:duplicates',
    'admin:knowledge-graph',
    'documents:read',
  ];
  const MEMBER_CODES = ['documents:read', 'notes:read', 'search:query'];
  /** What a personal-workspace owner actually holds post-strip: no platform codes. */
  const OWNER_CODES = [
    ...MEMBER_CODES,
    'members:update-role',
    'roles:create',
    'roles:update',
    'notes:update',
  ];

  const orgId = 'org-1';
  const memberId = 'member-1';
  const ownerUserId = 'owner-user-1';
  const ownerMemberId = 'owner-member-1';
  const roleDefId = 'role-def-1';
  const permId = '00000000-0000-4000-8000-000000000001';

  let prisma: any;
  let cache: any;
  let audit: any;
  let permissions: any;
  let service: RolesService;

  /** Builds the service with the owner as assigner, holding OWNER_CODES. */
  function build(conferred: string[], assignerHolds: string[] = OWNER_CODES) {
    prisma = {
      organizationMember: { findUnique: jest.fn(), findMany: jest.fn() },
      roleDefinition: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      memberRole: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      permission: { findMany: jest.fn() },
      roleHierarchy: { findMany: jest.fn().mockResolvedValue([]) },
      roleConstraint: { findMany: jest.fn().mockResolvedValue([]) },
      rolePermission: { findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    cache = {
      invalidateForMember: jest.fn().mockResolvedValue(undefined),
      invalidateForRole: jest.fn().mockResolvedValue(undefined),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    permissions = {
      resolvePermissionCodes: jest.fn().mockResolvedValue(conferred),
      resolveMemberId: jest.fn().mockResolvedValue(ownerMemberId),
      getEffectivePermissions: jest.fn().mockResolvedValue(assignerHolds),
    };
    service = new RolesService(
      prisma as never,
      cache as never,
      audit as never,
      permissions as never,
    );
  }

  /** Member + role rows that let assignRole reach the gates. */
  function stubAssignable(slug: string, name: string) {
    prisma.organizationMember.findUnique.mockResolvedValue({
      id: memberId,
      organizationId: orgId,
      userId: ownerUserId,
      user: { email: 'owner@example.com', fullName: 'Owner' },
    });
    prisma.roleDefinition.findUnique.mockResolvedValue({
      id: roleDefId,
      organizationId: null,
      name,
      slug,
      isSystem: true,
      requiresMfa: false,
      maxPerOrg: null,
    });
    prisma.memberRole.findUnique.mockResolvedValue(null);
    prisma.memberRole.findMany.mockResolvedValue([]);
    prisma.memberRole.count.mockResolvedValue(0);
  }

  // -------------------------------------------------------------------------
  // Positive control
  // -------------------------------------------------------------------------

  describe('positive control', () => {
    /**
     * Guards the rest of this file. An unstubbed prisma mock returns undefined,
     * so code that reads `.some()` or `.length` off a resolver result throws a
     * TypeError — which a bare `rejects.toThrow()` would absorb, letting every
     * refusal test below pass for the wrong reason. Asserting the resolver was
     * actually consulted, with the role id, is what makes those refusals mean
     * that the gate ran.
     */
    it('consults the permission resolver with the role being assigned', async () => {
      build(SYSTEM_ADMIN_CODES);
      stubAssignable('admin', 'Admin');

      await expect(
        service.assignRole(memberId, roleDefId, ownerUserId),
      ).rejects.toThrow(ForbiddenException);

      expect(permissions.resolvePermissionCodes).toHaveBeenCalledWith([
        roleDefId,
      ]);
    });

    it('refuses with the exact message, not merely with some error', async () => {
      build(SYSTEM_ADMIN_CODES);
      stubAssignable('admin', 'Admin');

      await expect(
        service.assignRole(memberId, roleDefId, ownerUserId),
      ).rejects.toThrow(PLATFORM_CAPABILITY_REFUSAL);
    });

    it('writes nothing when it refuses', async () => {
      build(SYSTEM_ADMIN_CODES);
      stubAssignable('admin', 'Admin');

      await expect(
        service.assignRole(memberId, roleDefId, ownerUserId),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.memberRole.create).not.toHaveBeenCalled();
      expect(cache.invalidateForMember).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // assignRole
  // -------------------------------------------------------------------------

  describe('assignRole', () => {
    it('refuses an owner assigning the system admin role', async () => {
      build(SYSTEM_ADMIN_CODES);
      stubAssignable('admin', 'Admin');

      await expect(
        service.assignRole(memberId, roleDefId, ownerUserId),
      ).rejects.toThrow(PLATFORM_CAPABILITY_REFUSAL);
    });

    it('refuses an owner assigning the system editor role (7 admin:* codes)', async () => {
      build(SYSTEM_EDITOR_CODES);
      stubAssignable('editor', 'Editor');

      await expect(
        service.assignRole(memberId, roleDefId, ownerUserId),
      ).rejects.toThrow(PLATFORM_CAPABILITY_REFUSAL);

      // Confirms the fixture is the thing the bug report describes.
      expect(
        SYSTEM_EDITOR_CODES.filter((c) => c.startsWith('admin:')),
      ).toHaveLength(7);
    });

    it('refuses a role that reaches admin:* only through role_hierarchy', async () => {
      // The role's own role_permissions rows are innocuous; the platform code
      // arrives through a child edge. resolvePermissionCodes is the only reader
      // that expands the hierarchy, which is why the gate calls it rather than
      // reading role_permissions directly.
      build([...MEMBER_CODES, 'admin:review-queue']);
      stubAssignable('paralegal', 'Paralegal');

      await expect(
        service.assignRole(memberId, roleDefId, ownerUserId),
      ).rejects.toThrow(PLATFORM_CAPABILITY_REFUSAL);
    });

    it('refuses a role conferring digests:review, which has no platform prefix', async () => {
      // Reviewing the shared editorial corpus is platform work. A prefix-only
      // rule would let an owner mint this and walk back into the review queue.
      build([...MEMBER_CODES, 'digests:review']);
      stubAssignable('reviewer', 'Reviewer');

      await expect(
        service.assignRole(memberId, roleDefId, ownerUserId),
      ).rejects.toThrow(PLATFORM_CAPABILITY_REFUSAL);
    });

    it('still allows an owner to assign the member role', async () => {
      build(MEMBER_CODES);
      stubAssignable('member', 'Member');
      prisma.memberRole.create.mockResolvedValue({
        id: 'mr-1',
        organizationMemberId: memberId,
        roleDefinitionId: roleDefId,
        assignedByUserId: ownerUserId,
        expiresAt: null,
        createdAt: new Date('2026-09-22'),
        roleDefinition: { name: 'Member', slug: 'member', isSystem: true },
        assignedBy: { fullName: 'Owner' },
      });

      const result = await service.assignRole(memberId, roleDefId, ownerUserId);

      expect(result).toMatchObject({ roleSlug: 'member', isSystem: true });
      expect(prisma.memberRole.create).toHaveBeenCalled();
      expect(cache.invalidateForMember).toHaveBeenCalledWith(memberId);
    });

    it('refuses escalation even when no platform code is involved', async () => {
      // The second gate, in isolation: the role is clean, but the assigner does
      // not hold everything it grants.
      build(['documents:read', 'billing:manage'], ['documents:read']);
      stubAssignable('finance', 'Finance');

      await expect(
        service.assignRole(memberId, roleDefId, ownerUserId),
      ).rejects.toThrow(/billing:manage/);
      expect(prisma.memberRole.create).not.toHaveBeenCalled();
    });

    it('refuses an assigner who is not an active member of the org', async () => {
      build(MEMBER_CODES);
      stubAssignable('member', 'Member');
      permissions.resolveMemberId.mockResolvedValue(null);

      await expect(
        service.assignRole(memberId, roleDefId, ownerUserId),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.memberRole.create).not.toHaveBeenCalled();
    });

    it('audits the refusal so escalation probes are visible in the log', async () => {
      build(SYSTEM_ADMIN_CODES);
      stubAssignable('admin', 'Admin');

      await expect(
        service.assignRole(memberId, roleDefId, ownerUserId),
      ).rejects.toThrow(ForbiddenException);

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'role.platform_capability_refused',
          organizationId: orgId,
          actorUserId: ownerUserId,
          metadata: expect.objectContaining({
            platformCodes: expect.arrayContaining(['admin:dashboard']),
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // createCustomRole / updateCustomRole
  // -------------------------------------------------------------------------

  describe('createCustomRole', () => {
    const dto = {
      name: 'Sneaky',
      slug: 'sneaky',
      permissionIds: [permId],
    } as never;

    it('refuses a custom org role carrying admin:users', async () => {
      build([]);
      prisma.roleDefinition.findFirst.mockResolvedValue(null);
      prisma.permission.findMany.mockResolvedValue([
        { id: permId, code: 'admin:users' },
      ]);

      await expect(
        service.createCustomRole(orgId, dto, ownerUserId),
      ).rejects.toThrow(PLATFORM_CAPABILITY_REFUSAL);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('allows a custom org role carrying only workspace codes', async () => {
      build([]);
      prisma.roleDefinition.findFirst.mockResolvedValue(null);
      prisma.permission.findMany.mockResolvedValue([
        { id: permId, code: 'documents:read' },
      ]);
      prisma.$transaction.mockResolvedValue({ id: 'new-role' });
      prisma.roleDefinition.findUnique.mockResolvedValue({
        id: 'new-role',
        organizationId: orgId,
        name: 'Sneaky',
        slug: 'sneaky',
        description: null,
        isSystem: false,
        requiresMfa: false,
        maxPerOrg: null,
        rolePermissions: [],
        _count: { memberRoles: 0 },
        createdAt: new Date('2026-09-22'),
        updatedAt: new Date('2026-09-22'),
      });

      await expect(
        service.createCustomRole(orgId, dto, ownerUserId),
      ).resolves.toBeDefined();
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('updateCustomRole', () => {
    const existingRole = {
      id: roleDefId,
      organizationId: orgId,
      name: 'Paralegal',
      slug: 'paralegal',
      isSystem: false,
    };

    it('refuses editing a custom role to carry a platform code', async () => {
      build([]);
      prisma.roleDefinition.findUnique.mockResolvedValue(existingRole);
      prisma.permission.findMany.mockResolvedValue([
        { id: permId, code: 'admin:settings' },
      ]);

      await expect(
        service.updateCustomRole(
          roleDefId,
          { permissionIds: [permId] } as never,
          ownerUserId,
        ),
      ).rejects.toThrow(PLATFORM_CAPABILITY_REFUSAL);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses when the platform code arrives through a hierarchy child', async () => {
      build([]);
      prisma.roleDefinition.findUnique.mockResolvedValue(existingRole);
      prisma.permission.findMany.mockResolvedValue([
        { id: permId, code: 'documents:read' },
      ]);
      prisma.roleHierarchy.findMany.mockResolvedValue([
        { childRoleId: 'child-role' },
      ]);
      permissions.resolvePermissionCodes.mockResolvedValue([
        'admin:knowledge-graph',
      ]);

      await expect(
        service.updateCustomRole(
          roleDefId,
          { permissionIds: [permId] } as never,
          ownerUserId,
        ),
      ).rejects.toThrow(PLATFORM_CAPABILITY_REFUSAL);
      expect(permissions.resolvePermissionCodes).toHaveBeenCalledWith([
        'child-role',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // The predicate itself
  // -------------------------------------------------------------------------

  describe('isPlatformScopedCode', () => {
    it.each([
      'admin:dashboard',
      'admin:users',
      'platform-staff:manage',
      'platform-roles:manage',
      'digests:review',
    ])('treats %s as platform scope', (code) => {
      expect(isPlatformScopedCode(code)).toBe(true);
    });

    it.each([
      'documents:read',
      'digests:read',
      'digests:approve',
      'members:update-role',
      'roles:create',
      'billing:manage',
    ])('treats %s as workspace scope', (code) => {
      expect(isPlatformScopedCode(code)).toBe(false);
    });

    it('returns the offending codes de-duplicated and sorted', () => {
      expect(
        findPlatformScopedCodes([
          'admin:users',
          'documents:read',
          'admin:users',
          'admin:billing',
        ]),
      ).toEqual(['admin:billing', 'admin:users']);
    });
  });
});
