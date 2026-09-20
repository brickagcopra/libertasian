import { ForbiddenException } from '@nestjs/common';

import type { PrismaService } from '../../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PermissionsService } from '../rbac/permissions.service';
import { OrganizationsService } from './organizations.service';

/**
 * `organization_members.role` is deprecated; `member_roles` is authoritative.
 *
 * The two used to drift in both directions, and each direction broke
 * something real:
 *
 *  - The RBAC role APIs write `member_roles` and never the legacy column, so
 *    an authorization check that read the column could not be satisfied by a
 *    role granted in the admin panel. That is what made the digest Assign
 *    button unfixable.
 *  - `dualWriteReplaceMemberRole` deleted EVERY system role the member held
 *    before writing the new one, so editing the legacy column silently
 *    revoked explicit RBAC grants it never knew about — including the `admin`
 *    grant that makes someone a superadmin.
 */
describe('OrganizationsService — legacy role drift', () => {
  function build(opts?: {
    membershipRole?: string;
    membershipStatus?: string;
    holdsPermission?: boolean;
  }) {
    const prisma = {
      organizationMember: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'm-1',
          role: opts?.membershipRole ?? 'member',
          status: opts?.membershipStatus ?? 'active',
        }),
        update: jest.fn().mockResolvedValue({ id: 'm-1' }),
      },
      roleDefinition: {
        findFirst: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve({ id: `rd-${where.slug}` }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
      },
      memberRole: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const permissions = {
      hasPermission: jest.fn().mockResolvedValue(opts?.holdsPermission ?? false),
    };

    const service = new OrganizationsService(
      prisma as unknown as PrismaService,
      {} as unknown as NotificationsService,
      permissions as unknown as PermissionsService,
    );

    return { service, prisma, permissions };
  }

  // -----------------------------------------------------------------------
  // assertRole
  // -----------------------------------------------------------------------

  describe('assertRole', () => {
    it('admits a member whose RBAC permission authorizes the operation', async () => {
      // The panel-granted case: `member_roles` says yes, the legacy column
      // still says 'member'. Before this, the column won and the grant did
      // nothing.
      const { service } = build({ membershipRole: 'member', holdsPermission: true });

      await expect(
        service.assertRole('org-1', 'u-1', ['owner', 'admin'], 'members:invite'),
      ).resolves.toBeUndefined();
    });

    it('still admits a legacy owner with NO member_roles row', async () => {
      // Signup historically wrote organization_members and nothing else, so a
      // large share of existing owners resolve to ZERO permissions. Dropping
      // the column check would lock them out of their own organizations.
      const { service } = build({ membershipRole: 'owner', holdsPermission: false });

      await expect(
        service.assertRole('org-1', 'u-1', ['owner', 'admin'], 'members:invite'),
      ).resolves.toBeUndefined();
    });

    it('denies a member who satisfies neither arm', async () => {
      const { service } = build({ membershipRole: 'member', holdsPermission: false });

      await expect(
        service.assertRole('org-1', 'u-1', ['owner', 'admin'], 'members:invite'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('denies a non-active membership regardless of permissions', async () => {
      const { service } = build({
        membershipRole: 'owner',
        membershipStatus: 'suspended',
        holdsPermission: true,
      });

      await expect(
        service.assertRole('org-1', 'u-1', ['owner', 'admin'], 'members:invite'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('checks the permission against the MEMBERSHIP, not the user', async () => {
      // Permissions are per-membership. Resolving by user id would leak a
      // grant held in one org into every other org the user belongs to.
      const { service, permissions } = build({ holdsPermission: true });

      await service.assertRole('org-1', 'u-1', ['owner'], 'members:invite');

      expect(permissions.hasPermission).toHaveBeenCalledWith(
        'm-1',
        'members:invite',
      );
    });

    it('falls back to the legacy arm when no permission code is supplied', async () => {
      const { service, permissions } = build({ membershipRole: 'owner' });

      await expect(
        service.assertRole('org-1', 'u-1', ['owner', 'admin']),
      ).resolves.toBeUndefined();
      expect(permissions.hasPermission).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // dual-write on a legacy role change
  // -----------------------------------------------------------------------

  describe('updateMemberRole dual-write', () => {
    async function changeRole(from: string, to: string) {
      const { service, prisma } = build({
        membershipRole: from,
        holdsPermission: true,
      });
      await service.updateMemberRole('org-1', 'u-target', to, 'u-actor');
      return prisma;
    }

    it('removes ONLY the system role mirroring the previous legacy value', async () => {
      const prisma = await changeRole('member', 'editor');

      expect(prisma.memberRole.deleteMany).toHaveBeenCalledWith({
        where: {
          organizationMemberId: 'm-1',
          roleDefinitionId: 'rd-member',
        },
      });
    });

    it('never deletes by "every system role" any more', async () => {
      // The old implementation loaded every system role id and deleted them
      // all, taking explicit platform grants with it.
      const prisma = await changeRole('member', 'editor');

      expect(prisma.roleDefinition.findMany).not.toHaveBeenCalled();
      for (const call of prisma.memberRole.deleteMany.mock.calls) {
        expect(call[0].where.roleDefinitionId).not.toHaveProperty('in');
      }
    });

    it('upserts the new role instead of creating it blindly', async () => {
      // The member may already hold the target role from an explicit grant;
      // a bare create would throw on the unique constraint.
      const prisma = await changeRole('member', 'editor');

      expect(prisma.memberRole.upsert).toHaveBeenCalled();
      expect(prisma.memberRole.create).not.toHaveBeenCalled();
    });

    it('deletes nothing when the legacy value did not actually change', async () => {
      const prisma = await changeRole('editor', 'editor');

      expect(prisma.memberRole.deleteMany).not.toHaveBeenCalled();
    });
  });
});
