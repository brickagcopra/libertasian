import { BadRequestException, ForbiddenException } from '@nestjs/common';

import type { OrganizationsService } from '../../organizations/organizations.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { PermissionsService } from '../permissions.service';
import type { RolesService } from '../roles.service';
import { PlatformStaffController } from './platform-staff.controller';

const PLATFORM_ORG = '00000000-0000-0000-0000-000000000001';
const OTHER_ORG = 'some-tenants-org';

/**
 * Staff administration operates on the PLATFORM organization explicitly, never
 * on the caller's current org.
 *
 * That is the whole reason this controller exists rather than reusing
 * /rbac/members: those endpoints scope to the JWT's organizationId, and login
 * picks a user's OLDEST active membership — for anyone who signed up normally,
 * their personal workspace. A superadmin would end up granting `editor` on
 * their own workspace: a grant that confers nothing, silently.
 */
describe('PlatformStaffController', () => {
  function build(opts?: { memberOrg?: string; rolePermissions?: string[] }) {
    const roles = {
      getOrgMembersWithRolesPaginated: jest.fn().mockResolvedValue({
        items: [
          { id: 'm-1', userId: 'u-1', email: 'a@b.c', roles: [] },
          { id: 'm-2', userId: 'u-2', email: 'd@e.f', roles: [] },
        ],
        meta: { hasNext: false },
      }),
      listRoleDefinitions: jest.fn().mockResolvedValue([]),
      createCustomRole: jest.fn().mockResolvedValue({ id: 'role-new' }),
      assignRole: jest.fn().mockResolvedValue({ id: 'mr-1' }),
      removeRole: jest.fn().mockResolvedValue(undefined),
    };
    const permissions = {
      platformOrganizationId: PLATFORM_ORG,
      getEffectivePermissions: jest.fn().mockResolvedValue(['digests:review']),
      getAllPermissions: jest.fn().mockResolvedValue([]),
    };
    const organizations = {
      inviteMember: jest.fn().mockResolvedValue({ id: 'm-new' }),
    };
    const prisma = {
      organizationMember: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ organizationId: opts?.memberOrg ?? PLATFORM_ORG }),
      },
      roleDefinition: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'role-1',
          rolePermissions: (opts?.rolePermissions ?? ['digests:review']).map(
            (code) => ({ permission: { code } }),
          ),
        }),
      },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const controller = new PlatformStaffController(
      roles as unknown as RolesService,
      permissions as unknown as PermissionsService,
      organizations as unknown as OrganizationsService,
      prisma as unknown as PrismaService,
    );

    return { controller, roles, permissions, organizations, prisma };
  }

  const caller = { sub: 'u-super', organizationId: 'u-super-personal-workspace' };

  // -----------------------------------------------------------------------

  describe('scoping', () => {
    it('lists the PLATFORM org, not the caller’s current org', async () => {
      const { controller, roles } = build();

      await controller.listMembers({});

      expect(roles.getOrgMembersWithRolesPaginated).toHaveBeenCalledWith(
        PLATFORM_ORG,
        expect.any(Object),
      );
    });

    it('invites into the PLATFORM org', async () => {
      const { controller, organizations } = build();

      await controller.invite(caller, { email: 'new@libertasian.com', role: 'editor' });

      expect(organizations.inviteMember).toHaveBeenCalledWith(
        PLATFORM_ORG,
        { email: 'new@libertasian.com', role: 'editor' },
        'u-super',
      );
    });

    it('creates custom roles on the PLATFORM org', async () => {
      // A role created on the caller's personal workspace could not be granted
      // to platform staff at all: assignRole refuses a non-system role from
      // another organization.
      const { controller, roles } = build();

      await controller.createRole(caller, {
        name: 'Bar Exam Editor',
        slug: 'bar-exam-editor',
        permissionIds: ['p-1'],
      });

      expect(roles.createCustomRole).toHaveBeenCalledWith(
        PLATFORM_ORG,
        expect.objectContaining({ slug: 'bar-exam-editor' }),
        'u-super',
      );
    });

    it('lists roles grantable on the PLATFORM org', async () => {
      const { controller, roles } = build();

      await controller.listRoles();

      expect(roles.listRoleDefinitions).toHaveBeenCalledWith(PLATFORM_ORG);
    });
  });

  // -----------------------------------------------------------------------

  describe('grants', () => {
    it('refuses to touch a member of another organization', async () => {
      // Platform standing is not tenant standing: a platform
      // members:update-role holder must not be able to reach into a customer's
      // org by passing its member id.
      const { controller, roles } = build({ memberOrg: OTHER_ORG });

      await expect(
        controller.grantRole(caller, 'm-outsider', { roleDefinitionId: 'role-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(roles.assignRole).not.toHaveBeenCalled();
    });

    it('grants through RolesService, which audits the change', async () => {
      const { controller, roles } = build();

      await controller.grantRole(caller, 'm-1', { roleDefinitionId: 'role-1' });

      expect(roles.assignRole).toHaveBeenCalledWith(
        'm-1',
        'role-1',
        'u-super',
        undefined,
      );
    });

    it('supports a temporary grant', async () => {
      const { controller, roles } = build();
      const future = new Date(Date.now() + 86_400_000).toISOString();

      await controller.grantRole(caller, 'm-1', {
        roleDefinitionId: 'role-1',
        expiresAt: future,
      });

      expect(roles.assignRole).toHaveBeenCalledWith(
        'm-1',
        'role-1',
        'u-super',
        new Date(future),
      );
    });

    it('refuses an expiry in the past', async () => {
      // getEffectivePermissions filters on expiresAt > now, so a past expiry
      // writes a row that grants nothing. A grant that silently does nothing
      // is worse than a refusal.
      const { controller, roles } = build();

      await expect(
        controller.grantRole(caller, 'm-1', {
          roleDefinitionId: 'role-1',
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(roles.assignRole).not.toHaveBeenCalled();
    });

    it('revokes through RolesService', async () => {
      const { controller, roles } = build();

      await controller.revokeRole(caller, 'm-1', 'role-1');

      expect(roles.removeRole).toHaveBeenCalledWith('m-1', 'role-1', 'u-super');
    });

    it('refuses to revoke a member of another organization', async () => {
      const { controller, roles } = build({ memberOrg: OTHER_ORG });

      await expect(
        controller.revokeRole(caller, 'm-outsider', 'role-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(roles.removeRole).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------

  describe('self-lockout', () => {
    const selfCaller = { ...caller, platformMemberId: 'm-1' };

    it('refuses to let the caller revoke their own grant-management role', async () => {
      // Recovering from this needs a database migration — which is how the
      // previous lockout in this area had to be fixed.
      const { controller, roles } = build({
        rolePermissions: ['members:update-role', 'members:read'],
      });

      await expect(
        controller.revokeRole(selfCaller, 'm-1', 'role-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(roles.removeRole).not.toHaveBeenCalled();
    });

    it('allows the caller to drop a role that does not manage grants', async () => {
      const { controller, roles } = build({ rolePermissions: ['digests:review'] });

      await controller.revokeRole(selfCaller, 'm-1', 'role-1');

      expect(roles.removeRole).toHaveBeenCalled();
    });

    it('allows revoking the SAME role from someone else', async () => {
      const { controller, roles } = build({
        rolePermissions: ['members:update-role'],
      });

      await controller.revokeRole(selfCaller, 'm-2', 'role-1');

      expect(roles.removeRole).toHaveBeenCalledWith('m-2', 'role-1', 'u-super');
    });
  });

  // -----------------------------------------------------------------------

  it('reports each member’s EFFECTIVE permissions, not just role names', async () => {
    // Role names hide that `admin` carries `reviewer`'s grants through the
    // hierarchy — exactly what an operator needs to see before granting.
    const { controller, permissions } = build();

    const res = await controller.listMembers({});

    expect(permissions.getEffectivePermissions).toHaveBeenCalledWith('m-1');
    expect(res.data[0]).toMatchObject({
      effectivePermissions: ['digests:review'],
    });
  });

  it('scopes the audit trail to the platform org and to RBAC entities', async () => {
    const { controller, prisma } = build();

    await controller.listAuditLogs({});

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: PLATFORM_ORG,
          entityType: { in: ['member_role', 'role_definition'] },
        }),
      }),
    );
  });
});
