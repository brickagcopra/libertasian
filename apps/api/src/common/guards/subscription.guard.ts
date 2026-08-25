import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { SubscriptionsService } from '../../modules/subscriptions/subscriptions.service';
import { isPaywallEnforced } from '../config/paywall';
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
    @Inject(ConfigService)
    private readonly configService: ConfigService,
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
      throw new ForbiddenException("This isn't available on this account.");
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

    // PAYWALL_ENFORCED=false — nothing is purchasable, so gating on the org's
    // real tier only produces errors the user has no way to clear. Every
    // caller is compared as 'pro', which opens the @RequiredSubscription('edu')
    // and ('pro') routes (study, uploads, bookmarks, workspaces) while leaving
    // 'team' (audit logs, org seats) and 'enterprise' (api-keys, external-api)
    // closed — those are staff/developer surfaces, not paid consumer features.
    // Roles, Tenant and MFA guards are untouched.
    const currentTier = isPaywallEnforced(this.configService)
      ? await this.subscriptionsService.getPlanCode(user.organizationId)
      : 'pro';

    if (!SubscriptionsService.meetsMinimumTier(currentTier, requiredTier)) {
      // Deliberately names no tier, no price and no purchase action: App
      // Review 3.1.1/2.1(b) treat any of those in a client-visible string as
      // an offer to purchase outside IAP, and the mobile client surfaces this
      // body verbatim on some paths.
      throw new ForbiddenException("This isn't available on this account.");
    }

    return true;
  }
}
