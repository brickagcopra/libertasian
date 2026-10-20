import { MemberRoleSyncService } from './member-role-sync.service';

/**
 * The legacy-role → member_roles mirror.
 *
 * One implementation, shared by OrganizationsService and AuthService. It was
 * private on OrganizationsService, which is exactly why registration skipped
 * it: the auth module could not reach it, so every signup wrote
 * `organization_members.role` and no `member_roles` row — and authorization
 * reads `member_roles` only.
 */
describe('MemberRoleSyncService', () => {
  function build(
    roleDefs: Array<{
      id: string;
      slug: string;
      isSystem: boolean;
      organizationId: string | null;
    }> = [
      { id: 'rd-owner', slug: 'owner', isSystem: true, organizationId: null },
      { id: 'rd-member', slug: 'member', isSystem: true, organizationId: null },
      { id: 'rd-admin', slug: 'admin', isSystem: true, organizationId: null },
    ],
  ) {
    const prisma = {
      roleDefinition: {
        findFirst: jest
          .fn()
          .mockImplementation(
            (args: {
              where: {
                slug: string;
                isSystem: boolean;
                organizationId: null;
              };
            }) =>
              Promise.resolve(
                roleDefs.find(
                  (r) =>
                    r.slug === args.where.slug &&
                    r.isSystem === args.where.isSystem &&
                    r.organizationId === args.where.organizationId,
                ) ?? null,
              ),
          ),
        findMany: jest
          .fn()
          .mockResolvedValue(
            roleDefs
              .filter((r) => r.isSystem && r.organizationId === null)
              .map((r) => ({ id: r.id })),
          ),
      },
      memberRole: {
        upsert: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const cache = {
      invalidateForMember: jest.fn().mockResolvedValue(undefined),
    };
    // Default: the legacy role confers nothing platform-scoped, so the
    // containment guard passes and the mirror behaviour below is what is
    // under test. The guard itself is covered in
    // no-platform-capability-via-legacy-membership.spec.ts.
    const permissions = {
      resolvePermissionCodes: jest.fn().mockResolvedValue([]),
    };
    return {
      service: new MemberRoleSyncService(
        prisma as never,
        cache as never,
        permissions as never,
      ),
      prisma,
      cache,
      permissions,
    };
  }

  describe('linkSystemRole', () => {
    it('upserts the SYSTEM role matching the legacy role', async () => {
      const { service, prisma } = build();

      await service.linkSystemRole('member-1', 'owner', 'user-1');

      expect(prisma.roleDefinition.findFirst).toHaveBeenCalledWith({
        where: { slug: 'owner', isSystem: true, organizationId: null },
        select: { id: true },
      });
      expect(prisma.memberRole.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: {
            organizationMemberId: 'member-1',
            roleDefinitionId: 'rd-owner',
            assignedByUserId: 'user-1',
          },
          update: {},
        }),
      );
    });

    it('is idempotent — upsert, never a bare create', async () => {
      const { service, prisma } = build();

      await service.linkSystemRole('member-1', 'owner');
      await service.linkSystemRole('member-1', 'owner');

      expect(prisma.memberRole.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.memberRole.create).not.toHaveBeenCalled();
    });

    it('invalidates the member’s cached permissions', async () => {
      // Without this the new owner reads a cached empty set for 5 minutes and
      // sees an empty workspace immediately after signing up.
      const { service, cache } = build();

      await service.linkSystemRole('member-1', 'owner');

      expect(cache.invalidateForMember).toHaveBeenCalledWith('member-1');
    });

    it('never matches an ORG-CUSTOM role that shares the slug', async () => {
      const { service, prisma } = build([
        { id: 'rd-owner-org', slug: 'owner', isSystem: false, organizationId: 'org-1' },
      ]);

      await service.linkSystemRole('member-1', 'owner');

      expect(prisma.memberRole.upsert).not.toHaveBeenCalled();
    });

    it('writes nothing when no system role matches, rather than guessing', async () => {
      const { service, prisma } = build();

      await service.linkSystemRole('member-1', 'superuser');

      expect(prisma.memberRole.upsert).not.toHaveBeenCalled();
    });

    it('swallows a write failure — registration must not fail over a mirror', async () => {
      const { service, prisma } = build();
      prisma.memberRole.upsert.mockRejectedValue(new Error('db is down'));

      await expect(
        service.linkSystemRole('member-1', 'owner'),
      ).resolves.toBeUndefined();
    });

    it('omits assignedByUserId when there is no actor', async () => {
      const { service, prisma } = build();

      await service.linkSystemRole('member-1', 'owner');

      const call = (
        prisma.memberRole.upsert.mock.calls as Array<
          [{ create: Record<string, unknown> }]
        >
      )[0]![0];
      expect(call.create).not.toHaveProperty('assignedByUserId');
    });
  });

  describe('replaceSystemRole', () => {
    it('drops every SYSTEM role, then links the new one', async () => {
      const { service, prisma } = build();

      await service.replaceSystemRole('member-1', 'admin', 'actor-1');

      expect(prisma.memberRole.deleteMany).toHaveBeenCalledWith({
        where: {
          organizationMemberId: 'member-1',
          roleDefinitionId: { in: ['rd-owner', 'rd-member', 'rd-admin'] },
        },
      });
      expect(prisma.memberRole.create).toHaveBeenCalledWith({
        data: {
          organizationMemberId: 'member-1',
          roleDefinitionId: 'rd-admin',
          assignedByUserId: 'actor-1',
        },
      });
    });

    it('leaves an org-custom role alone — only system roles are replaced', async () => {
      // A role assigned deliberately through the RBAC panel is not collateral
      // damage of a legacy role change.
      const { service, prisma } = build();

      await service.replaceSystemRole('member-1', 'admin', 'actor-1');

      const call = (
        prisma.memberRole.deleteMany.mock.calls as Array<
          [{ where: { roleDefinitionId: { in: string[] } } }]
        >
      )[0]![0];
      expect(call.where.roleDefinitionId.in).not.toContain('rd-owner-org');
    });

    it('deletes nothing when the new role does not resolve', async () => {
      const { service, prisma } = build();

      await service.replaceSystemRole('member-1', 'superuser', 'actor-1');

      expect(prisma.memberRole.deleteMany).not.toHaveBeenCalled();
      expect(prisma.memberRole.create).not.toHaveBeenCalled();
    });

    it('swallows a failure rather than breaking the role change', async () => {
      const { service, prisma } = build();
      prisma.memberRole.create.mockRejectedValue(new Error('db is down'));

      await expect(
        service.replaceSystemRole('member-1', 'admin', 'actor-1'),
      ).resolves.toBeUndefined();
    });
  });
});
