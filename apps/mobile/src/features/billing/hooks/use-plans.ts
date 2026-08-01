import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  PlansListResponse,
  PlanDetail,
  PlanInfo,
} from '../types';
import { PLANS, planDetailToPlanInfo } from '../types';

// ─── Query Keys ───────────────────────────────────────────

export const planKeys = {
  all: ['plans'] as const,
  visible: ['plans', 'visible'] as const,
};

// ─── Plans Hook (Public, No Auth) ─────────────────────────

/**
 * Fetches visible plans from the public GET /plans endpoint.
 * Returns DB-driven plans with prices and entitlements.
 */
export function usePlans() {
  return useQuery({
    queryKey: planKeys.visible,
    queryFn: async (): Promise<PlanDetail[]> => {
      const res = await apiClient.get<PlansListResponse>('/plans', { skipAuth: true });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
  });
}

/**
 * Returns PlanInfo[] — API-driven if available, falls back to hardcoded PLANS.
 * Use this for components that still need the PlanInfo shape.
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

/**
 * The active-promotions hook was removed with the purchase path: a promotion
 * banner is discount marketing for a purchase the app is no longer allowed to
 * offer (Apple 3.1.1 / Play Payments). GET /promotions/active still serves the
 * web pricing page.
 */

// Re-export types for convenience
export type { PlanDetail, PlanInfo };
