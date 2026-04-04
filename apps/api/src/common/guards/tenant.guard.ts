import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';

/**
 * TenantGuard ensures that the authenticated user belongs to the organization
 * they are trying to access. Extracts organizationId from JWT claims — NEVER
 * from client-supplied params (per CLAUDE.md security standards).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as { organizationId?: string } | undefined;

    if (!user?.organizationId) {
      throw new ForbiddenException('No organization context');
    }

    // Attach tenant context for downstream use
    Object.assign(request, {
      tenantContext: { organizationId: user.organizationId },
    });

    return true;
  }
}
