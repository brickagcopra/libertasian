'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  AnalyticsDashboardQuery,
  AnalyticsOverviewResponse,
  AnalyticsFunnelResponse,
  AnalyticsFunnelName,
  AnalyticsRetentionResponse,
  AnalyticsDailyAggregateRow,
} from '@libertasian/types';

// ─── Query Keys ─────────────────────────────────────────────

export const analyticsKeys = {
  all: ['analytics'] as const,
  overview: (q?: AnalyticsDashboardQuery) => [...analyticsKeys.all, 'overview', q ?? {}] as const,
  search: (q?: AnalyticsDashboardQuery) => [...analyticsKeys.all, 'search', q ?? {}] as const,
  ai: (q?: AnalyticsDashboardQuery) => [...analyticsKeys.all, 'ai', q ?? {}] as const,
  revenue: (q?: AnalyticsDashboardQuery) => [...analyticsKeys.all, 'revenue', q ?? {}] as const,
  scans: (q?: AnalyticsDashboardQuery) => [...analyticsKeys.all, 'scans', q ?? {}] as const,
  study: (q?: AnalyticsDashboardQuery) => [...analyticsKeys.all, 'study', q ?? {}] as const,
  ingestion: (q?: AnalyticsDashboardQuery) =>
    [...analyticsKeys.all, 'ingestion', q ?? {}] as const,
  funnel: (name: string, q?: AnalyticsDashboardQuery) =>
    [...analyticsKeys.all, 'funnel', name, q ?? {}] as const,
  retention: (q?: AnalyticsDashboardQuery) =>
    [...analyticsKeys.all, 'retention', q ?? {}] as const,
};

// ─── Helpers ────────────────────────────────────────────────

function buildQueryParams(query?: AnalyticsDashboardQuery): Record<string, string> {
  const out: Record<string, string> = {};
  if (query?.from) out['from'] = query.from;
  if (query?.to) out['to'] = query.to;
  if (query?.granularity) out['granularity'] = query.granularity;
  if (query?.dimension) out['dimension'] = query.dimension;
  if (query?.organizationId) out['organizationId'] = query.organizationId;
  return out;
}

/**
 * Extract the latest value (or sum) for a given metric name
 * from a AnalyticsDailyAggregateRow[] array.
 */
export function extractMetric(
  metrics: AnalyticsDailyAggregateRow[],
  metricName: string,
  aggregation: 'latest' | 'sum' = 'latest',
): number {
  const rows = metrics.filter((r) => r.metricName === metricName);
  if (rows.length === 0) return 0;

  if (aggregation === 'sum') {
    return rows.reduce((sum, r) => sum + r.metricValue, 0);
  }

  // Latest: sort by date descending, take first
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  return sorted[0]?.metricValue ?? 0;
}

// ─── Hooks ──────────────────────────────────────────────────

/** Platform overview: DAU, WAU, MAU, searches, AI answers, subscriptions */
export function useAnalyticsOverview(query?: AnalyticsDashboardQuery) {
  return useQuery({
    queryKey: analyticsKeys.overview(query),
    queryFn: () =>
      apiClient.get<AnalyticsOverviewResponse>('/admin/analytics/overview', {
        params: buildQueryParams(query),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

/** Search metrics: total searches, zero-result rate, CTR, mean position */
export function useAnalyticsSearchMetrics(query?: AnalyticsDashboardQuery) {
  return useQuery({
    queryKey: analyticsKeys.search(query),
    queryFn: () =>
      apiClient.get<AnalyticsOverviewResponse>('/admin/analytics/search', {
        params: buildQueryParams(query),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

/** AI metrics: total answers, avg response time, abstention rate, helpful rate */
export function useAnalyticsAiMetrics(query?: AnalyticsDashboardQuery) {
  return useQuery({
    queryKey: analyticsKeys.ai(query),
    queryFn: () =>
      apiClient.get<AnalyticsOverviewResponse>('/admin/analytics/ai', {
        params: buildQueryParams(query),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

/** Revenue metrics: subscriptions, upgrades, cancellations, churns */
export function useAnalyticsRevenueMetrics(query?: AnalyticsDashboardQuery) {
  return useQuery({
    queryKey: analyticsKeys.revenue(query),
    queryFn: () =>
      apiClient.get<AnalyticsOverviewResponse>('/admin/analytics/revenue', {
        params: buildQueryParams(query),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

/** Funnel data: signup_to_activation, free_to_paid, etc. */
export function useAnalyticsFunnel(
  funnelName: AnalyticsFunnelName,
  query?: AnalyticsDashboardQuery,
) {
  return useQuery({
    queryKey: analyticsKeys.funnel(funnelName, query),
    queryFn: () =>
      apiClient.get<AnalyticsFunnelResponse>(`/admin/analytics/funnels/${funnelName}`, {
        params: buildQueryParams(query),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

/** Retention cohort data */
export function useAnalyticsRetention(query?: AnalyticsDashboardQuery) {
  return useQuery({
    queryKey: analyticsKeys.retention(query),
    queryFn: () =>
      apiClient.get<AnalyticsRetentionResponse>('/admin/analytics/retention', {
        params: buildQueryParams(query),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

/** Mobile & Scan metrics: scans started/completed, success rate, quality, upgrades */
export function useAnalyticsScanMetrics(query?: AnalyticsDashboardQuery) {
  return useQuery({
    queryKey: analyticsKeys.scans(query),
    queryFn: () =>
      apiClient.get<AnalyticsOverviewResponse>('/admin/analytics/scans', {
        params: buildQueryParams(query),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

/** Study mode metrics: sessions, flashcards, accuracy, codal views, offline usage */
export function useAnalyticsStudyMetrics(query?: AnalyticsDashboardQuery) {
  return useQuery({
    queryKey: analyticsKeys.study(query),
    queryFn: () =>
      apiClient.get<AnalyticsOverviewResponse>('/admin/analytics/study', {
        params: buildQueryParams(query),
      }),
    staleTime: 5 * 60 * 1000,
  });
}

/** Corpus & Ingestion metrics: documents ingested, errors, reviews, avg review time */
export function useAnalyticsIngestionMetrics(query?: AnalyticsDashboardQuery) {
  return useQuery({
    queryKey: analyticsKeys.ingestion(query),
    queryFn: () =>
      apiClient.get<AnalyticsOverviewResponse>('/admin/analytics/ingestion', {
        params: buildQueryParams(query),
      }),
    staleTime: 5 * 60 * 1000,
  });
}
