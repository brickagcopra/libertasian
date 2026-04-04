'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  RevenueSummary,
  RevenueTrendResponse,
  RevenueByPlanResponse,
  SubscriptionSummary,
  SubscriptionTrendResponse,
  SubscriptionDistributionResponse,
  TrialSummary,
  PaymentSummary,
  PaymentTrendResponse,
  DiscountSummary,
  TopCouponItem,
  TopPromotionItem,
  CustomerSummary,
} from '@libertasian/types';

// ─── Query Param Types ──────────────────────────────────────

export interface DateRangeParams {
  startDate?: string;
  endDate?: string;
}

export interface TrendParams extends DateRangeParams {
  period?: 'day' | 'week' | 'month';
}

export interface TopItemsParams extends DateRangeParams {
  limit?: number;
}

// ─── Query Keys ─────────────────────────────────────────────

export const reportingKeys = {
  all: ['admin', 'reporting'] as const,
  revenue: {
    summary: (p?: DateRangeParams) => [...reportingKeys.all, 'revenue', 'summary', p ?? {}] as const,
    trend: (p?: TrendParams) => [...reportingKeys.all, 'revenue', 'trend', p ?? {}] as const,
    byPlan: (p?: DateRangeParams) => [...reportingKeys.all, 'revenue', 'by-plan', p ?? {}] as const,
  },
  subscriptions: {
    summary: (p?: DateRangeParams) =>
      [...reportingKeys.all, 'subscriptions', 'summary', p ?? {}] as const,
    trend: (p?: TrendParams) =>
      [...reportingKeys.all, 'subscriptions', 'trend', p ?? {}] as const,
    distribution: (p?: DateRangeParams) =>
      [...reportingKeys.all, 'subscriptions', 'distribution', p ?? {}] as const,
  },
  trials: {
    summary: (p?: DateRangeParams) => [...reportingKeys.all, 'trials', 'summary', p ?? {}] as const,
  },
  payments: {
    summary: (p?: DateRangeParams) =>
      [...reportingKeys.all, 'payments', 'summary', p ?? {}] as const,
    trend: (p?: TrendParams) => [...reportingKeys.all, 'payments', 'trend', p ?? {}] as const,
  },
  discounts: {
    summary: (p?: DateRangeParams) =>
      [...reportingKeys.all, 'discounts', 'summary', p ?? {}] as const,
    topCoupons: (p?: TopItemsParams) =>
      [...reportingKeys.all, 'discounts', 'top-coupons', p ?? {}] as const,
    topPromotions: (p?: TopItemsParams) =>
      [...reportingKeys.all, 'discounts', 'top-promotions', p ?? {}] as const,
  },
  customers: {
    summary: (p?: DateRangeParams) =>
      [...reportingKeys.all, 'customers', 'summary', p ?? {}] as const,
  },
};

// ─── Helpers ────────────────────────────────────────────────

function buildDateParams(params?: DateRangeParams): Record<string, string> {
  const out: Record<string, string> = {};
  if (params?.startDate) out['startDate'] = params.startDate;
  if (params?.endDate) out['endDate'] = params.endDate;
  return out;
}

function buildTrendParams(params?: TrendParams): Record<string, string> {
  const out = buildDateParams(params);
  if (params?.period) out['period'] = params.period;
  return out;
}

function buildTopItemsParams(params?: TopItemsParams): Record<string, string> {
  const out = buildDateParams(params);
  if (params?.limit) out['limit'] = String(params.limit);
  return out;
}

// ─── Revenue ────────────────────────────────────────────────

