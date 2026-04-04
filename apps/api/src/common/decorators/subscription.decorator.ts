import { SetMetadata } from '@nestjs/common';
import { SUBSCRIPTION_KEY } from '../guards/subscription.guard';

/**
 * Decorator to specify the minimum subscription tier required for an endpoint.
 * Usage: @RequiredSubscription('pro')
 * Tiers: free < edu < pro < team < enterprise
 */
export const RequiredSubscription = (tier: string) =>
  SetMetadata(SUBSCRIPTION_KEY, tier);
