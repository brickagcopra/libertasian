import { ForbiddenException, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from './permissions.service';
import {
  PLATFORM_CAPABILITY_REFUSAL,
  findPlatformScopedCodes,
} from './platform-scope';
import { RbacCacheService } from './rbac-cache.service';

/**
 * Keeps `member_roles` in step with the legacy `organization_members.role`
 * string column.
 *
 * Authorization reads `member_roles` only — `PermissionsService` and the
 * `isPlatformAdmin` derivation never look at the legacy column. A membership
 * with `role='owner'` and no `member_roles` row therefore resolves to ZERO
 * permissions. Registration wrote only the legacy column, so every signup
 * since migration 20260611120000 backfilled the then-existing memberships has
 * had an empty permission set.
 *
 * This is the single implementation of that link. It lived privately on
 * OrganizationsService and was unavailable to the auth module, which is how
 * registration came to skip it.
 *
 * Non-fatal by contract: a failure here is logged and swallowed. Registration
 * and invite acceptance must not fail because a role row could not be mirrored.
 *
 * WITH ONE EXCEPTION. The seeded `admin`, `editor` and `reviewer` roles mix
 * workspace and platform permissions, and `isPlatformAdmin` is derived from the
 * presence of any `admin:` code in a caller's workspace permissions — so
 * linking a membership to one of them is a platform-admin grant. This service
 * refuses that, and the refusal is raised OUTSIDE the swallowing try/catch on
 * purpose: swallowed, the backstop would degrade into a log line while the
 * caller reported success. See e238b23 (#501), which added the same guard to
 * these two methods while they still lived on OrganizationsService.
 *
 * This is the chokepoint every legacy-role write funnels through — including
 * registration, which reaches it from the auth module and therefore past the
 * up-front checks in OrganizationsService. It is the one place a new caller
 * cannot forget.
 */
@Injectable()
export class MemberRoleSyncService {
  private readonly logger = new Logger(MemberRoleSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: RbacCacheService,
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * Refuse a legacy role slug whose system role confers platform capability.
   *
   * Resolved through PermissionsService so `role_hierarchy` inheritance counts,
   * exactly as in RolesService. A slug with no system role confers nothing —
   * the link below would no-op anyway — so it passes.
   */
  private async assertConfersNoPlatformCapability(
    legacyRole: string,
    memberId: string,
  ): Promise<void> {
    const roleDef = await this.prisma.roleDefinition.findFirst({
      where: { slug: legacyRole, isSystem: true, organizationId: null },
      select: { id: true },
    });
    if (!roleDef) return;

    const conferred = await this.permissions.resolvePermissionCodes([
      roleDef.id,
    ]);
    const platformCodes = findPlatformScopedCodes(conferred);
    if (platformCodes.length === 0) return;

    this.logger.warn(
      `Refused platform capability through a workspace membership: ` +
        `member=${memberId} role="${legacyRole}" codes=${platformCodes.join(',')}`,
    );
    throw new ForbiddenException(PLATFORM_CAPABILITY_REFUSAL);
  }

  /**
   * Link a membership to the SYSTEM role definition matching the legacy role
   * it already carries (`slug = legacyRole`, `is_system = true`,
   * `organization_id IS NULL`). Idempotent.
   *
   * `legacyRole` is the value just written to `organization_members.role`, not
   * a decision about what the caller may do — the authorization decision is
   * made later, from the permissions this role resolves to.
   */
  async linkSystemRole(
    memberId: string,
    legacyRole: string,
    assignedByUserId?: string,
  ): Promise<void> {
    // Outside the try, deliberately — see the note on this class.
    await this.assertConfersNoPlatformCapability(legacyRole, memberId);

    try {
      const roleDef = await this.prisma.roleDefinition.findFirst({
        where: { slug: legacyRole, isSystem: true, organizationId: null },
        select: { id: true },
      });

      if (!roleDef) {
        this.logger.warn(
          `RBAC dual-write: no system role found for slug "${legacyRole}"`,
        );
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
          ...(assignedByUserId ? { assignedByUserId } : {}),
        },
        update: {},
      });

      await this.cache.invalidateForMember(memberId);
    } catch (err) {
      this.logger.error(
        `RBAC dual-write failed for member ${memberId}, role "${legacyRole}": ${(err as Error).message}`,
      );
    }
  }

  /**
   * Replace a member's system role when the legacy role changes: drop every
   * system role they hold, then link the new one.
   *
   * Only SYSTEM roles are removed — an org-custom role assigned deliberately
   * through the RBAC panel is not collateral damage of a legacy role change.
   */
  async replaceSystemRole(
    memberId: string,
    newLegacyRole: string,
    assignedByUserId: string,
  ): Promise<void> {
    // Outside the try, deliberately — see the note on this class.
    await this.assertConfersNoPlatformCapability(newLegacyRole, memberId);

    try {
      const newRoleDef = await this.prisma.roleDefinition.findFirst({
        where: { slug: newLegacyRole, isSystem: true, organizationId: null },
        select: { id: true },
      });

      if (!newRoleDef) {
        this.logger.warn(
          `RBAC dual-write: no system role found for slug "${newLegacyRole}"`,
        );
        return;
      }

      const systemRoles = await this.prisma.roleDefinition.findMany({
        where: { isSystem: true, organizationId: null },
        select: { id: true },
      });

      await this.prisma.memberRole.deleteMany({
        where: {
          organizationMemberId: memberId,
          roleDefinitionId: { in: systemRoles.map((r) => r.id) },
        },
      });

      await this.prisma.memberRole.create({
        data: {
          organizationMemberId: memberId,
          roleDefinitionId: newRoleDef.id,
          assignedByUserId,
        },
      });

      await this.cache.invalidateForMember(memberId);
    } catch (err) {
      this.logger.error(
        `RBAC dual-write replace failed for member ${memberId}, role "${newLegacyRole}": ${(err as Error).message}`,
      );
    }
  }
}