/** Revenue summary: MRR, ARR, ARPU, net revenue, discounts */
export function useRevenueSummary(params?: DateRangeParams) {
  return useQuery({
    queryKey: reportingKeys.revenue.summary(params),
    queryFn: () =>
      apiClient.get<RevenueSummary>('/admin/reporting/revenue/summary', {
        params: buildDateParams(params),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

/** Revenue trend over time (day/week/month) */
export function useRevenueTrend(params?: TrendParams) {
  return useQuery({
    queryKey: reportingKeys.revenue.trend(params),
    queryFn: () =>
      apiClient.get<RevenueTrendResponse>('/admin/reporting/revenue/trend', {
        params: buildTrendParams(params),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

/** Revenue breakdown by plan */
export function useRevenueByPlan(params?: DateRangeParams) {
  return useQuery({
    queryKey: reportingKeys.revenue.byPlan(params),
    queryFn: () =>
      apiClient.get<RevenueByPlanResponse>('/admin/reporting/revenue/by-plan', {
        params: buildDateParams(params),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Subscriptions ──────────────────────────────────────────

/** Subscription summary: active, churn, growth */
export function useSubscriptionSummary(params?: DateRangeParams) {
  return useQuery({
    queryKey: reportingKeys.subscriptions.summary(params),
    queryFn: () =>
      apiClient.get<SubscriptionSummary>('/admin/reporting/subscriptions/summary', {
        params: buildDateParams(params),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

/** Subscription trend: new vs cancelled over time */
export function useSubscriptionTrend(params?: TrendParams) {
  return useQuery({
    queryKey: reportingKeys.subscriptions.trend(params),
    queryFn: () =>
      apiClient.get<SubscriptionTrendResponse>('/admin/reporting/subscriptions/trend', {
        params: buildTrendParams(params),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

/** Subscription distribution: by plan, status, billing period */
export function useSubscriptionDistribution(params?: DateRangeParams) {
  return useQuery({
    queryKey: reportingKeys.subscriptions.distribution(params),
    queryFn: () =>
      apiClient.get<SubscriptionDistributionResponse>(
        '/admin/reporting/subscriptions/distribution',
        { params: buildDateParams(params) },
      ),
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Trials ─────────────────────────────────────────────────

/** Trial summary: conversion rate, avg duration */
export function useTrialSummary(params?: DateRangeParams) {
  return useQuery({
    queryKey: reportingKeys.trials.summary(params),
    queryFn: () =>
      apiClient.get<TrialSummary>('/admin/reporting/trials/summary', {
        params: buildDateParams(params),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Payments ───────────────────────────────────────────────

/** Payment summary: success rate, avg transaction */
export function usePaymentSummary(params?: DateRangeParams) {
  return useQuery({
    queryKey: reportingKeys.payments.summary(params),
    queryFn: () =>
      apiClient.get<PaymentSummary>('/admin/reporting/payments/summary', {
        params: buildDateParams(params),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

/** Payment trend: succeeded vs failed over time */
export function usePaymentTrend(params?: TrendParams) {
  return useQuery({
    queryKey: reportingKeys.payments.trend(params),
    queryFn: () =>
      apiClient.get<PaymentTrendResponse>('/admin/reporting/payments/trend', {
        params: buildTrendParams(params),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Discounts ──────────────────────────────────────────────

/** Discount summary: coupon + promotion impact */
export function useDiscountSummary(params?: DateRangeParams) {
  return useQuery({
    queryKey: reportingKeys.discounts.summary(params),
    queryFn: () =>
      apiClient.get<DiscountSummary>('/admin/reporting/discounts/summary', {
        params: buildDateParams(params),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

/** Top coupons by redemptions */
export function useTopCoupons(params?: TopItemsParams) {
  return useQuery({
    queryKey: reportingKeys.discounts.topCoupons(params),
    queryFn: () =>
      apiClient.get<TopCouponItem[]>('/admin/reporting/discounts/top-coupons', {
        params: buildTopItemsParams(params),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

/** Top promotions by discount amount */
export function useTopPromotions(params?: TopItemsParams) {
  return useQuery({
    queryKey: reportingKeys.discounts.topPromotions(params),
    queryFn: () =>
      apiClient.get<TopPromotionItem[]>('/admin/reporting/discounts/top-promotions', {
        params: buildTopItemsParams(params),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Customers ──────────────────────────────────────────────

/** Customer summary: org counts, signups, seat utilization */
export function useCustomerSummary(params?: DateRangeParams) {
  return useQuery({
    queryKey: reportingKeys.customers.summary(params),
    queryFn: () =>
      apiClient.get<CustomerSummary>('/admin/reporting/customers/summary', {
        params: buildDateParams(params),
      }),
    staleTime: 5 * 60 * 1000,
  });
}
