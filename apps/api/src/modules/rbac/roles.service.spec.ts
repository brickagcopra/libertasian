import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { RolesService } from './roles.service';

describe('RolesService', () => {
  let service: RolesService;
  let prisma: {
    organizationMember: { findUnique: jest.Mock; findMany: jest.Mock };
    roleDefinition: { findUnique: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock };
    memberRole: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    permission: { findMany: jest.Mock };
    roleHierarchy: { findMany: jest.Mock };
    roleConstraint: { findMany: jest.Mock };
    rolePermission: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let cache: {
    invalidateForMember: jest.Mock;
    invalidateForRole: jest.Mock;
  };
  let audit: {
    log: jest.Mock;
  };

  // Shared fixtures
  const memberId = 'member-1';
  const roleDefId = 'role-def-1';
  const userId = 'user-1';
  const orgId = 'org-1';

  const mockMember = {
    id: memberId,
    organizationId: orgId,
    userId,
    user: { email: 'test@example.com', fullName: 'Test User' },
  };

  const mockRoleDef = {
    id: roleDefId,
    organizationId: null,
    name: 'Editor',
    slug: 'editor',
    description: 'Can edit documents',
    isSystem: true,
    requiresMfa: false,
    maxPerOrg: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const mockMemberRole = {
    id: 'mr-1',
    organizationMemberId: memberId,
    roleDefinitionId: roleDefId,
    assignedByUserId: userId,
    expiresAt: null,
    createdAt: new Date('2026-01-01'),
    roleDefinition: {
      name: 'Editor',
      slug: 'editor',
      isSystem: true,
    },
    assignedBy: { fullName: 'Test User' },
    organizationMember: { organizationId: orgId },
  };

  beforeEach(() => {
    prisma = {
      organizationMember: { findUnique: jest.fn(), findMany: jest.fn() },
      roleDefinition: { findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
      memberRole: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      permission: { findMany: jest.fn() },
      roleHierarchy: { findMany: jest.fn() },
      roleConstraint: { findMany: jest.fn() },
      rolePermission: { findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    cache = {
      invalidateForMember: jest.fn().mockResolvedValue(undefined),
      invalidateForRole: jest.fn().mockResolvedValue(undefined),
    };
    audit = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    service = new RolesService(prisma as never, cache as never, audit as never);
  });

  // -------------------------------------------------------------------------
  // assignRole
  // -------------------------------------------------------------------------

  describe('assignRole', () => {
    it('should assign a system role successfully', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue(mockMember);
      prisma.roleDefinition.findUnique.mockResolvedValue(mockRoleDef);
      prisma.memberRole.findUnique.mockResolvedValue(null);
      prisma.roleConstraint.findMany.mockResolvedValue([]);
      prisma.memberRole.findMany.mockResolvedValue([]);
      prisma.memberRole.create.mockResolvedValue({
        ...mockMemberRole,
        roleDefinition: { ...mockMemberRole.roleDefinition },
      });

      const result = await service.assignRole(memberId, roleDefId, userId);

      expect(result).toMatchObject({
        id: 'mr-1',
        roleDefinitionId: roleDefId,
        roleName: 'Editor',
        roleSlug: 'editor',
        isSystem: true,
        assignedByUserId: userId,
        assignedByName: 'Test User',
        expiresAt: null,
      });
      expect(cache.invalidateForMember).toHaveBeenCalledWith(memberId);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'role.assigned',
          entityType: 'member_role',
        }),
      );
    });

    it('should assign a role with expiresAt', async () => {
      const expiresAt = new Date('2026-12-31');
      prisma.organizationMember.findUnique.mockResolvedValue(mockMember);
      prisma.roleDefinition.findUnique.mockResolvedValue(mockRoleDef);
      prisma.memberRole.findUnique.mockResolvedValue(null);
      prisma.roleConstraint.findMany.mockResolvedValue([]);
      prisma.memberRole.findMany.mockResolvedValue([]);
      prisma.memberRole.create.mockResolvedValue({
        ...mockMemberRole,
        expiresAt,
        roleDefinition: { ...mockMemberRole.roleDefinition },
      });

      const result = await service.assignRole(memberId, roleDefId, userId, expiresAt);

      expect(result.expiresAt).toBe(expiresAt.toISOString());
      expect(prisma.memberRole.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ expiresAt }),
        }),
      );
    });

    it('should throw NotFoundException if member not found', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue(null);

      await expect(service.assignRole(memberId, roleDefId, userId))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if role definition not found', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue(mockMember);
      prisma.roleDefinition.findUnique.mockResolvedValue(null);

      await expect(service.assignRole(memberId, roleDefId, userId))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if org-scoped role does not belong to member org', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue(mockMember);
      prisma.roleDefinition.findUnique.mockResolvedValue({
        ...mockRoleDef,
        isSystem: false,
        organizationId: 'other-org',
      });

      await expect(service.assignRole(memberId, roleDefId, userId))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if role already assigned', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue(mockMember);
      prisma.roleDefinition.findUnique.mockResolvedValue(mockRoleDef);
      prisma.memberRole.findUnique.mockResolvedValue(mockMemberRole);

      await expect(service.assignRole(memberId, roleDefId, userId))
        .rejects.toThrow(ConflictException);
    });

    it('should enforce cardinality limit (maxPerOrg)', async () => {
      const limitedRole = { ...mockRoleDef, maxPerOrg: 1 };
      prisma.organizationMember.findUnique.mockResolvedValue(mockMember);
      prisma.roleDefinition.findUnique.mockResolvedValue(limitedRole);
      prisma.memberRole.findUnique.mockResolvedValue(null);
      prisma.roleConstraint.findMany.mockResolvedValue([]);
      prisma.memberRole.findMany.mockResolvedValue([]);
      prisma.memberRole.count.mockResolvedValue(1); // already at limit

      await expect(service.assignRole(memberId, roleDefId, userId))
        .rejects.toThrow(ConflictException);
    });

    it('should allow assignment when under cardinality limit', async () => {
      const limitedRole = { ...mockRoleDef, maxPerOrg: 3 };
      prisma.organizationMember.findUnique.mockResolvedValue(mockMember);
      prisma.roleDefinition.findUnique.mockResolvedValue(limitedRole);
      prisma.memberRole.findUnique.mockResolvedValue(null);
      prisma.roleConstraint.findMany.mockResolvedValue([]);
      prisma.memberRole.findMany.mockResolvedValue([]);
      prisma.memberRole.count.mockResolvedValue(2); // 2 < 3
      prisma.memberRole.create.mockResolvedValue({
        ...mockMemberRole,
        roleDefinition: { ...mockMemberRole.roleDefinition },
      });

      const result = await service.assignRole(memberId, roleDefId, userId);
      expect(result.id).toBe('mr-1');
    });

    it('should skip cardinality check when maxPerOrg is null', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue(mockMember);
      prisma.roleDefinition.findUnique.mockResolvedValue(mockRoleDef); // maxPerOrg: null
      prisma.memberRole.findUnique.mockResolvedValue(null);
      prisma.roleConstraint.findMany.mockResolvedValue([]);
      prisma.memberRole.findMany.mockResolvedValue([]);
      prisma.memberRole.create.mockResolvedValue({
        ...mockMemberRole,
        roleDefinition: { ...mockMemberRole.roleDefinition },
      });

      await service.assignRole(memberId, roleDefId, userId);
      expect(prisma.memberRole.count).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // removeRole
  // -------------------------------------------------------------------------

  describe('removeRole', () => {
    it('should remove a role assignment', async () => {
      prisma.memberRole.findUnique.mockResolvedValue(mockMemberRole);
      prisma.memberRole.delete.mockResolvedValue(mockMemberRole);

      await service.removeRole(memberId, roleDefId, userId);

      expect(prisma.memberRole.delete).toHaveBeenCalledWith({ where: { id: 'mr-1' } });
      expect(cache.invalidateForMember).toHaveBeenCalledWith(memberId);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'role.removed',
          entityType: 'member_role',
          entityId: 'mr-1',
        }),
      );
    });

    it('should throw NotFoundException if role assignment not found', async () => {
      prisma.memberRole.findUnique.mockResolvedValue(null);

      await expect(service.removeRole(memberId, roleDefId, userId))
        .rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // getMemberRoles
  // -------------------------------------------------------------------------

  describe('getMemberRoles', () => {
    it('should return all roles for a member', async () => {
      prisma.memberRole.findMany.mockResolvedValue([
        {
          id: 'mr-1',
          roleDefinitionId: 'role-1',
          assignedByUserId: userId,
          expiresAt: null,
          createdAt: new Date('2026-01-01'),
          roleDefinition: { name: 'Editor', slug: 'editor', isSystem: true },
          assignedBy: { fullName: 'Admin User' },
        },
        {
          id: 'mr-2',
          roleDefinitionId: 'role-2',
          assignedByUserId: null,
          expiresAt: new Date('2026-12-31'),
          createdAt: new Date('2026-02-01'),
          roleDefinition: { name: 'Reviewer', slug: 'reviewer', isSystem: true },
          assignedBy: null,
        },
      ]);

      const result = await service.getMemberRoles(memberId);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'mr-1',
        roleName: 'Editor',
        roleSlug: 'editor',
        isSystem: true,
        assignedByName: 'Admin User',
        expiresAt: null,
      });
      expect(result[1]).toMatchObject({
        id: 'mr-2',
        roleName: 'Reviewer',
        assignedByName: null,
        expiresAt: new Date('2026-12-31').toISOString(),
      });
    });

    it('should return empty array for member with no roles', async () => {
      prisma.memberRole.findMany.mockResolvedValue([]);

      const result = await service.getMemberRoles(memberId);
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getOrgMembersWithRoles
  // -------------------------------------------------------------------------

  describe('getOrgMembersWithRoles', () => {
    it('should return all members with their roles', async () => {
      prisma.organizationMember.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          organizationId: orgId,
          userId: 'user-1',
          role: 'admin',
          status: 'active',
          createdAt: new Date('2026-01-01'),
          user: { email: 'admin@example.com', fullName: 'Admin' },
          memberRoles: [
            {
              id: 'mr-1',
              roleDefinitionId: 'rd-1',
              assignedByUserId: userId,
              expiresAt: null,
              createdAt: new Date('2026-01-01'),
              roleDefinition: { name: 'Admin', slug: 'admin', isSystem: true },
              assignedBy: { fullName: 'System' },
            },
          ],
        },
      ]);

      const result = await service.getOrgMembersWithRoles(orgId);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'mem-1',
        email: 'admin@example.com',
        fullName: 'Admin',
        legacyRole: 'admin',
        status: 'active',
      });
      expect(result[0]!.roles).toHaveLength(1);
      expect(result[0]!.roles[0]!.roleName).toBe('Admin');
    });

    it('should return empty array for org with no members', async () => {
      prisma.organizationMember.findMany.mockResolvedValue([]);

      const result = await service.getOrgMembersWithRoles(orgId);
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // listRoleDefinitions
  // -------------------------------------------------------------------------

  describe('listRoleDefinitions', () => {
    const mockRoleRow = {
      id: 'rd-1',
      organizationId: null,
      name: 'Admin',
      slug: 'admin',
      description: 'Administrator',
      isSystem: true,
      requiresMfa: true,
      maxPerOrg: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      _count: { rolePermissions: 15, memberRoles: 3 },
    };

    it('should return system + org roles when organizationId provided', async () => {
      prisma.roleDefinition.findMany.mockResolvedValue([mockRoleRow]);

      const result = await service.listRoleDefinitions(orgId);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'rd-1',
        name: 'Admin',
        permissionCount: 15,
        memberCount: 3,
      });
      expect(prisma.roleDefinition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ isSystem: true, organizationId: null }, { organizationId: orgId }] },
        }),
      );
    });

    it('should return system roles only when no organizationId', async () => {
      prisma.roleDefinition.findMany.mockResolvedValue([mockRoleRow]);

      await service.listRoleDefinitions();

      expect(prisma.roleDefinition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isSystem: true, organizationId: null },
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // getRoleDefinitionById
  // -------------------------------------------------------------------------

  describe('getRoleDefinitionById', () => {
    it('should return a role with permissions', async () => {
      prisma.roleDefinition.findUnique.mockResolvedValue({
        id: 'rd-1',
        organizationId: null,
        name: 'Editor',
        slug: 'editor',
        description: 'Can edit',
        isSystem: true,
        requiresMfa: false,
        maxPerOrg: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        rolePermissions: [
          {
            permission: {
              id: 'p-1',
              code: 'documents:read',
              resource: 'documents',
              action: 'read',
              category: 'content',
              description: 'Read documents',
              isSystem: true,
            },
          },
        ],
        _count: { memberRoles: 5 },
      });

      const result = await service.getRoleDefinitionById('rd-1');

      expect(result).toMatchObject({
        id: 'rd-1',
        name: 'Editor',
        slug: 'editor',
        memberCount: 5,
      });
      expect(result.permissions).toHaveLength(1);
      expect(result.permissions[0]!.code).toBe('documents:read');
    });

    it('should throw NotFoundException if role not found', async () => {
      prisma.roleDefinition.findUnique.mockResolvedValue(null);

      await expect(service.getRoleDefinitionById('nonexistent'))
        .rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // createCustomRole
  // -------------------------------------------------------------------------

  describe('createCustomRole', () => {
    const dto = {
      name: 'Custom Reviewer',
      slug: 'custom-reviewer',
      description: 'Reviews custom docs',
      permissionIds: ['p-1', 'p-2'],
      requiresMfa: true,
      maxPerOrg: 5,
    } as never;

    it('should create a custom role in a transaction', async () => {
      prisma.roleDefinition.findFirst.mockResolvedValue(null); // slug unique
      prisma.permission.findMany.mockResolvedValue([{ id: 'p-1' }, { id: 'p-2' }]);
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          roleDefinition: { create: jest.fn().mockResolvedValue({ id: 'new-role-1' }) },
          rolePermission: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
        };
        return fn(tx);
      });
      // Mock the getRoleDefinitionById call at the end
      prisma.roleDefinition.findUnique.mockResolvedValue({
        id: 'new-role-1',
        organizationId: orgId,
        name: 'Custom Reviewer',
        slug: 'custom-reviewer',
        description: 'Reviews custom docs',
        isSystem: false,
        requiresMfa: true,
        maxPerOrg: 5,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        rolePermissions: [],
        _count: { memberRoles: 0 },
      });

      const result = await service.createCustomRole(orgId, dto, userId);

      expect(result).toMatchObject({ id: 'new-role-1', name: 'Custom Reviewer' });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'role.created',
          entityType: 'role_definition',
        }),
      );
    });

    it('should throw ConflictException if slug already exists', async () => {
      prisma.roleDefinition.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(service.createCustomRole(orgId, dto, userId))
        .rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if permission IDs are invalid', async () => {
      prisma.roleDefinition.findFirst.mockResolvedValue(null);
      prisma.permission.findMany.mockResolvedValue([{ id: 'p-1' }]); // only 1 of 2 found

      await expect(service.createCustomRole(orgId, dto, userId))
        .rejects.toThrow(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // updateCustomRole
  // -------------------------------------------------------------------------

  describe('updateCustomRole', () => {
    const customRole = {
      ...mockRoleDef,
      isSystem: false,
      organizationId: orgId,
    };

    it('should update a custom role name and permissions', async () => {
      prisma.roleDefinition.findUnique
        .mockResolvedValueOnce(customRole) // first call in updateCustomRole
        .mockResolvedValueOnce({           // second call via getRoleDefinitionById
          ...customRole,
          name: 'Updated Name',
          rolePermissions: [],
          _count: { memberRoles: 0 },
        });
      prisma.permission.findMany.mockResolvedValue([{ id: 'p-1' }]);
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          roleDefinition: { update: jest.fn().mockResolvedValue({}) },
          rolePermission: {
            deleteMany: jest.fn().mockResolvedValue({}),
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return fn(tx);
      });

      const result = await service.updateCustomRole(
        roleDefId,
        { name: 'Updated Name', permissionIds: ['p-1'] } as never,
        userId,
      );

      expect(result.name).toBe('Updated Name');
      expect(cache.invalidateForRole).toHaveBeenCalledWith(roleDefId);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'role.updated' }),
      );
    });

    it('should throw NotFoundException if role not found', async () => {
      prisma.roleDefinition.findUnique.mockResolvedValue(null);

      await expect(service.updateCustomRole('missing', {} as never, userId))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if trying to modify system role', async () => {
      prisma.roleDefinition.findUnique.mockResolvedValue(mockRoleDef); // isSystem: true

      await expect(service.updateCustomRole(roleDefId, {} as never, userId))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if permission IDs are invalid', async () => {
      prisma.roleDefinition.findUnique.mockResolvedValue(customRole);
      prisma.permission.findMany.mockResolvedValue([]); // none found

      await expect(
        service.updateCustomRole(roleDefId, { permissionIds: ['bad-id'] } as never, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should skip transaction update if no scalar fields change', async () => {
      prisma.roleDefinition.findUnique
        .mockResolvedValueOnce(customRole)
        .mockResolvedValueOnce({ ...customRole, rolePermissions: [], _count: { memberRoles: 0 } });
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          roleDefinition: { update: jest.fn() },
          rolePermission: { deleteMany: jest.fn(), createMany: jest.fn() },
        };
        const result = await fn(tx);
        // update should NOT have been called since no fields changed
        expect(tx.roleDefinition.update).not.toHaveBeenCalled();
        return result;
      });

      await service.updateCustomRole(roleDefId, {} as never, userId);
    });
  });

  // -------------------------------------------------------------------------
  // deleteCustomRole
  // -------------------------------------------------------------------------

  describe('deleteCustomRole', () => {
    it('should delete a custom role with no members', async () => {
      prisma.roleDefinition.findUnique.mockResolvedValue({
        ...mockRoleDef,
        isSystem: false,
        organizationId: orgId,
        _count: { memberRoles: 0 },
      });
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          rolePermission: { deleteMany: jest.fn().mockResolvedValue({}) },
          roleConstraint: { deleteMany: jest.fn().mockResolvedValue({}) },
          roleHierarchy: { deleteMany: jest.fn().mockResolvedValue({}) },
          roleDefinition: { delete: jest.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });

      await service.deleteCustomRole(roleDefId, userId);

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'role.deleted',
          entityType: 'role_definition',
        }),
      );
    });

    it('should throw NotFoundException if role not found', async () => {
      prisma.roleDefinition.findUnique.mockResolvedValue(null);

      await expect(service.deleteCustomRole('missing', userId))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if role is system', async () => {
      prisma.roleDefinition.findUnique.mockResolvedValue({
        ...mockRoleDef,
        _count: { memberRoles: 0 },
      });

      await expect(service.deleteCustomRole(roleDefId, userId))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if members still hold the role', async () => {
      prisma.roleDefinition.findUnique.mockResolvedValue({
        ...mockRoleDef,
        isSystem: false,
        organizationId: orgId,
        _count: { memberRoles: 3 },
      });

      await expect(service.deleteCustomRole(roleDefId, userId))
        .rejects.toThrow(ConflictException);
    });
  });

  // -------------------------------------------------------------------------
  // getOrgMembersWithRolesPaginated
  // -------------------------------------------------------------------------

  describe('getOrgMembersWithRolesPaginated', () => {
    const makeOrgMember = (id: string) => ({
      id,
      organizationId: orgId,
      userId: `user-${id}`,
      role: 'member',
      status: 'active',
      createdAt: new Date('2026-01-01'),
      user: { email: `${id}@example.com`, fullName: `User ${id}` },
      memberRoles: [],
    });

    it('should return paginated members with hasNext = false', async () => {
      prisma.organizationMember.findMany.mockResolvedValue([makeOrgMember('1')]);

      const result = await service.getOrgMembersWithRolesPaginated(orgId, { limit: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.meta.hasNext).toBe(false);
      expect(result.meta.nextCursor).toBeUndefined();
    });

    it('should return hasNext = true when more items exist', async () => {
      // Return limit + 1 items to signal more pages
      const members = Array.from({ length: 3 }, (_, i) => makeOrgMember(`m-${i}`));
      prisma.organizationMember.findMany.mockResolvedValue(members);

      const result = await service.getOrgMembersWithRolesPaginated(orgId, { limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.nextCursor).toBe('m-1');
    });

    it('should apply cursor pagination', async () => {
      prisma.organizationMember.findMany.mockResolvedValue([]);

      await service.getOrgMembersWithRolesPaginated(orgId, { cursor: 'cur-1', limit: 10 });

      expect(prisma.organizationMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 11,
          skip: 1,
          cursor: { id: 'cur-1' },
        }),
      );
    });

    it('should apply search filter on name and email', async () => {
      prisma.organizationMember.findMany.mockResolvedValue([]);

      await service.getOrgMembersWithRolesPaginated(orgId, { search: 'john' });

      expect(prisma.organizationMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user: {
              OR: [
                { fullName: { contains: 'john', mode: 'insensitive' } },
                { email: { contains: 'john', mode: 'insensitive' } },
              ],
            },
          }),
        }),
      );
    });

    it('should apply roleSlug filter', async () => {
      prisma.organizationMember.findMany.mockResolvedValue([]);

      await service.getOrgMembersWithRolesPaginated(orgId, { roleSlug: 'admin' });

      expect(prisma.organizationMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            memberRoles: { some: { roleDefinition: { slug: 'admin' } } },
          }),
        }),
      );
    });

    it('should use default limit of 20', async () => {
      prisma.organizationMember.findMany.mockResolvedValue([]);

      await service.getOrgMembersWithRolesPaginated(orgId, {});

      expect(prisma.organizationMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 21 }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // getHierarchyEdges
  // -------------------------------------------------------------------------

  describe('getHierarchyEdges', () => {
    it('should return all hierarchy edges', async () => {
      prisma.roleHierarchy.findMany.mockResolvedValue([
        {
          id: 'h-1',
          parentRoleId: 'role-owner',
          childRoleId: 'role-admin',
          parentRole: { name: 'Owner' },
          childRole: { name: 'Admin' },
        },
        {
          id: 'h-2',
          parentRoleId: 'role-admin',
          childRoleId: 'role-editor',
          parentRole: { name: 'Admin' },
          childRole: { name: 'Editor' },
        },
      ]);

      const result = await service.getHierarchyEdges();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'h-1',
        parentRoleId: 'role-owner',
        parentRoleName: 'Owner',
        childRoleId: 'role-admin',
        childRoleName: 'Admin',
      });
    });

    it('should return empty array when no hierarchy defined', async () => {
      prisma.roleHierarchy.findMany.mockResolvedValue([]);

      const result = await service.getHierarchyEdges();
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getHierarchyTree
  // -------------------------------------------------------------------------

  describe('getHierarchyTree', () => {
    it('should build a tree from roles and edges', async () => {
      prisma.roleDefinition.findMany.mockResolvedValue([
        { id: 'r-owner', name: 'Owner', slug: 'owner' },
        { id: 'r-admin', name: 'Admin', slug: 'admin' },
        { id: 'r-editor', name: 'Editor', slug: 'editor' },
      ]);
      prisma.roleHierarchy.findMany.mockResolvedValue([
        { parentRoleId: 'r-owner', childRoleId: 'r-admin' },
        { parentRoleId: 'r-admin', childRoleId: 'r-editor' },
      ]);

      const result = await service.getHierarchyTree();

      // Only root (owner) should be at top level
      expect(result).toHaveLength(1);
      expect(result[0]!.roleName).toBe('Owner');
      expect(result[0]!.children).toHaveLength(1);
      expect(result[0]!.children[0]!.roleName).toBe('Admin');
      expect(result[0]!.children[0]!.children).toHaveLength(1);
      expect(result[0]!.children[0]!.children[0]!.roleName).toBe('Editor');
    });

    it('should handle multiple root nodes', async () => {
      prisma.roleDefinition.findMany.mockResolvedValue([
        { id: 'r-a', name: 'Root A', slug: 'root-a' },
        { id: 'r-b', name: 'Root B', slug: 'root-b' },
      ]);
      prisma.roleHierarchy.findMany.mockResolvedValue([]); // no edges = both are roots

      const result = await service.getHierarchyTree();
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no roles exist', async () => {
      prisma.roleDefinition.findMany.mockResolvedValue([]);
      prisma.roleHierarchy.findMany.mockResolvedValue([]);

      const result = await service.getHierarchyTree();
      expect(result).toEqual([]);
    });

    it('should handle diamond hierarchy (admin→reviewer, admin→member)', async () => {
      prisma.roleDefinition.findMany.mockResolvedValue([
        { id: 'r-owner', name: 'Owner', slug: 'owner' },
        { id: 'r-admin', name: 'Admin', slug: 'admin' },
        { id: 'r-reviewer', name: 'Reviewer', slug: 'reviewer' },
        { id: 'r-member', name: 'Member', slug: 'member' },
      ]);
      prisma.roleHierarchy.findMany.mockResolvedValue([
        { parentRoleId: 'r-owner', childRoleId: 'r-admin' },
        { parentRoleId: 'r-admin', childRoleId: 'r-reviewer' },
        { parentRoleId: 'r-admin', childRoleId: 'r-member' },
      ]);

      const result = await service.getHierarchyTree();

      expect(result).toHaveLength(1);
      expect(result[0]!.children).toHaveLength(1); // admin
      expect(result[0]!.children[0]!.children).toHaveLength(2); // reviewer + member
    });
  });

  // -------------------------------------------------------------------------
  // listConstraints
  // -------------------------------------------------------------------------

  describe('listConstraints', () => {
    it('should return all constraints', async () => {
      prisma.roleConstraint.findMany.mockResolvedValue([
        {
          id: 'c-1',
          roleAId: 'r-editor',
          roleBId: 'r-reviewer',
          constraintType: 'mutually_exclusive',
          roleA: { name: 'Editor', slug: 'editor' },
          roleB: { name: 'Reviewer', slug: 'reviewer' },
        },
      ]);

      const result = await service.listConstraints();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'c-1',
        roleAId: 'r-editor',
        roleAName: 'Editor',
        roleASlug: 'editor',
        roleBId: 'r-reviewer',
        roleBName: 'Reviewer',
        roleBSlug: 'reviewer',
        constraintType: 'mutually_exclusive',
      });
    });

    it('should return empty array when no constraints defined', async () => {
      prisma.roleConstraint.findMany.mockResolvedValue([]);

      const result = await service.listConstraints();
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // checkConstraints
  // -------------------------------------------------------------------------

  describe('checkConstraints', () => {
    it('should pass when no constraints exist', async () => {
      prisma.memberRole.findMany.mockResolvedValue([]);
      prisma.roleConstraint.findMany.mockResolvedValue([]);

      await expect(service.checkConstraints(memberId, roleDefId))
        .resolves.toBeUndefined();
    });

    it('should throw ConflictException on SoD violation (candidate is roleA)', async () => {
      prisma.memberRole.findMany.mockResolvedValue([
        { roleDefinitionId: 'r-reviewer' },
      ]);
      prisma.roleConstraint.findMany.mockResolvedValue([
        {
          roleAId: roleDefId,        // candidate
          roleBId: 'r-reviewer',     // conflicting
          constraintType: 'mutually_exclusive',
          roleA: { name: 'Editor', slug: 'editor' },
          roleB: { name: 'Reviewer', slug: 'reviewer' },
        },
      ]);

      await expect(service.checkConstraints(memberId, roleDefId))
        .rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException on SoD violation (candidate is roleB)', async () => {
      prisma.memberRole.findMany.mockResolvedValue([
        { roleDefinitionId: 'r-editor' },
      ]);
      prisma.roleConstraint.findMany.mockResolvedValue([
        {
          roleAId: 'r-editor',        // conflicting
          roleBId: roleDefId,          // candidate
          constraintType: 'mutually_exclusive',
          roleA: { name: 'Editor', slug: 'editor' },
          roleB: { name: 'Reviewer', slug: 'reviewer' },
        },
      ]);

      await expect(service.checkConstraints(memberId, roleDefId))
        .rejects.toThrow(ConflictException);
    });

    it('should pass when constraint exists but member does not hold conflicting role', async () => {
      prisma.memberRole.findMany.mockResolvedValue([
        { roleDefinitionId: 'r-member' }, // not the conflicting one
      ]);
      prisma.roleConstraint.findMany.mockResolvedValue([
        {
          roleAId: roleDefId,
          roleBId: 'r-reviewer',
          constraintType: 'mutually_exclusive',
          roleA: { name: 'Editor', slug: 'editor' },
          roleB: { name: 'Reviewer', slug: 'reviewer' },
        },
      ]);

      await expect(service.checkConstraints(memberId, roleDefId))
        .resolves.toBeUndefined();
    });

    it('should handle multiple constraints checking all of them', async () => {
      prisma.memberRole.findMany.mockResolvedValue([
        { roleDefinitionId: 'r-safe' },
      ]);
      prisma.roleConstraint.findMany.mockResolvedValue([
        {
          roleAId: roleDefId,
          roleBId: 'r-x',
          constraintType: 'mutually_exclusive',
          roleA: { name: 'A', slug: 'a' },
          roleB: { name: 'X', slug: 'x' },
        },
        {
          roleAId: roleDefId,
          roleBId: 'r-y',
          constraintType: 'mutually_exclusive',
          roleA: { name: 'A', slug: 'a' },
          roleB: { name: 'Y', slug: 'y' },
        },
      ]);

      // Neither r-x nor r-y held, so should pass
      await expect(service.checkConstraints(memberId, roleDefId))
        .resolves.toBeUndefined();
    });
  });
});
