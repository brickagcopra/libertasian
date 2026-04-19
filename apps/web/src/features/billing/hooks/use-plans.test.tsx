import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { usePlans, usePlanInfoList, useActivePromotions } from './use-plans';
import { apiClient } from '@/lib/api-client';
import type { PlanDetail } from '../types';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const mockPlanDetail: PlanDetail = {
  id: 'plan-1',
  code: 'pro',
  name: 'Pro',
  displayName: 'Professional',
  description: 'For professionals',
  type: 'standard',
  category: 'individual',
  isActive: true,
  isVisible: true,
  displayOrder: 2,
  trialEnabled: true,
  trialDurationDays: 14,
  defaultSeats: 1,
  maxSeats: 1,
  isFeatured: true,
  featuredLabel: 'Most Popular',
  ctaText: 'Start Now',
  highlightColor: 'primary',
  prices: [
    { id: 'price-1', billingInterval: 'monthly', amount: 99900, currency: 'PHP', isActive: true },
  ],
  entitlements: [
    { id: 'ent-1', key: 'aiAnswers', valueType: 'unlimited', numericValue: null, booleanValue: null, description: 'Unlimited AI answers' },
  ],
};

describe('use-plans hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('usePlans', () => {
    it('should fetch visible plans from API', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        success: true,
        data: [mockPlanDetail],
      });

      const { result } = renderHook(() => usePlans(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/plans');
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data![0].code).toBe('pro');
    });

    it('should use initialData for hydration when provided', () => {
      const { result } = renderHook(
        () => usePlans([mockPlanDetail]),
        { wrapper: createWrapper() },
      );

      // initialData is available immediately (no loading state)
      expect(result.current.data).toHaveLength(1);
      expect(result.current.data![0].isFeatured).toBe(true);
      expect(result.current.data![0].featuredLabel).toBe('Most Popular');
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => usePlans(), {
        wrapper: createWrapper(),
      });

      // usePlans has retry: 2, so wait for all retries to exhaust
      await waitFor(() => expect(result.current.isError).toBe(true), {
        timeout: 5000,
      });
    });
  });

  describe('usePlanInfoList', () => {
    it('should convert API plans to PlanInfo shape', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        success: true,
        data: [mockPlanDetail],
      });

      const { result } = renderHook(() => usePlanInfoList(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isFromApi).toBe(true));
      expect(result.current.plans).toHaveLength(1);
      expect(result.current.plans[0].code).toBe('pro');
      expect(result.current.plans[0].highlight).toBe(true); // mapped from isFeatured
      expect(result.current.plans[0].monthlyPrice).toBe(999); // 99900 centavos / 100
    });

    it('should fall back to static PLANS on error', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('fail'));

      const { result } = renderHook(() => usePlanInfoList(), {
        wrapper: createWrapper(),
      });

      // usePlans has retry: 2, so wait for all retries to exhaust
      await waitFor(() => expect(result.current.isLoading).toBe(false), {
        timeout: 5000,
      });
      expect(result.current.isFromApi).toBe(false);
      expect(result.current.plans.length).toBeGreaterThan(0);
    });
  });

  describe('useActivePromotions', () => {
    it('should fetch active promotions', async () => {
      const mockPromo = {
        id: 'promo-1',
        name: 'Launch Sale',
        slug: 'launch-sale',
        description: null,
        promotionType: 'sale',
        benefits: [],
        endsAt: null,
      };
      vi.mocked(apiClient.get).mockResolvedValue({
        success: true,
        data: [mockPromo],
      });

      const { result } = renderHook(() => useActivePromotions(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/promotions/active');
      expect(result.current.data).toHaveLength(1);
    });
  });
});
