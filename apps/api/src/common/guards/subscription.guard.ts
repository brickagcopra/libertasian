import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { SubscriptionsService } from '../../modules/subscriptions/subscriptions.service';
import { AdminBypassAuditService } from '../services/admin-bypass-audit.service';

export const SUBSCRIPTION_KEY = 'subscription_tier';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(SubscriptionsService)
    private readonly subscriptionsService: SubscriptionsService,
    @Inject(AdminBypassAuditService)
    private readonly adminBypassAudit: AdminBypassAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredTier = this.reflector.getAllAndOverride<string | undefined>(
      SUBSCRIPTION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredTier) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as
      | { sub?: string; organizationId?: string; isPlatformAdmin?: boolean }
      | undefined;

    if (!user?.organizationId) {
      throw new ForbiddenException('Active subscription required');
    }

    // Platform admins (anyone holding any `admin:*` permission) bypass
    // subscription-tier gates entirely. This is the read-only "admins can
    // always reach the corpus" rule from CLAUDE.md. Org-scoped
    // admin_override (entitlement.service.ts) is unrelated and still applies.
    if (user.isPlatformAdmin === true) {
      this.logger.debug(
        `Platform admin bypass: user=${user.sub} tier=${requiredTier} route=${request.method} ${request.path}`,
      );
      this.adminBypassAudit.record({
        userId: user.sub,
        organizationId: user.organizationId,
        route: `${request.method} ${request.path}`,
      });
      return true;
    }

    const currentTier = await this.subscriptionsService.getPlanCode(
      user.organizationId,
    );

    if (!SubscriptionsService.meetsMinimumTier(currentTier, requiredTier)) {
      throw new ForbiddenException(
        `This feature requires a ${requiredTier} subscription or higher. Current plan: ${currentTier}.`,
      );
    }

    return true;
  }
}
