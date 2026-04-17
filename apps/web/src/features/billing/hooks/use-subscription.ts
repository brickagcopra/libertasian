'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient, ApiClientError } from '@/lib/api-client';
import type { SubscriptionDetail, SubscriptionResponse } from '../types';
import { TIER_ORDER } from '../types';

export type { SubscriptionDetail };

export function useSubscription() {
  return useQuery<SubscriptionDetail | null>({
    queryKey: ['billing', 'subscription'],
    queryFn: async () => {
      try {
        const res = await apiClient.get<SubscriptionResponse>('/billing/subscription');
        return res.data;
      } catch (err) {
        if (err instanceof ApiClientError && err.statusCode === 404) {
          return null;
        }
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false, // 404 is a valid empty state; no point retrying
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
