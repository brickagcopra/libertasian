import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { PLATFORM_PERMISSIONS_KEY } from '../decorators/platform-permissions.decorator';
import type { PermissionsMetadata } from '../decorators/permissions.decorator';
import { PermissionsService } from '../../modules/rbac/permissions.service';

/**
 * Authorize against permissions held on the PLATFORM organization.
 *
 * PermissionsGuard answers "may the caller do this in their current org?",
 * which is the right question for tenant surfaces and the wrong one for
 * platform administration. Every self-registered user owns a personal
 * workspace and holds `owner` on it, so a tenant-scoped `members:read` check
 * is satisfied by every account on the system. Conversely, a platform admin
 * whose oldest membership is a personal workspace — which is how login picks
 * the token org — would be refused their own staff console by a tenant-scoped
 * check.
 *
 * Resolution goes through PermissionsService.getPlatformPermissions, the same
 * path validateReviewerRole and isPlatformAdmin use, so hierarchy expansion,
 * expiry filtering and the rbac:perms cache all apply and the three can never
 * disagree about who is staff.
 *
 * Expected chain: @UseGuards(JwtAuthGuard, MfaGuard, PlatformPermissionsGuard).
 * TenantGuard is deliberately NOT required — these endpoints act on the
 * platform org by construction, never on the caller's token org.
 */
@Injectable()
export class PlatformPermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PlatformPermissionsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<PermissionsMetadata | undefined>(
      PLATFORM_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!meta || meta.permissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as { sub?: string } | undefined;

    if (!user?.sub) {
      throw new ForbiddenException('Authentication required');
    }

    const held = await this.permissionsService.getPlatformPermissions(user.sub);

    const allowed =
      meta.mode === 'any'
        ? meta.permissions.some((code) => held.includes(code))
        : meta.permissions.every((code) => held.includes(code));

    if (!allowed) {
      // No email, no permission list of the caller's — just what was needed.
      this.logger.debug(
        `Platform permission denied for user ${user.sub}: requires ${
          meta.mode === 'any' ? 'any of' : 'all of'
        } [${meta.permissions.join(', ')}]`,
      );
      throw new ForbiddenException(
        `Insufficient platform permissions. Required: ${meta.permissions.join(', ')}`,
      );
    }

    // Attach the resolved platform member so handlers do not re-query it.
    const platformMemberId = await this.permissionsService.resolvePlatformMemberId(
      user.sub,
    );
    (user as Record<string, unknown>)['platformMemberId'] = platformMemberId;

    return true;
  }
}
