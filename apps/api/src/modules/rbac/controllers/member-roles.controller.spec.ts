import { ForbiddenException } from '@nestjs/common';

import { MemberRolesController } from './member-roles.controller';

describe('MemberRolesController', () => {
  let controller: MemberRolesController;
  let rolesService: {
    getOrgMembersWithRolesPaginated: jest.Mock;
    getMemberRoles: jest.Mock;
    assignRole: jest.Mock;
    removeRole: jest.Mock;
  };
  let permissionsService: {
    getEffectivePermissions: jest.Mock;
  };
  let prisma: {
    organizationMember: { findUnique: jest.Mock };
  };

  const mockUser = { sub: 'user-1', organizationId: 'org-1', memberId: 'mem-1' };
  const targetMemberId = 'target-member-1';

  beforeEach(() => {
    rolesService = {
      getOrgMembersWithRolesPaginated: jest.fn(),
      getMemberRoles: jest.fn(),
      assignRole: jest.fn(),
      removeRole: jest.fn(),
    };
    permissionsService = {
      getEffectivePermissions: jest.fn(),
    };
    prisma = {
      organizationMember: { findUnique: jest.fn() },
    };
    controller = new MemberRolesController(
      rolesService as never,
      permissionsService as never,
      prisma as never,
    );
  });

  // -----------------------------------------------------------------------
  // listMembers
  // -----------------------------------------------------------------------

  describe('listMembers', () => {
    it('should return paginated members', async () => {
      const items = [{ id: 'mem-1', email: 'a@test.com', roles: [] }];
      const meta = { hasNext: false };
      rolesService.getOrgMembersWithRolesPaginated.mockResolvedValue({ items, meta });

      const result = await controller.listMembers(mockUser as never, {
        cursor: undefined,
        limit: 20,
        search: undefined,
        roleSlug: undefined,
      } as never);

      expect(result).toEqual({ success: true, data: items, meta });
      expect(rolesService.getOrgMembersWithRolesPaginated).toHaveBeenCalledWith('org-1', {
        cursor: undefined,
        limit: 20,
        search: undefined,
        roleSlug: undefined,
      });
    });

    it('should pass search and roleSlug filters', async () => {
      rolesService.getOrgMembersWithRolesPaginated.mockResolvedValue({ items: [], meta: { hasNext: false } });

      await controller.listMembers(mockUser as never, {
        search: 'john',
        roleSlug: 'admin',
        limit: 10,
      } as never);

      expect(rolesService.getOrgMembersWithRolesPaginated).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ search: 'john', roleSlug: 'admin', limit: 10 }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // getMemberRoles
  // -----------------------------------------------------------------------

  describe('getMemberRoles', () => {
    it('should return roles for a member in the same org', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({ organizationId: 'org-1' });
      const roles = [{ id: 'mr-1', roleName: 'Editor' }];
      rolesService.getMemberRoles.mockResolvedValue(roles);

      const result = await controller.getMemberRoles(mockUser as never, targetMemberId);

      expect(result).toEqual({ success: true, data: roles });
    });

    it('should throw ForbiddenException for cross-tenant access', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({ organizationId: 'other-org' });

      await expect(controller.getMemberRoles(mockUser as never, targetMemberId))
        .rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if member not found', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue(null);

      await expect(controller.getMemberRoles(mockUser as never, targetMemberId))
        .rejects.toThrow(ForbiddenException);
    });
  });

  // -----------------------------------------------------------------------
  // assignRole
  // -----------------------------------------------------------------------

  describe('assignRole', () => {
    it('should assign a role to a member in the same org', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({ organizationId: 'org-1' });
      const assignment = { id: 'mr-new', roleName: 'Editor' };
      rolesService.assignRole.mockResolvedValue(assignment);

      const dto = { roleDefinitionId: 'rd-1' };
      const result = await controller.assignRole(mockUser as never, targetMemberId, dto as never);

      expect(result).toEqual({ success: true, data: assignment });
      expect(rolesService.assignRole).toHaveBeenCalledWith(targetMemberId, 'rd-1', 'user-1', undefined);
    });

    it('should pass expiresAt when provided', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({ organizationId: 'org-1' });
      rolesService.assignRole.mockResolvedValue({ id: 'mr-1' });

      const dto = { roleDefinitionId: 'rd-1', expiresAt: '2026-12-31T00:00:00.000Z' };
      await controller.assignRole(mockUser as never, targetMemberId, dto as never);

      expect(rolesService.assignRole).toHaveBeenCalledWith(
        targetMemberId,
        'rd-1',
        'user-1',
        expect.any(Date),
      );
    });

    it('should throw ForbiddenException for cross-tenant assignment', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({ organizationId: 'other-org' });

      await expect(
        controller.assignRole(mockUser as never, targetMemberId, { roleDefinitionId: 'rd-1' } as never),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // -----------------------------------------------------------------------
  // removeRole
  // -----------------------------------------------------------------------

  describe('removeRole', () => {
    it('should remove a role from a member in the same org', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({ organizationId: 'org-1' });
      rolesService.removeRole.mockResolvedValue(undefined);

      const result = await controller.removeRole(mockUser as never, targetMemberId, 'rd-1');

      expect(result).toEqual({ success: true });
      expect(rolesService.removeRole).toHaveBeenCalledWith(targetMemberId, 'rd-1', 'user-1');
    });

    it('should throw ForbiddenException for cross-tenant removal', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({ organizationId: 'other-org' });

      await expect(controller.removeRole(mockUser as never, targetMemberId, 'rd-1'))
        .rejects.toThrow(ForbiddenException);
    });
  });

  // -----------------------------------------------------------------------
  // getMemberPermissions
  // -----------------------------------------------------------------------

  describe('getMemberPermissions', () => {
    it('should return effective permissions for a member in the same org', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({ organizationId: 'org-1' });
      const perms = ['documents:read', 'documents:create'];
      permissionsService.getEffectivePermissions.mockResolvedValue(perms);

      const result = await controller.getMemberPermissions(mockUser as never, targetMemberId);

      expect(result).toEqual({ success: true, data: perms });
      expect(permissionsService.getEffectivePermissions).toHaveBeenCalledWith(targetMemberId);
    });

    it('should throw ForbiddenException for cross-tenant permission check', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({ organizationId: 'other-org' });

      await expect(controller.getMemberPermissions(mockUser as never, targetMemberId))
        .rejects.toThrow(ForbiddenException);
    });
  });
});
