import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import {
  useRevenueSummary,
  useRevenueTrend,
  useRevenueByPlan,
  useSubscriptionSummary,
  useSubscriptionTrend,
  useSubscriptionDistribution,
  useTrialSummary,
  usePaymentSummary,
  usePaymentTrend,
  useDiscountSummary,
  useTopCoupons,
  useTopPromotions,
  useCustomerSummary,
  reportingKeys,
} from './use-admin-reporting';
import { apiClient } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
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

describe('use-admin-reporting hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Query Key Factory ───────────────────────────────────

  describe('reportingKeys', () => {
    it('generates correct revenue summary key', () => {
      const key = reportingKeys.revenue.summary({ startDate: '2026-01-01' });
      expect(key).toEqual(['admin', 'reporting', 'revenue', 'summary', { startDate: '2026-01-01' }]);
    });

    it('generates correct revenue trend key with defaults', () => {
      const key = reportingKeys.revenue.trend();
      expect(key).toEqual(['admin', 'reporting', 'revenue', 'trend', {}]);
    });

    it('generates correct subscriptions distribution key', () => {
      const key = reportingKeys.subscriptions.distribution({ endDate: '2026-03-31' });
      expect(key).toEqual([
        'admin', 'reporting', 'subscriptions', 'distribution',
        { endDate: '2026-03-31' },
      ]);
    });

    it('generates correct discounts top-coupons key', () => {
      const key = reportingKeys.discounts.topCoupons({ limit: 5 });
      expect(key).toEqual(['admin', 'reporting', 'discounts', 'top-coupons', { limit: 5 }]);
    });
  });

  // ─── Revenue Hooks ───────────────────────────────────────

  describe('useRevenueSummary', () => {
    it('fetches revenue summary from correct endpoint', async () => {
      const mockData = {
        mrrCentavos: 1000000,
        mrrPesos: 10000,
        arrCentavos: 12000000,
        arrPesos: 120000,
        arpuCentavos: 50000,
        arpuPesos: 500,
        netRevenueCentavos: 900000,
        netRevenuePesos: 9000,
        totalDiscountsCentavos: 100000,
        totalDiscountsPesos: 1000,
        activeSubscriptions: 20,
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockData);

      const { result } = renderHook(() => useRevenueSummary(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockData);
      expect(apiClient.get).toHaveBeenCalledWith('/admin/reporting/revenue/summary', {
        params: {},
      });
    });

    it('passes date params to endpoint', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({});

      renderHook(
        () => useRevenueSummary({ startDate: '2026-01-01', endDate: '2026-03-31' }),
        { wrapper: createWrapper() },
      );

      await waitFor(() =>
        expect(apiClient.get).toHaveBeenCalledWith('/admin/reporting/revenue/summary', {
          params: { startDate: '2026-01-01', endDate: '2026-03-31' },
        }),
      );
    });
  });

  describe('useRevenueTrend', () => {
    it('fetches revenue trend with period param', async () => {
      const mockData = {
        data: [{ period: '2026-03-01', revenueCentavos: 50000, revenuePesos: 500, paymentCount: 5 }],
        periodType: 'month',
        startDate: '2026-01-01',
        endDate: '2026-03-31',
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockData);

      const { result } = renderHook(
        () => useRevenueTrend({ period: 'month' }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/admin/reporting/revenue/trend', {
        params: { period: 'month' },
      });
    });
  });

  describe('useRevenueByPlan', () => {
    it('fetches revenue by plan from correct endpoint', async () => {
      const mockData = {
        data: [{ planCode: 'pro', planName: 'Pro', revenueCentavos: 99900, revenuePesos: 999, paymentCount: 1, subscriptionCount: 1 }],
        totalRevenueCentavos: 99900,
        totalRevenuePesos: 999,
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockData);

      const { result } = renderHook(() => useRevenueByPlan(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/admin/reporting/revenue/by-plan', {
        params: {},
      });
    });
  });

  // ─── Subscription Hooks ──────────────────────────────────

  describe('useSubscriptionSummary', () => {
    it('fetches subscription summary', async () => {
      const mockData = {
        totalActive: 50,
        activePaid: 30,
        activeTrial: 10,
        newInPeriod: 5,
        cancelledInPeriod: 2,
        churnRate: 0.04,
        netGrowth: 3,
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockData);

      const { result } = renderHook(() => useSubscriptionSummary(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockData);
      expect(apiClient.get).toHaveBeenCalledWith('/admin/reporting/subscriptions/summary', {
        params: {},
      });
    });
  });

  describe('useSubscriptionTrend', () => {
    it('fetches subscription trend', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [], periodType: 'day', startDate: '', endDate: '' });

      const { result } = renderHook(
        () => useSubscriptionTrend({ period: 'week' }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/admin/reporting/subscriptions/trend', {
        params: { period: 'week' },
      });
    });
  });

  describe('useSubscriptionDistribution', () => {
    it('fetches subscription distribution', async () => {
      const mockData = {
        byPlan: [{ label: 'pro', count: 20 }],
        byStatus: [{ label: 'active', count: 30 }],
        byBillingPeriod: [{ label: 'monthly', count: 25 }],
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockData);

      const { result } = renderHook(() => useSubscriptionDistribution(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockData);
    });
  });

  // ─── Trial Hook ──────────────────────────────────────────

  describe('useTrialSummary', () => {
    it('fetches trial summary', async () => {
      const mockData = {
        totalTrials: 20,
        activeTrials: 5,
        convertedTrials: 10,
        expiredTrials: 3,
        cancelledTrials: 2,
        conversionRate: 0.5,
        avgTrialDurationDays: 7.5,
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockData);

      const { result } = renderHook(() => useTrialSummary(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockData);
      expect(apiClient.get).toHaveBeenCalledWith('/admin/reporting/trials/summary', {
        params: {},
      });
    });
  });

  // ─── Payment Hooks ───────────────────────────────────────

  describe('usePaymentSummary', () => {
    it('fetches payment summary', async () => {
      const mockData = {
        totalSucceeded: 100,
        totalFailed: 5,
        totalPending: 2,
        totalRefunded: 1,
        successRate: 0.95,
        totalAmountCentavos: 5000000,
        totalAmountPesos: 50000,
        avgTransactionCentavos: 50000,
        avgTransactionPesos: 500,
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockData);

      const { result } = renderHook(() => usePaymentSummary(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockData);
    });
  });

  describe('usePaymentTrend', () => {
    it('fetches payment trend with params', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [], periodType: 'day', startDate: '', endDate: '' });

      renderHook(
        () => usePaymentTrend({ startDate: '2026-01-01', period: 'day' }),
        { wrapper: createWrapper() },
      );

      await waitFor(() =>
        expect(apiClient.get).toHaveBeenCalledWith('/admin/reporting/payments/trend', {
          params: { startDate: '2026-01-01', period: 'day' },
        }),
      );
    });
  });

  // ─── Discount Hooks ──────────────────────────────────────

  describe('useDiscountSummary', () => {
    it('fetches discount summary', async () => {
      const mockData = {
        totalCouponRedemptions: 15,
        couponDiscountCentavos: 150000,
        couponDiscountPesos: 1500,
        totalPromotionRedemptions: 8,
        promotionDiscountCentavos: 80000,
        promotionDiscountPesos: 800,
        totalDiscountCentavos: 230000,
        totalDiscountPesos: 2300,
        discountToRevenueRatio: 0.05,
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockData);

      const { result } = renderHook(() => useDiscountSummary(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockData);
    });
  });

  describe('useTopCoupons', () => {
    it('fetches top coupons with limit', async () => {
      const mockData = [
        { couponId: 'c1', code: 'SAVE20', name: 'Save 20%', redemptionCount: 50, totalDiscountCentavos: 500000, totalDiscountPesos: 5000 },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockData);

      const { result } = renderHook(
        () => useTopCoupons({ limit: 5 }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/admin/reporting/discounts/top-coupons', {
        params: { limit: '5' },
      });
    });
  });

  describe('useTopPromotions', () => {
    it('fetches top promotions', async () => {
      const mockData = [
        { promotionId: 'p1', name: 'Summer Sale', slug: 'summer-sale', redemptionCount: 30, totalDiscountCentavos: 300000, totalDiscountPesos: 3000 },
      ];
      vi.mocked(apiClient.get).mockResolvedValue(mockData);

      const { result } = renderHook(
        () => useTopPromotions({ limit: 10 }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockData);
    });
  });

  // ─── Customer Hook ───────────────────────────────────────

  describe('useCustomerSummary', () => {
    it('fetches customer summary', async () => {
      const mockData = {
        totalOrganizations: 100,
        byType: [
          { label: 'individual', count: 60 },
          { label: 'firm', count: 25 },
          { label: 'school', count: 15 },
        ],
        newSignupsInPeriod: 12,
        totalSeats: 200,
        usedSeats: 150,
        seatUtilization: 0.75,
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockData);

      const { result } = renderHook(() => useCustomerSummary(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockData);
      expect(apiClient.get).toHaveBeenCalledWith('/admin/reporting/customers/summary', {
        params: {},
      });
    });
  });

  // ─── Error Handling ──────────────────────────────────────

  describe('error handling', () => {
    it('hooks should propagate API errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Unauthorized'));

      const { result } = renderHook(() => useRevenueSummary(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeInstanceOf(Error);
    });
  });
});
