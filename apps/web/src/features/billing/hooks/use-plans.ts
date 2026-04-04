'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  PlansListResponse,
  PlanDetail,
  ActivePromotionsResponse,
  ActivePromotionForPricing,
} from '../types';
import { PLANS, planDetailToPlanInfo } from '../types';
import type { PlanInfo } from '../types';

// ─── Query Keys ───────────────────────────────────────────

export const planKeys = {
  all: ['plans'] as const,
  visible: ['plans', 'visible'] as const,
  promotions: ['plans', 'promotions', 'active'] as const,
};

// ─── Plans Hook (Public, No Auth) ─────────────────────────

/**
 * Fetches visible plans from the public GET /plans endpoint.
 * Returns DB-driven plans with prices and entitlements.
 * Falls back to hardcoded PLANS if the API is unavailable.
 */
export function usePlans() {
  return useQuery({
    queryKey: planKeys.visible,
    queryFn: async (): Promise<PlanDetail[]> => {
      const res = await apiClient.get<PlansListResponse>('/plans');
      return res.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes — matches backend Redis cache
    gcTime: 10 * 60 * 1000,
    retry: 2,
  });
}

/**
 * Returns PlanInfo[] — API-driven if available, falls back to hardcoded PLANS.
 * Use this for components that still need the PlanInfo shape (e.g., billing settings).
 */
export function usePlanInfoList(): {
  plans: PlanInfo[];
  isLoading: boolean;
  isFromApi: boolean;
} {
  const { data: apiPlans, isLoading, isError } = usePlans();

  if (isLoading) {
    return { plans: [], isLoading: true, isFromApi: false };
  }

  if (apiPlans && apiPlans.length > 0 && !isError) {
    const sorted = [...apiPlans].sort((a, b) => a.displayOrder - b.displayOrder);
    return {
      plans: sorted.map(planDetailToPlanInfo),
      isLoading: false,
      isFromApi: true,
    };
  }

  // Fallback to hardcoded plans
  return { plans: PLANS, isLoading: false, isFromApi: false };
}

// ─── Active Promotions Hook (Public, No Auth) ─────────────

/**
 * Fetches active promotions flagged for display on the pricing page.
 * Uses GET /promotions/active (public endpoint).
 */
export function useActivePromotions() {
  return useQuery({
    queryKey: planKeys.promotions,
    queryFn: async (): Promise<ActivePromotionForPricing[]> => {
      const res = await apiClient.get<ActivePromotionsResponse>(
        '/promotions/active',
      );
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });
}

// Re-export types for convenience
export type { PlanDetail, ActivePromotionForPricing };
