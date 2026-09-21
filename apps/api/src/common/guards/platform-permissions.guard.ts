import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import {
  PLATFORM_PERMISSIONS_KEY,
  type PlatformPermissionsMetadata,
} from '../decorators/platform-permissions.decorator';
import { PlatformGrantsService } from '../../modules/rbac/platform-grants.service';

/**
 * Guard for PLATFORM capability — permissions granted to a PERSON, with no
 * organization involved.
 *
 * Resolves entirely from `user.sub`. It must never read `organizationId`:
 * login picks a user's oldest membership and there is no org-switch endpoint,
 * so a staff member's JWT organization is permanently their personal
 * workspace and would tell this guard nothing.
 *
 * CRITICAL: this guard must NEVER write `user.memberId`. PermissionsGuard
 * attaches the resolved organization_members id there and tenant-scoped code
 * downstream writes rows against it. Pointing that key at anything resolved
 * from a platform grant would send tenant writes to the wrong organization —
 * a data-integrity bug, not a 403.
 *
 * Attach only to platform controllers, alongside JwtAuthGuard:
 *   @UseGuards(JwtAuthGuard, PlatformPermissionsGuard)
 */
@Injectable()
export class PlatformPermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PlatformPermissionsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly platformGrants: PlatformGrantsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<
      PlatformPermissionsMetadata | undefined
    >(PLATFORM_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    // No platform permissions required → pass.
    if (!meta || meta.permissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as { sub?: string } | undefined;

    if (!user?.sub) {
      throw new ForbiddenException('Authentication required');
    }

    const granted =
      meta.mode === 'any'
        ? await this.platformGrants.hasAnyPlatformPermission(
            user.sub,
            meta.permissions,
          )
        : await this.platformGrants.hasAllPlatformPermissions(
            user.sub,
            meta.permissions,
          );

    if (!granted) {
      this.logger.debug(
        `Platform permission denied for user ${user.sub}: requires ${meta.mode === 'any' ? 'any of' : 'all of'} [${meta.permissions.join(', ')}]`,
      );
      throw new ForbiddenException(
        `Insufficient platform permissions. Required: ${meta.permissions.join(', ')}. Platform capability is granted per person in Admin → Staff; an organization role cannot satisfy it.`,
      );
    }

    return true;
  }
}
