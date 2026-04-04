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
  PERMISSIONS_KEY,
  type PermissionsMetadata,
} from '../decorators/permissions.decorator';
import { PermissionsService } from '../../modules/rbac/permissions.service';

/**
 * Guard that checks RBAC permissions via the new permission system.
 *
 * Resolves the current user's organization member ID from the JWT payload,
 * then checks whether the member's effective permissions satisfy the
 * requirement set by @RequiredPermissions().
 *
 * If no @RequiredPermissions() is set on the handler, the guard passes.
 *
 * Expected guard chain order (per CLAUDE.md):
 *   @UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard, SubscriptionGuard)
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Read @RequiredPermissions() metadata from handler or class
    const meta = this.reflector.getAllAndOverride<PermissionsMetadata | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No permissions required → pass
    if (!meta || meta.permissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as
      | { sub?: string; organizationId?: string; memberId?: string; isApiKey?: boolean; apiKeyPermissions?: string[] }
      | undefined;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    // API key requests: check apiKeyPermissions (already resolved by ApiKeyAuthGuard)
    if (user.isApiKey && user.apiKeyPermissions) {
      const hasPerm =
        meta.mode === 'any'
          ? meta.permissions.some((p) => user.apiKeyPermissions!.includes(p))
          : meta.permissions.every((p) => user.apiKeyPermissions!.includes(p));

      if (!hasPerm) {
        throw new ForbiddenException('API key lacks required permissions');
      }
      return true;
    }

    // User requests: resolve member ID
    const userId = user.sub;
    const organizationId = user.organizationId;

    if (!userId || !organizationId) {
      throw new ForbiddenException('Missing user or organization context');
    }

    // Use memberId if already attached (e.g. by TenantGuard), else resolve
    let memberId = user.memberId;
    if (!memberId) {
      const resolved = await this.permissionsService.resolveMemberId(userId, organizationId);
      if (!resolved) {
        throw new ForbiddenException('Not a member of this organization');
      }
      memberId = resolved;
      // Attach for downstream use
      (user as Record<string, unknown>)['memberId'] = memberId;
    }

    // Check permissions
    const hasPermission =
      meta.mode === 'any'
        ? await this.permissionsService.hasAnyPermission(memberId, meta.permissions)
        : await this.permissionsService.hasAllPermissions(memberId, meta.permissions);

    if (!hasPermission) {
      this.logger.debug(
        `Permission denied for member ${memberId}: requires ${meta.mode === 'any' ? 'any of' : 'all of'} [${meta.permissions.join(', ')}]`,
      );
      throw new ForbiddenException(
        `Insufficient permissions. Required: ${meta.permissions.join(', ')}`,
      );
    }

    return true;
  }
}
