'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { SubscriptionDetail, SubscriptionResponse } from '../types';
import { TIER_ORDER } from '../types';

export type { SubscriptionDetail };

export function useSubscription() {
  return useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: async () => {
      const res = await apiClient.get<SubscriptionResponse>('/billing/subscription');
      return res.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
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
