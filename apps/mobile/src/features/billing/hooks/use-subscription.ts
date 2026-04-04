import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { SubscriptionDetail, SubscriptionResponse } from '../types';
import { TIER_ORDER } from '../types';

export type { SubscriptionDetail };

export const subscriptionKeys = {
  all: ['billing'] as const,
  subscription: ['billing', 'subscription'] as const,
};

export function useSubscription(enabled = true) {
  return useQuery({
    queryKey: subscriptionKeys.subscription,
    queryFn: () =>
      apiClient.get<SubscriptionResponse>('/billing/subscription'),
    enabled,
    staleTime: 5 * 60 * 1000,
    select: (res) => res.data,
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
