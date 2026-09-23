import { ForbiddenException } from '@nestjs/common';

import { MemberRoleSyncService } from './member-role-sync.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { PLATFORM_CAPABILITY_REFUSAL } from './platform-scope';

/**
 * The third escalation path, closed alongside the two in
 * no-platform-capability-via-workspace-role.spec.ts.
 *
 * The legacy-role mirror writes member_roles directly — MemberRoleSyncService
 * since the registration dual-write extracted it out of OrganizationsService —
 * bypassing RolesService entirely, so the gates added there do not see it. Both
 * InviteMemberDto and UpdateMemberRoleDto accept 'admin', 'editor' and
 * 'reviewer', and these endpoints require only owner/admin of the org, which
 * every workspace owner is.
 *
 * The attack: invite a second email address you control as `admin` (or invite
 * as `member`, then PATCH the role to `admin`). The dual-write links that
 * membership to the system admin role — 13 admin:* codes — and jwt.strategy
 * sets isPlatformAdmin from the presence of any admin: code.
 *
 * Containment is code-only: no seed change, no migration, no existing row
 * touched. The proper fix is splitting the seeded admin/editor/reviewer roles
 * into workspace and platform halves.
 */
describe('legacy org membership can never confer platform capability', () => {
  /** What the seeded system `admin` role actually carries, in miniature. */
  const SYSTEM_ADMIN_CODES = ['documents:read', 'admin:dashboard', 'admin:users'];
  const MEMBER_CODES = ['documents:read', 'notes:read'];
  /**
   * What the system `owner` role carries post-strip: every workspace code and
   * no platform code. This is what registration mirrors.
   */
  const OWNER_CODES = [
    ...MEMBER_CODES,
    'members:update-role',
    'roles:create',
    'roles:update',
    'digests:read',
    'digests:approve',
    'billing:manage',
  ];

  const orgId = 'org-1';
  const ownerUserId = 'owner-user-1';
  const targetUserId = 'target-user-1';
  const inviteId = 'invite-1';

  let prisma: any;
  let notifications: any;
  let permissions: any;
  let memberRoleSync: any;
  let service: OrganizationsService;
  /** The real mirror, for the chokepoint tests at the bottom. */
  let realSync: MemberRoleSyncService;
  /** organization_members rows, keyed by userId. */
  let memberships: Record<string, unknown>;

  /**
   * @param conferred what the system role behind the legacy slug confers
   * @param systemRoleExists whether a system role row is found for the slug
   */
  function build(conferred: string[], systemRoleExists = true) {
    memberships = {};
    prisma = {
      organization: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ id: orgId, name: 'Acme' }),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      organizationMember: {
        create: jest.fn(),
        // assertRole, the updateMemberRole target lookup and the acceptInvite
        // "already a member" check all hit findUnique with the compound key,
        // so this resolves per-user rather than per-call-order.
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve(
            memberships[where?.organizationId_userId?.userId] ?? null,
          ),
        ),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({ seats: 10, status: 'active' }),
      },
      pendingInvite: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      user: { findUnique: jest.fn(), findMany: jest.fn() },
      roleDefinition: {
        findFirst: jest
          .fn()
          .mockResolvedValue(systemRoleExists ? { id: 'system-role-1' } : null),
      },
      memberRole: {
        upsert: jest.fn(),
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
      roleHierarchy: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };
    notifications = { sendMemberInviteEmail: jest.fn() };
    permissions = {
      resolvePermissionCodes: jest.fn().mockResolvedValue(conferred),
    };
    // Stubbed for the OrganizationsService cases: those assert the UP-FRONT
    // refusal, i.e. that the mirror is never even reached.
    memberRoleSync = {
      linkSystemRole: jest.fn().mockResolvedValue(undefined),
      replaceSystemRole: jest.fn().mockResolvedValue(undefined),
    };
    service = new OrganizationsService(
      prisma as never,
      notifications as never,
      memberRoleSync as never,
      permissions as never,
    );
    // The real thing, for the chokepoint cases: the backstop that catches a
    // caller which skipped the up-front check — registration reaches it from
    // the auth module, past OrganizationsService entirely.
    realSync = new MemberRoleSyncService(
      prisma as never,
      { invalidateForMember: jest.fn().mockResolvedValue(undefined) } as never,
      permissions as never,
    );
  }

  /** Makes assertRole(['owner','admin']) pass for ownerUserId. */
  function stubActorIsOwner() {
    memberships[ownerUserId] = {
      id: 'owner-member-1',
      organizationId: orgId,
      userId: ownerUserId,
      role: 'owner',
      status: 'active',
    };
  }

  /** The member whose role updateMemberRole is asked to change. */
  function stubTargetMember(role: string) {
    memberships[targetUserId] = {
      id: 'target-member-1',
      organizationId: orgId,
      userId: targetUserId,
      role,
      status: 'active',
    };
  }

  // -------------------------------------------------------------------------
  // Positive control
  // -------------------------------------------------------------------------

  describe('positive control', () => {
    /**
     * Guards every refusal below. If the guard stopped resolving the system
     * role, `roleDefinition.findFirst` would go uncalled and
     * `resolvePermissionCodes` would never run — yet a test asserting only
     * `rejects.toThrow(ForbiddenException)` could still pass off some unrelated
     * failure (an unstubbed mock returning undefined, a seat-limit throw).
     * Asserting the resolver ran, with the system role id, is what makes a
     * refusal mean the guard refused.
     */
    it('resolves the system role behind the legacy slug before refusing', async () => {
      build(SYSTEM_ADMIN_CODES);
      stubActorIsOwner();

      await expect(
        service.inviteMember(
          orgId,
          { email: 'alt@example.com', role: 'admin' } as never,
          ownerUserId,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.roleDefinition.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { slug: 'admin', isSystem: true, organizationId: null },
        }),
      );
      expect(permissions.resolvePermissionCodes).toHaveBeenCalledWith([
        'system-role-1',
      ]);
    });

    it('refuses with the exact message, not merely with some error', async () => {
      build(SYSTEM_ADMIN_CODES);
      stubActorIsOwner();

      await expect(
        service.inviteMember(
          orgId,
          { email: 'alt@example.com', role: 'admin' } as never,
          ownerUserId,
        ),
      ).rejects.toThrow(PLATFORM_CAPABILITY_REFUSAL);
    });
  });

  // -------------------------------------------------------------------------
  // inviteMember
  // -------------------------------------------------------------------------

  describe('inviteMember', () => {
    it.each(['admin', 'editor', 'reviewer'])(
      'refuses an invite with role %s, writing nothing',
      async (role) => {
        build(SYSTEM_ADMIN_CODES);
        stubActorIsOwner();

        await expect(
          service.inviteMember(
            orgId,
            { email: 'alt@example.com', role } as never,
            ownerUserId,
          ),
        ).rejects.toThrow(PLATFORM_CAPABILITY_REFUSAL);

        // The whole point of validating up front: no pending invite, no
        // membership, no email.
        expect(prisma.pendingInvite.create).not.toHaveBeenCalled();
        expect(prisma.organizationMember.create).not.toHaveBeenCalled();
        expect(memberRoleSync.linkSystemRole).not.toHaveBeenCalled();
        expect(notifications.sendMemberInviteEmail).not.toHaveBeenCalled();
      },
    );

    it.each(['member', 'student'])(
      'still allows an invite with role %s',
      async (role) => {
        build(MEMBER_CODES);
        stubActorIsOwner();
        // Unregistered invitee → the pending-invite branch.
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.pendingInvite.findUnique.mockResolvedValue(null);
        prisma.pendingInvite.create.mockResolvedValue({
          id: inviteId,
          email: 'alt@example.com',
        });

        const result = await service.inviteMember(
          orgId,
          { email: 'alt@example.com', role } as never,
          ownerUserId,
        );

        expect(result).toMatchObject({ pending: true });
        expect(prisma.pendingInvite.create).toHaveBeenCalled();
      },
    );
  });

  // -------------------------------------------------------------------------
  // updateMemberRole
  // -------------------------------------------------------------------------

  describe('updateMemberRole', () => {
    it('refuses promoting a member to admin, leaving the legacy role unchanged', async () => {
      build(SYSTEM_ADMIN_CODES);
      stubActorIsOwner();
      stubTargetMember('member');

      await expect(
        service.updateMemberRole(orgId, targetUserId, 'admin', ownerUserId),
      ).rejects.toThrow(PLATFORM_CAPABILITY_REFUSAL);

      expect(prisma.organizationMember.update).not.toHaveBeenCalled();
      expect(memberRoleSync.replaceSystemRole).not.toHaveBeenCalled();
    });

    it('still allows demoting to member', async () => {
      build(MEMBER_CODES);
      stubActorIsOwner();
      stubTargetMember('editor');
      prisma.organizationMember.update.mockResolvedValue({
        id: 'target-member-1',
        role: 'member',
      });
      prisma.roleDefinition.findMany = jest.fn().mockResolvedValue([]);

      const result = await service.updateMemberRole(
        orgId,
        targetUserId,
        'member',
        ownerUserId,
      );

      expect(result).toMatchObject({ role: 'member' });
      expect(prisma.organizationMember.update).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // acceptInvite
  // -------------------------------------------------------------------------

  describe('acceptInvite', () => {
    /** A pending invite minted before this guard existed. */
    function stubPendingInvite(role: string) {
      prisma.pendingInvite.findUnique.mockResolvedValue({
        id: inviteId,
        organizationId: orgId,
        email: 'alt@example.com',
        role,
        invitedBy: ownerUserId,
        acceptedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      // `memberships` is empty, so the "already a member" check finds nothing.
    }

    it('refuses to redeem a pre-existing editor invite', async () => {
      build(SYSTEM_ADMIN_CODES);
      stubPendingInvite('editor');

      await expect(
        service.acceptInvite('raw-token', targetUserId),
      ).rejects.toThrow(PLATFORM_CAPABILITY_REFUSAL);

      // Neither consumed nor half-applied: the invite stays visible to revoke.
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.pendingInvite.update).not.toHaveBeenCalled();
    });

    it('still redeems a member invite', async () => {
      build(MEMBER_CODES);
      stubPendingInvite('member');
      prisma.$transaction.mockResolvedValue([
        { id: 'new-member-1', role: 'member' },
        {},
      ]);

      await expect(
        service.acceptInvite('raw-token', targetUserId),
      ).resolves.toMatchObject({ id: 'new-member-1' });
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // acceptPendingInvitesForEmail (registration path)
  // -------------------------------------------------------------------------

  describe('acceptPendingInvitesForEmail', () => {
    it('skips a platform-scoped invite instead of failing registration', async () => {
      build(SYSTEM_ADMIN_CODES);
      prisma.pendingInvite.findMany.mockResolvedValue([
        {
          id: inviteId,
          organizationId: orgId,
          role: 'admin',
          invitedBy: ownerUserId,
        },
      ]);

      // Resolves rather than throwing — a bad legacy invite must not break
      // signup — and creates nothing.
      await expect(
        service.acceptPendingInvitesForEmail('alt@example.com', targetUserId),
      ).resolves.toEqual([]);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('still auto-accepts a member invite', async () => {
      build(MEMBER_CODES);
      prisma.pendingInvite.findMany.mockResolvedValue([
        {
          id: inviteId,
          organizationId: orgId,
          role: 'member',
          invitedBy: ownerUserId,
        },
      ]);
      prisma.$transaction.mockResolvedValue([
        { id: 'new-member-1', role: 'member' },
        {},
      ]);

      await expect(
        service.acceptPendingInvitesForEmail('alt@example.com', targetUserId),
      ).resolves.toEqual([{ organizationId: orgId, role: 'member' }]);
    });
  });

  // -------------------------------------------------------------------------
  // The chokepoint itself — MemberRoleSyncService
  // -------------------------------------------------------------------------

  describe('dual-write chokepoint', () => {
    /**
     * The mirror wraps its work in a try/catch that deliberately swallows
     * failures, so registration cannot fail over a mirrored row. The
     * platform-capability refusal is raised OUTSIDE that try on purpose — if it
     * were inside, the backstop would silently degrade into a log line while
     * the caller reported success.
     *
     * This matters more after the extraction than before it: linkSystemRole is
     * now reachable from the auth module, which never passes through
     * OrganizationsService's up-front checks.
     */
    it('escapes the catch that swallows mirror failures', async () => {
      build(SYSTEM_ADMIN_CODES);

      await expect(
        realSync.linkSystemRole('member-1', 'admin', ownerUserId),
      ).rejects.toThrow(PLATFORM_CAPABILITY_REFUSAL);

      expect(prisma.memberRole.upsert).not.toHaveBeenCalled();
    });

    it('escapes the same catch on the replace path', async () => {
      build(SYSTEM_ADMIN_CODES);

      await expect(
        realSync.replaceSystemRole('member-1', 'admin', ownerUserId),
      ).rejects.toThrow(PLATFORM_CAPABILITY_REFUSAL);

      expect(prisma.memberRole.deleteMany).not.toHaveBeenCalled();
      expect(prisma.memberRole.create).not.toHaveBeenCalled();
    });

    it('still writes for a role conferring only workspace codes', async () => {
      build(MEMBER_CODES);

      await realSync.linkSystemRole('member-1', 'member', ownerUserId);

      expect(prisma.memberRole.upsert).toHaveBeenCalled();
    });

    it('passes when no system role exists for the slug', async () => {
      // Nothing to confer, so nothing to refuse — the mirror no-ops.
      build(SYSTEM_ADMIN_CODES, false);

      await realSync.linkSystemRole('member-1', 'admin', ownerUserId);

      expect(permissions.resolvePermissionCodes).not.toHaveBeenCalled();
      expect(prisma.memberRole.upsert).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Registration is unaffected
  // -------------------------------------------------------------------------

  describe('registration', () => {
    /**
     * Both registration paths (register and the social-signup path) call
     * linkSystemRole with the LITERAL string 'owner'. The system owner role was
     * stripped of platform codes in 20260702120000_strip_owner_platform_admin,
     * so the guard added in #501 must be inert for it — a signup that 403s on
     * its own workspace role would be a total outage of registration.
     *
     * Asserted against the real MemberRoleSyncService with the real owner code
     * set, not a stub, so this fails if the predicate ever widens to catch a
     * code that owner legitimately holds.
     */
    it('mirrors the owner role at signup without tripping the guard', async () => {
      build(OWNER_CODES);

      await expect(
        realSync.linkSystemRole('owner-member-1', 'owner', ownerUserId),
      ).resolves.toBeUndefined();

      expect(permissions.resolvePermissionCodes).toHaveBeenCalled();
      expect(prisma.memberRole.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            organizationMemberId: 'owner-member-1',
            roleDefinitionId: 'system-role-1',
          }),
        }),
      );
    });

    it('mirrors owner even with no actor id (social signup)', async () => {
      build(OWNER_CODES);

      await expect(
        realSync.linkSystemRole('owner-member-1', 'owner'),
      ).resolves.toBeUndefined();
      expect(prisma.memberRole.upsert).toHaveBeenCalled();
    });

    it('confirms no platform-scoped code is in the owner set', () => {
      // The reason the two cases above pass. If owner ever regains one of
      // these, registration breaks loudly here rather than in production.
      expect(
        OWNER_CODES.filter(
          (c) =>
            c.startsWith('admin:') ||
            c.startsWith('platform-') ||
            c === 'digests:review',
        ),
      ).toEqual([]);
    });
  });
});
