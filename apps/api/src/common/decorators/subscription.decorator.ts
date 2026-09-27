import { applyDecorators, SetMetadata } from '@nestjs/common';
import {
  SUBSCRIPTION_DENIAL_KEY,
  SUBSCRIPTION_KEY,
} from '../guards/subscription.guard';

export interface RequiredSubscriptionOptions {
  /**
   * Refuse a below-tier caller with 402 `subscription_required` instead of the
   * default 403. Opt-in, per route: only for surfaces the product has decided
   * are paid-only (Deep Research), where the client needs the machine-readable
   * code to render its paid-feature state. Every existing route keeps 403.
   */
  paymentRequired?: boolean;
}

/**
 * Decorator to specify the minimum subscription tier required for an endpoint.
 * Usage: @RequiredSubscription('pro')
 * Tiers: free < edu < pro < team < enterprise
 */
export const RequiredSubscription = (
  tier: string,
  options?: RequiredSubscriptionOptions,
) =>
  options?.paymentRequired
    ? applyDecorators(
        SetMetadata(SUBSCRIPTION_KEY, tier),
        SetMetadata(SUBSCRIPTION_DENIAL_KEY, 'payment_required'),
      )
    : SetMetadata(SUBSCRIPTION_KEY, tier);
