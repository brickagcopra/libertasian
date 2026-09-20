import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { MyPermissions } from '@libertasian/types';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../common/guards';
import { PermissionsService } from '../permissions.service';

interface AuthUser {
  sub: string;
  organizationId?: string;
}

/**
 * Self-service access discovery — the Kubernetes SelfSubjectRulesReview
 * pattern.
 *
 * JwtAuthGuard ONLY, and deliberately no @RequiredPermissions: asking "what
 * can I do?" must never itself require a permission. The web client used to
 * answer this by calling GET /rbac/members (needs `members:read`) to find its
 * own member id, then GET /rbac/members/:id/permissions. Roles that
 * legitimately hold no `members:read` — reviewer, editor — got 403 on the
 * first hop, resolved to an empty permission array, and PermissionGate then
 * denied them every surface in the product.
 *
 * Two permission sets, kept separate rather than merged, because they answer
 * different questions (P2):
 *   - `permissions`        — what the caller may do in their CURRENT org.
 *   - `platformPermissions` — what the caller may do as platform STAFF.
 * Owning a personal workspace fills the first and contributes nothing to the
 * second.
 *
 * Read-only and self-scoped: it can only ever describe the caller, so there is
 * nothing here to leak. This is a discovery endpoint, not a gate — every
 * surface it lets the UI render still has a server-side guard, and that guard
 * is the real control (P3).
 */
@ApiTags('RBAC — Self')
@Controller('rbac/me')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SelfPermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get('permissions')
  @ApiOperation({
    summary: "Effective permissions for the authenticated caller (no permission required)",
  })
  async getMyPermissions(
    @CurrentUser() user: AuthUser,
  ): Promise<{ success: true; data: MyPermissions }> {
    const [permissions, platformPermissions] = await Promise.all([
      user.organizationId
        ? this.resolveOrgPermissions(user.sub, user.organizationId)
        : Promise.resolve<string[]>([]),
      this.permissionsService.getPlatformPermissions(user.sub),
    ]);

    return {
      success: true,
      data: {
        permissions,
        platformPermissions,
        // Derived from the resolved set rather than re-queried, so it can
        // never disagree with platformPermissions.
        platformMember:
          (await this.permissionsService.resolvePlatformMemberId(user.sub)) !==
          null,
        isPlatformAdmin: platformPermissions.some((code) =>
          code.startsWith('admin:'),
        ),
      },
    };
  }

  /**
   * Effective permissions in the caller's current org. A user with no active
   * membership there (revoked between token issuance and now) gets an empty
   * set rather than an error — the caller is asking what they can do, and the
   * answer is "nothing here".
   */
  private async resolveOrgPermissions(
    userId: string,
    organizationId: string,
  ): Promise<string[]> {
    const memberId = await this.permissionsService.resolveMemberId(
      userId,
      organizationId,
    );
    if (!memberId) return [];
    return this.permissionsService.getEffectivePermissions(memberId);
  }
}
