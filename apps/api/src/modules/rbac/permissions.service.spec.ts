import { NotFoundException } from '@nestjs/common';

import { PermissionsService } from './permissions.service';

describe('PermissionsService', () => {
  let service: PermissionsService;
  let prisma: {
    memberRole: { findMany: jest.Mock };
    rolePermission: { findMany: jest.Mock };
    roleHierarchy: { findMany: jest.Mock };
    organizationMember: { findFirst: jest.Mock };
    permission: { findMany: jest.Mock; findUnique: jest.Mock };
  };
  let cache: {
    getCachedPermissions: jest.Mock;
    setCachedPermissions: jest.Mock;
    invalidateForMember: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      memberRole: { findMany: jest.fn() },
      rolePermission: { findMany: jest.fn() },
      roleHierarchy: { findMany: jest.fn() },
      organizationMember: { findFirst: jest.fn() },
      permission: { findMany: jest.fn(), findUnique: jest.fn() },
    };
    cache = {
      getCachedPermissions: jest.fn(),
      setCachedPermissions: jest.fn().mockResolvedValue(undefined),
      invalidateForMember: jest.fn().mockResolvedValue(undefined),
    };

    service = new PermissionsService(prisma as never, cache as never);
  });

  // --------------------------------------------------------------------------
  // getEffectivePermissions
  // --------------------------------------------------------------------------

  describe('getEffectivePermissions', () => {
    it('should return cached permissions on cache hit', async () => {
      cache.getCachedPermissions.mockResolvedValue(['documents:read', 'documents:create']);

      const result = await service.getEffectivePermissions('member-1');

      expect(result).toEqual(['documents:read', 'documents:create']);
      expect(prisma.memberRole.findMany).not.toHaveBeenCalled();
    });

    it('should resolve from DB on cache miss and cache the result', async () => {
      cache.getCachedPermissions.mockResolvedValue(null);
      prisma.memberRole.findMany.mockResolvedValue([
        { roleDefinitionId: 'role-1' },
      ]);
      prisma.roleHierarchy.findMany.mockResolvedValue([]);
      prisma.rolePermission.findMany.mockResolvedValue([
        { permission: { code: 'documents:read' } },
        { permission: { code: 'documents:create' } },
      ]);

      const result = await service.getEffectivePermissions('member-1');

      expect(result).toEqual(['documents:read', 'documents:create']);
      expect(cache.setCachedPermissions).toHaveBeenCalledWith(
        'member-1',
        ['documents:read', 'documents:create'],
      );
    });

    it('should return empty array when member has no roles', async () => {
      cache.getCachedPermissions.mockResolvedValue(null);
      prisma.memberRole.findMany.mockResolvedValue([]);

      const result = await service.getEffectivePermissions('member-1');

      expect(result).toEqual([]);
      expect(cache.setCachedPermissions).toHaveBeenCalledWith('member-1', []);
    });

    it('should filter expired role assignments', async () => {
      cache.getCachedPermissions.mockResolvedValue(null);
      // The Prisma query uses OR filter for expiresAt:null or gt:now
      // So expired roles won't appear in results — the mock simulates this
      prisma.memberRole.findMany.mockResolvedValue([
        { roleDefinitionId: 'role-active' },
        // expired role is NOT in results because Prisma filters it out
      ]);
      prisma.roleHierarchy.findMany.mockResolvedValue([]);
      prisma.rolePermission.findMany.mockResolvedValue([
        { permission: { code: 'documents:read' } },
      ]);

      const result = await service.getEffectivePermissions('member-1');
      expect(result).toEqual(['documents:read']);
    });

    it('should include non-expired role assignments', async () => {
      cache.getCachedPermissions.mockResolvedValue(null);
      const futureDate = new Date(Date.now() + 86400000); // tomorrow
      prisma.memberRole.findMany.mockResolvedValue([
        { roleDefinitionId: 'role-1', expiresAt: futureDate },
      ]);
      prisma.roleHierarchy.findMany.mockResolvedValue([]);
      prisma.rolePermission.findMany.mockResolvedValue([
        { permission: { code: 'admin:dashboard' } },
      ]);

      const result = await service.getEffectivePermissions('member-1');
      expect(result).toEqual(['admin:dashboard']);
    });

    it('should expand roles via hierarchy (parent inherits child permissions)', async () => {
      cache.getCachedPermissions.mockResolvedValue(null);
      // Member has "owner" role
      prisma.memberRole.findMany.mockResolvedValue([
        { roleDefinitionId: 'role-owner' },
      ]);
      // Hierarchy: owner → admin → editor
      prisma.roleHierarchy.findMany.mockResolvedValue([
        { parentRoleId: 'role-owner', childRoleId: 'role-admin' },
        { parentRoleId: 'role-admin', childRoleId: 'role-editor' },
      ]);
      // Permissions across all three roles
      prisma.rolePermission.findMany.mockResolvedValue([
        { permission: { code: 'admin:dashboard' } },
        { permission: { code: 'documents:create' } },
        { permission: { code: 'documents:read' } },
      ]);

      const result = await service.getEffectivePermissions('member-1');

      // Should have called rolePermission.findMany with all three role IDs
      expect(prisma.rolePermission.findMany).toHaveBeenCalledWith({
        where: { roleId: { in: expect.arrayContaining(['role-owner', 'role-admin', 'role-editor']) } },
        select: { permission: { select: { code: true } } },
      });
      expect(result).toEqual(['admin:dashboard', 'documents:create', 'documents:read']);
    });

    it('should deduplicate permissions from multiple roles', async () => {
      cache.getCachedPermissions.mockResolvedValue(null);
      prisma.memberRole.findMany.mockResolvedValue([
        { roleDefinitionId: 'role-a' },
        { roleDefinitionId: 'role-b' },
      ]);
      prisma.roleHierarchy.findMany.mockResolvedValue([]);
      // Both roles grant 'documents:read'
      prisma.rolePermission.findMany.mockResolvedValue([
        { permission: { code: 'documents:read' } },
        { permission: { code: 'documents:read' } },
        { permission: { code: 'documents:create' } },
      ]);

      const result = await service.getEffectivePermissions('member-1');
      expect(result).toEqual(['documents:read', 'documents:create']);
    });
  });

  // --------------------------------------------------------------------------
  // hasPermission
  // --------------------------------------------------------------------------

  describe('hasPermission', () => {
    it('should return true when permission exists in effective set', async () => {
      cache.getCachedPermissions.mockResolvedValue(['documents:read', 'documents:create']);
      const result = await service.hasPermission('member-1', 'documents:read');
      expect(result).toBe(true);
    });

    it('should return false when permission not in effective set', async () => {
      cache.getCachedPermissions.mockResolvedValue(['documents:read']);
      const result = await service.hasPermission('member-1', 'admin:dashboard');
      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // hasAnyPermission
  // --------------------------------------------------------------------------

  describe('hasAnyPermission', () => {
    it('should return true when at least one permission matches', async () => {
      cache.getCachedPermissions.mockResolvedValue(['documents:read']);
      const result = await service.hasAnyPermission('member-1', ['documents:read', 'admin:dashboard']);
      expect(result).toBe(true);
    });

    it('should return false when none match', async () => {
      cache.getCachedPermissions.mockResolvedValue(['documents:read']);
      const result = await service.hasAnyPermission('member-1', ['admin:dashboard', 'admin:review-queue']);
      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // hasAllPermissions
  // --------------------------------------------------------------------------

  describe('hasAllPermissions', () => {
    it('should return true when all permissions match', async () => {
      cache.getCachedPermissions.mockResolvedValue(['documents:read', 'documents:create', 'admin:dashboard']);
      const result = await service.hasAllPermissions('member-1', ['documents:read', 'documents:create']);
      expect(result).toBe(true);
    });

    it('should return false when one is missing', async () => {
      cache.getCachedPermissions.mockResolvedValue(['documents:read']);
      const result = await service.hasAllPermissions('member-1', ['documents:read', 'documents:delete']);
      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // resolveMemberId
  // --------------------------------------------------------------------------

  describe('resolveMemberId', () => {
    it('should return memberId for active org member', async () => {
      prisma.organizationMember.findFirst.mockResolvedValue({ id: 'member-99' });
      const result = await service.resolveMemberId('user-1', 'org-1');
      expect(result).toBe('member-99');
      expect(prisma.organizationMember.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', organizationId: 'org-1', status: 'active' },
        select: { id: true },
      });
    });

    it('should return null for non-member', async () => {
      prisma.organizationMember.findFirst.mockResolvedValue(null);
      const result = await service.resolveMemberId('user-unknown', 'org-1');
      expect(result).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // getAllPermissions
  // --------------------------------------------------------------------------

  describe('getAllPermissions', () => {
    it('should return all permissions sorted by category', async () => {
      const mockPerms = [
        { id: '1', code: 'admin:dashboard', resource: 'admin', action: 'dashboard', category: 'admin', description: null },
        { id: '2', code: 'documents:read', resource: 'documents', action: 'read', category: 'content', description: 'Read docs' },
      ];
      prisma.permission.findMany.mockResolvedValue(mockPerms);

      const result = await service.getAllPermissions();

      expect(result).toEqual(mockPerms);
      expect(prisma.permission.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ category: 'asc' }, { resource: 'asc' }, { action: 'asc' }],
      });
    });

    it('should filter by category/resource when provided', async () => {
      prisma.permission.findMany.mockResolvedValue([]);

      await service.getAllPermissions({ category: 'admin', resource: 'dashboard' });

      expect(prisma.permission.findMany).toHaveBeenCalledWith({
        where: { category: 'admin', resource: 'dashboard' },
        orderBy: [{ category: 'asc' }, { resource: 'asc' }, { action: 'asc' }],
      });
    });
  });

  // --------------------------------------------------------------------------
  // getPermissionByCode
  // --------------------------------------------------------------------------

  describe('getPermissionByCode', () => {
    it('should throw NotFoundException when permission does not exist', async () => {
      prisma.permission.findUnique.mockResolvedValue(null);

      await expect(service.getPermissionByCode('nonexistent:perm'))
        .rejects.toThrow(NotFoundException);
      await expect(service.getPermissionByCode('nonexistent:perm'))
        .rejects.toThrow('Permission "nonexistent:perm" not found');
    });
  });
});
