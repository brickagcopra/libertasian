import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../rbac/permissions.service';
import {
  PLATFORM_CAPABILITY_REFUSAL,
  findPlatformScopedCodes,
} from '../rbac/platform-scope';
import { CreateOrganizationDto, UpdateOrganizationDto, InviteMemberDto } from './dto';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    // RbacModule is @Global(), so this needs no change to OrganizationsModule.
    private readonly permissions: PermissionsService,
  ) {}

  // ---- Platform-capability containment ----

  /**
   * True when the SYSTEM role behind a legacy role slug confers platform
   * capability.
   *
   * The seeded `admin`, `editor` and `reviewer` roles mix workspace and
   * platform permissions — `admin` alone carries 13 `admin:*` codes — and
   * jwt.strategy derives isPlatformAdmin from the presence of any `admin:`
   * code in a caller's WORKSPACE permissions. Linking a member to one of them
   * through the legacy role string is therefore a platform-admin grant wearing
   * an org-membership costume.
   *
   * Resolved through PermissionsService so role_hierarchy inheritance counts,
   * exactly as in RolesService. Splitting those seeded roles into workspace and
   * platform halves is the proper fix; refusing them here needs no seed change,
   * no migration, and touches no existing row.
   */
  private async confersPlatformCapability(legacyRole: string): Promise<boolean> {
    const roleDef = await this.prisma.roleDefinition.findFirst({
      where: { slug: legacyRole, isSystem: true, organizationId: null },
      select: { id: true },
    });
    // No system role for this slug means the dual-write would no-op anyway.
    if (!roleDef) return false;

    const conferred = await this.permissions.resolvePermissionCodes([roleDef.id]);
    return findPlatformScopedCodes(conferred).length > 0;
  }

  /** Throwing form of {@link confersPlatformCapability}. */
  private async assertLegacyRoleConfersNoPlatformCapability(
    legacyRole: string,
    context: { organizationId?: string; actorUserId: string },
  ): Promise<void> {
    if (!(await this.confersPlatformCapability(legacyRole))) return;

    this.logger.warn(
      `Refused platform capability through a workspace membership: ` +
        `org=${context.organizationId ?? 'unknown'} ` +
        `actor=${context.actorUserId} role="${legacyRole}"`,
    );
    throw new ForbiddenException(PLATFORM_CAPABILITY_REFUSAL);
  }

  // ---- Organization CRUD ----

  async create(dto: CreateOrganizationDto, ownerUserId: string) {
    const slug = this.generateSlug(dto.name);

    const org = await this.prisma.organization.create({
      data: {
        name: dto.name.trim(),
        slug,
        type: dto.type ?? 'firm',
        billingOwnerUserId: ownerUserId,
      },
    });

    // Add creator as owner
    const ownerMember = await this.prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: ownerUserId,
        role: 'owner',
        status: 'active',
      },
    });

    // RBAC dual-write: assign owner role in new RBAC system
    await this.dualWriteCreateMemberRole(ownerMember.id, 'owner', ownerUserId);

    // Create free subscription for the new org
    await this.prisma.subscription.create({
      data: {
        organizationId: org.id,
        planCode: 'free',
        status: 'active',
        seats: 1,
        entitlementsJson: {},
      },
    });

    return org;
  }

  async findById(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        subscriptions: {
          where: { status: 'active' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: { select: { members: true } },
      },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    return org;
  }

  async findBySlug(slug: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    return org;
  }

  async update(id: string, dto: UpdateOrganizationDto, actorUserId: string) {
    await this.assertRole(id, actorUserId, ['owner', 'admin']);

    return this.prisma.organization.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
      },
    });
  }

  // ---- Member Management ----

  async listMembers(organizationId: string, cursor?: string, limit = 20) {
    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId },
      take: limit + 1,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            status: true,
          },
        },
      },
    });

    const hasNext = members.length > limit;
    const items = hasNext ? members.slice(0, limit) : members;
    const lastItem = items[items.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items: items.map((m) => ({
        id: m.id,
        userId: m.userId,
        role: m.role,
        status: m.status,
        createdAt: m.createdAt,
        user: m.user,
      })),
      meta: { hasNext, nextCursor },
    };
  }

  async inviteMember(
    organizationId: string,
    dto: InviteMemberDto,
    inviterUserId: string,
  ) {
    // Only owner/admin can invite
    await this.assertRole(organizationId, inviterUserId, ['owner', 'admin']);

    // BEFORE any write, so neither a legacy role='admin' member row nor a
    // pending_invites row carrying it is ever created. Without this, an owner
    // could invite a second email address they control as `admin` and the
    // dual-write would link it to the system admin role (13 admin:* codes),
    // setting isPlatformAdmin on that account.
    await this.assertLegacyRoleConfersNoPlatformCapability(dto.role, {
      organizationId,
      actorUserId: inviterUserId,
    });

    // Check seat limits
    await this.checkSeatLimit(organizationId);

    // Find or note the invited user
    const invitedUser = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });

    const email = dto.email.toLowerCase().trim();

    if (!invitedUser) {
      // User not registered — create a PendingInvite record
      // Check if there's already a pending invite for this email
      const existingInvite = await this.prisma.pendingInvite.findUnique({
        where: { organizationId_email: { organizationId, email } },
      });

      if (existingInvite && !existingInvite.acceptedAt) {
        throw new ConflictException('An invite has already been sent to this email');
      }

      // Generate a secure invite token
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7-day expiry

      const pendingInvite = await this.prisma.pendingInvite.create({
        data: {
          organizationId,
          email,
          role: dto.role,
          tokenHash,
          invitedBy: inviterUserId,
          expiresAt,
        },
      });

      // Send invite email with registration link
      const [org, inviter] = await Promise.all([
        this.prisma.organization.findUnique({ where: { id: organizationId } }),
        this.prisma.user.findUnique({ where: { id: inviterUserId } }),
      ]);

      // The raw token goes out in the email and is never persisted (only its
      // SHA-256 hash is). Without it the invitee has nothing to POST to
      // /auth/accept-invite and the pending invite can never be redeemed.
      // There is no name on file for an unregistered invitee — address them by
      // the email the inviter typed rather than by a placeholder.
      await this.notificationsService.sendMemberInviteEmail(
        email,
        email,
        org?.name ?? 'an organization',
        inviter?.fullName ?? 'A team member',
        dto.role,
        token,
      );

      this.logger.log(`Pending invite created for unregistered user: ${email.charAt(0)}***`);

      return { id: pendingInvite.id, pending: true, email };
    }

    // Check if already a member
    const existing = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: invitedUser.id,
        },
      },
    });

    if (existing) {
      throw new ConflictException('User is already a member of this organization');
    }

    const member = await this.prisma.organizationMember.create({
      data: {
        organizationId,
        userId: invitedUser.id,
        role: dto.role,
        status: 'active',
      },
    });

    // RBAC dual-write: assign role in new RBAC system
    await this.dualWriteCreateMemberRole(member.id, dto.role, inviterUserId);

    // Send notification email to invited user
    const [org, inviter] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: organizationId } }),
      this.prisma.user.findUnique({ where: { id: inviterUserId } }),
    ]);

    // A registered invitee is added to the organization directly above, so
    // there is no pending invite and no token to redeem — this email is a
    // notice, and its link goes to the members page rather than /accept-invite.
    await this.notificationsService.sendMemberInviteEmail(
      invitedUser.email,
      invitedUser.fullName ?? invitedUser.email,
      org?.name ?? 'an organization',
      inviter?.fullName ?? 'A team member',
      dto.role,
    );

    return member;
  }

  async updateMemberRole(
    organizationId: string,
    targetUserId: string,
    newRole: string,
    actorUserId: string,
  ) {
    await this.assertRole(organizationId, actorUserId, ['owner', 'admin']);

    // Prevent changing owner role (must use transfer ownership flow)
    if (newRole === 'owner') {
      throw new ForbiddenException('Cannot assign owner role. Use transfer ownership.');
    }

    // Before the update, so organization_members.role is left unchanged on
    // refusal. UpdateMemberRoleDto accepts 'admin', and the only guard below
    // (an admin may not promote to admin) does not apply to an owner — so this
    // is the step that turns an invited second account into a platform admin.
    await this.assertLegacyRoleConfersNoPlatformCapability(newRole, {
      organizationId,
      actorUserId: actorUserId,
    });

    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: targetUserId,
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Member not found');
    }

    // Cannot change the role of the owner
    if (membership.role === 'owner') {
      throw new ForbiddenException('Cannot change the owner role');
    }

    // Admin can only set roles below admin
    const actorMembership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: actorUserId,
        },
      },
    });

    if (actorMembership?.role === 'admin' && newRole === 'admin') {
      throw new ForbiddenException('Admins cannot promote other members to admin');
    }

    const updated = await this.prisma.organizationMember.update({
      where: { id: membership.id },
      data: { role: newRole },
    });

    // RBAC dual-write: replace system role in new RBAC system
    await this.dualWriteReplaceMemberRole(membership.id, newRole, actorUserId);

    return updated;
  }

  async removeMember(
    organizationId: string,
    targetUserId: string,
    actorUserId: string,
  ) {
    await this.assertRole(organizationId, actorUserId, ['owner', 'admin']);

    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: targetUserId,
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Member not found');
    }

    // Cannot remove the owner
    if (membership.role === 'owner') {
      throw new ForbiddenException('Cannot remove the organization owner');
    }

    // Admin cannot remove other admins
    if (membership.role === 'admin') {
      const actorMembership = await this.prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId: actorUserId,
          },
        },
      });
      if (actorMembership?.role !== 'owner') {
        throw new ForbiddenException('Only the owner can remove admins');
      }
    }

    await this.prisma.organizationMember.delete({
      where: { id: membership.id },
    });
  }

  // ---- Pending Invites ----

  /**
   * Read a pending invite by its RAW token, for the /accept-invite landing
   * page. Unauthenticated: the invitee has to see which organization and role
   * they are being offered — and, when they have no account yet, which email
   * to register with — BEFORE they can hold a JWT to POST /auth/accept-invite.
   *
   * The token is the bearer secret, so an unknown one is a 404 and nothing is
   * disclosed without it. `expired`/`accepted` are returned as state rather
   * than thrown so the page can explain them in plain language instead of
   * showing a generic error.
   */
  async getPendingInviteByToken(token: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const invite = await this.prisma.pendingInvite.findUnique({
      where: { tokenHash },
      include: { organization: { select: { name: true } } },
    });

    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    return {
      email: invite.email,
      role: invite.role,
      organizationName: invite.organization.name,
      expired: new Date() > invite.expiresAt,
      accepted: invite.acceptedAt !== null,
    };
  }

  /**
   * Accept a pending invite using the token.
   * Called after a user registers (or logs in) with the invited email.
   */
  async acceptInvite(token: string, userId: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const invite = await this.prisma.pendingInvite.findUnique({
      where: { tokenHash },
    });

    if (!invite) {
      throw new NotFoundException('Invite not found or already used');
    }

    if (invite.acceptedAt) {
      throw new BadRequestException('This invite has already been accepted');
    }

    if (new Date() > invite.expiresAt) {
      throw new BadRequestException('This invite has expired');
    }

    // Check if user is already a member
    const existing = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: invite.organizationId,
          userId,
        },
      },
    });

    if (existing) {
      // Mark invite as accepted even if already a member
      await this.prisma.pendingInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
      throw new ConflictException('You are already a member of this organization');
    }

    // A pending invite is a role decision made in the past. There are none
    // carrying a platform-scoped role on prod today, but an invite minted
    // before this guard existed must not be redeemable now. Checked before the
    // transaction so the membership is not created and the invite is not
    // consumed — it stays visible for an admin to revoke.
    await this.assertLegacyRoleConfersNoPlatformCapability(invite.role, {
      organizationId: invite.organizationId,
      actorUserId: userId,
    });

    // Add user to organization and mark invite as accepted
    const [member] = await this.prisma.$transaction([
      this.prisma.organizationMember.create({
        data: {
          organizationId: invite.organizationId,
          userId,
          role: invite.role,
          status: 'active',
        },
      }),
      this.prisma.pendingInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      }),
    ]);

    // RBAC dual-write: assign role in new RBAC system
    await this.dualWriteCreateMemberRole(member.id, invite.role, invite.invitedBy);

    this.logger.log(
      `Pending invite accepted: user ${userId} joined org ${invite.organizationId}`,
    );

    return member;
  }

  /**
   * Auto-accept any pending invites for a user's email.
   * Called during registration to automatically join organizations.
   */
  async acceptPendingInvitesForEmail(email: string, userId: string) {
    const pendingInvites = await this.prisma.pendingInvite.findMany({
      where: {
        email: email.toLowerCase().trim(),
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    const results: { organizationId: string; role: string }[] = [];

    for (const invite of pendingInvites) {
      try {
        // Skipped rather than thrown: this runs during registration, and one
        // bad legacy invite must not fail the signup. The invite is left
        // unaccepted and logged, so it can be revoked or re-issued.
        if (await this.confersPlatformCapability(invite.role)) {
          this.logger.warn(
            `Skipped auto-accepting invite ${invite.id}: role "${invite.role}" ` +
              'confers platform capability and cannot be granted through a workspace.',
          );
          continue;
        }

        const [member] = await this.prisma.$transaction([
          this.prisma.organizationMember.create({
            data: {
              organizationId: invite.organizationId,
              userId,
              role: invite.role,
              status: 'active',
            },
          }),
          this.prisma.pendingInvite.update({
            where: { id: invite.id },
            data: { acceptedAt: new Date() },
          }),
        ]);

        // RBAC dual-write: assign role in new RBAC system
        await this.dualWriteCreateMemberRole(member.id, invite.role, invite.invitedBy);

        results.push({
          organizationId: invite.organizationId,
          role: invite.role,
        });
      } catch (err) {
        this.logger.warn(
          `Failed to auto-accept invite ${invite.id}: ${(err as Error).message}`,
        );
      }
    }

    if (results.length > 0) {
      this.logger.log(
        `Auto-accepted ${results.length} pending invite(s) for user ${userId}`,
      );
    }

    return results;
  }

  async listPendingInvites(organizationId: string, actorUserId: string) {
    await this.assertRole(organizationId, actorUserId, ['owner', 'admin']);

    return this.prisma.pendingInvite.findMany({
      where: { organizationId, acceptedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        invitedBy: true,
        expiresAt: true,
        acceptedAt: true,
        createdAt: true,
      },
    });
  }

  // ---- User's Organizations ----

  async listUserOrganizations(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId, status: 'active' },
      include: {
        organization: {
          include: {
            subscriptions: {
              where: { status: 'active' },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
            _count: { select: { members: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      type: m.organization.type,
      role: m.role,
      memberCount: m.organization._count.members,
      subscription: m.organization.subscriptions[0] ?? null,
    }));
  }

  // ---- Authorization Helpers ----

  /**
   * Assert that the actor has one of the required roles in the organization.
   * Throws ForbiddenException if not.
   */
  async assertRole(
    organizationId: string,
    userId: string,
    requiredRoles: string[],
  ): Promise<void> {
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });

    if (!membership || membership.status !== 'active') {
      throw new ForbiddenException('Not a member of this organization');
    }

    if (!requiredRoles.includes(membership.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }

  /**
   * Check if organization has room for another member based on subscription seats.
   */
  private async checkSeatLimit(organizationId: string): Promise<void> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { organizationId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      throw new BadRequestException('No active subscription');
    }

    const currentMemberCount = await this.prisma.organizationMember.count({
      where: { organizationId, status: 'active' },
    });

    if (currentMemberCount >= subscription.seats) {
      throw new BadRequestException(
        `Organization has reached its seat limit (${subscription.seats}). Upgrade your plan to add more members.`,
      );
    }
  }

  // ---- RBAC Dual-Write Helpers ----

  /**
   * Create a MemberRole entry matching the legacy role.
   * Non-fatal: failures are logged but do not break the primary operation.
   */
  private async dualWriteCreateMemberRole(
    memberId: string,
    legacyRole: string,
    assignedByUserId: string,
  ): Promise<void> {
    // OUTSIDE the try ON PURPOSE. The catch below deliberately swallows
    // dual-write failures so an RBAC hiccup cannot break an invite; a refusal
    // to grant platform capability must not be swallowed the same way, or the
    // backstop silently becomes a log line. Callers validate up front too —
    // this is the chokepoint all four write paths funnel through, so it is the
    // one place a new caller cannot forget.
    await this.assertLegacyRoleConfersNoPlatformCapability(legacyRole, {
      actorUserId: assignedByUserId,
    });

    try {
      const roleDef = await this.prisma.roleDefinition.findFirst({
        where: { slug: legacyRole, isSystem: true, organizationId: null },
        select: { id: true },
      });

      if (!roleDef) {
        this.logger.warn(`RBAC dual-write: no system role found for slug "${legacyRole}"`);
        return;
      }

      await this.prisma.memberRole.upsert({
        where: {
          organizationMemberId_roleDefinitionId: {
            organizationMemberId: memberId,
            roleDefinitionId: roleDef.id,
          },
        },
        create: {
          organizationMemberId: memberId,
          roleDefinitionId: roleDef.id,
          assignedByUserId,
        },
        update: {},
      });
    } catch (err) {
      this.logger.error(
        `RBAC dual-write failed for member ${memberId}, role "${legacyRole}": ${(err as Error).message}`,
      );
    }
  }

  /**
   * Replace a member's system MemberRole when the legacy role changes.
   * Removes all system MemberRoles and assigns the new one.
   */
  private async dualWriteReplaceMemberRole(
    memberId: string,
    newLegacyRole: string,
    assignedByUserId: string,
  ): Promise<void> {
    // Outside the try, for the reason given in dualWriteCreateMemberRole.
    await this.assertLegacyRoleConfersNoPlatformCapability(newLegacyRole, {
      actorUserId: assignedByUserId,
    });

    try {
      const newRoleDef = await this.prisma.roleDefinition.findFirst({
        where: { slug: newLegacyRole, isSystem: true, organizationId: null },
        select: { id: true },
      });

      if (!newRoleDef) {
        this.logger.warn(`RBAC dual-write: no system role found for slug "${newLegacyRole}"`);
        return;
      }

      // Remove all existing system role assignments for this member
      const systemRoleIds = await this.prisma.roleDefinition.findMany({
        where: { isSystem: true, organizationId: null },
        select: { id: true },
      });
      const systemIds = systemRoleIds.map((r) => r.id);

      await this.prisma.memberRole.deleteMany({
        where: {
          organizationMemberId: memberId,
          roleDefinitionId: { in: systemIds },
        },
      });

      // Assign the new system role
      await this.prisma.memberRole.create({
        data: {
          organizationMemberId: memberId,
          roleDefinitionId: newRoleDef.id,
          assignedByUserId,
        },
      });
    } catch (err) {
      this.logger.error(
        `RBAC dual-write replace failed for member ${memberId}, role "${newLegacyRole}": ${(err as Error).message}`,
      );
    }
  }

  // ---- Helpers ----

  private generateSlug(name: string): string {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const suffix = crypto.randomBytes(4).toString('hex');
    return `${base}-${suffix}`;
  }
}
