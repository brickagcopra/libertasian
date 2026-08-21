import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { SubscriptionDetail } from '../types';

/**
 * Tier ordering for the client-side entitlement gate. Module-private and NOT
 * exported: these codes are gate inputs, never display strings. Exporting
 * them is how "Pro" reached the UI and drew App Review 2.1(b) — the app names
 * no purchasable tier anywhere a user can see.
 */
const TIER_ORDER = ['free', 'edu', 'pro', 'team', 'enterprise'];

export type { SubscriptionDetail };

export const subscriptionKeys = {
  all: ['billing'] as const,
  subscription: ['billing', 'subscription'] as const,
};

export function useSubscription(enabled = true) {
  return useQuery({
    queryKey: subscriptionKeys.subscription,
    // apiClient strips the { success, data } envelope at the transport
    // layer, so the resolved value IS the SubscriptionDetail. The previous
    // `select: (res) => res.data` drilled one level too deep and made
    // `data` resolve to undefined for every consumer.
    queryFn: () => apiClient.get<SubscriptionDetail>('/billing/subscription'),
    enabled,
    staleTime: 5 * 60 * 1000,
    // A 404 (no active subscription = free tier) is deterministic — retrying
    // only delays the paywall lock for free users.
    retry: false,
  });
}

export function meetsMinimumTier(
  currentPlan: string | undefined,
  requiredTier: string,
): boolean {
  if (!currentPlan) return false;
  const currentIdx = TIER_ORDER.indexOf(currentPlan);
  const requiredIdx = TIER_ORDER.indexOf(requiredTier);
  if (currentIdx === -1 || requiredIdx === -1) return false;
  return currentIdx >= requiredIdx;
}

export function useCanGenerateDigest(): boolean {
  const { data } = useSubscription();
  if (!data) return false;
  const plan = data.planCode;
  return plan === 'edu' || plan === 'pro' || plan === 'team' || plan === 'enterprise';
}
