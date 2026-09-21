import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../common/guards';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { PermissionsService } from '../permissions.service';
import { PlatformGrantsService } from '../platform-grants.service';

interface AuthUser {
  sub: string;
  organizationId?: string;
}

/**
 * "What can I do?" — for the caller, about the caller.
 *
 * JwtAuthGuard only, and deliberately NO @RequiredPermissions: any
 * authenticated user may read their own permissions. Requiring a permission
 * to read your permissions is circular, and the circle had teeth — the web
 * client used to resolve its own permissions by calling GET /rbac/members
 * first, which needs `members:read`. A reviewer or editor holds no such
 * permission, so the lookup 403'd, the hook returned [], and PermissionGate
 * then hid every control from exactly the staff it was meant to reveal them
 * to.
 */
@ApiTags('RBAC — Self')
@Controller('rbac/me')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SelfPermissionsController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly platformGrants: PlatformGrantsService,
  ) {}

  @Get('permissions')
  @ApiOperation({
    summary: 'Effective permissions for the current user',
    description:
      'tenantPermissions come from the caller’s membership in their JWT organization; platformPermissions come from platform_role_grants, which have no organization at all.',
  })
  async myPermissions(@CurrentUser() user: AuthUser) {
    const [tenantPermissions, platformPermissions] = await Promise.all([
      this.resolveTenantPermissions(user),
      this.platformGrants.getPlatformPermissions(user.sub),
    ]);

    return {
      success: true,
      data: {
        tenantPermissions,
        platformPermissions,
        isPlatformStaff: platformPermissions.length > 0,
      },
    };
  }

  /**
   * Tenant permissions for the caller's JWT organization. A user with no
   * active membership there simply has none — that is not an error, and must
   * not stop platform permissions from being returned.
   */
  private async resolveTenantPermissions(user: AuthUser): Promise<string[]> {
    if (!user.organizationId) return [];
    const memberId = await this.permissions.resolveMemberId(
      user.sub,
      user.organizationId,
    );
    if (!memberId) return [];
    return this.permissions.getEffectivePermissions(memberId);
  }
}
