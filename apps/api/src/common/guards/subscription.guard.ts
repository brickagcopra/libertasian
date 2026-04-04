import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { SubscriptionsService } from '../../modules/subscriptions/subscriptions.service';

export const SUBSCRIPTION_KEY = 'subscription_tier';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(SubscriptionsService)
    private readonly subscriptionsService: SubscriptionsService,
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
    const user = request.user as { organizationId?: string } | undefined;

    if (!user?.organizationId) {
      throw new ForbiddenException('Active subscription required');
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
