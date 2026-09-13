'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  AnalyticsDashboardQuery,
  AnalyticsOverviewResponse,
  AnalyticsFunnelResponse,
  AnalyticsFunnelName,
  AnalyticsRetentionResponse,
  AnalyticsSurfaceResponse,
  AnalyticsDailyAggregateRow,
} from '@libertasian/types';

/**
 * Every admin analytics controller method returns `{ success: true, data }`,
 * and `apiClient` returns the response body verbatim — so each queryFn must
 * unwrap `.data` itself. Typing the call as the inner shape without
 * unwrapping type-checks but hands consumers the envelope, which is how the
 * dashboard rendered a grid of zeros against a 200 response.
 */
type ApiEnvelope<T> = { success: boolean; data: T };

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
  surfaces: (q?: AnalyticsDashboardQuery) =>
    [...analyticsKeys.all, 'surfaces', q ?? {}] as const,
};

// ─── Helpers ────────────────────────────────────────────────

function buildQueryParams(
  query?: AnalyticsDashboardQuery,
  refresh = false,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (query?.from) out['from'] = query.from;
  if (query?.to) out['to'] = query.to;
  if (query?.granularity) out['granularity'] = query.granularity;
  if (query?.dimension) out['dimension'] = query.dimension;
  if (query?.organizationId) out['organizationId'] = query.organizationId;
  if (refresh || query?.refresh) out['refresh'] = 'true';
  return out;
}

/**
 * One GET against a dashboard endpoint, envelope unwrapped.
 *
 * Shared by the hooks and by `useAnalyticsRefresh` so a forced refresh hits the
 * same URL, with the same params, and lands in the same TanStack cache entry —
 * a second code path would drift and refresh something the page does not read.
 */
async function fetchDashboard<T>(
  endpoint: string,
  query?: AnalyticsDashboardQuery,
  refresh = false,
): Promise<T> {
  const res = await apiClient.get<ApiEnvelope<T>>(endpoint, {
    params: buildQueryParams(query, refresh),
  });
  return res.data;
}

/**
 * The endpoints the overview page reads, and the cache key each lands under.
 *
 * `refresh` is deliberately absent from the keys: a forced refresh must warm the
 * entry the page is already rendering from, not fork a parallel one that the
 * mounted `useQuery` never looks at.
 */
const REFRESHABLE_ENDPOINTS = [
  { path: '/admin/analytics/overview', key: (q?: AnalyticsDashboardQuery) => analyticsKeys.overview(q) },
  { path: '/admin/analytics/surfaces', key: (q?: AnalyticsDashboardQuery) => analyticsKeys.surfaces(q) },
] as const;

/**
 * Recompute the dashboard instead of waiting out the API's 5-minute cache.
 *
 * A plain `refetch()` re-asks the server, which answers from Redis — so after a
 * backfill the operator reloads, sees the same zeros, and concludes the backfill
 * failed. Only `?refresh=true` makes the API skip its cache read and repopulate,
 * which is what this sends. Results are written straight into the existing query
 * keys via `fetchQuery`, so every mounted consumer re-renders with fresh data.
 */
export function useAnalyticsRefresh(query?: AnalyticsDashboardQuery) {
  const queryClient = useQueryClient();

  return useCallback(async () => {
    await Promise.all(
      REFRESHABLE_ENDPOINTS.map((endpoint) =>
        queryClient.fetchQuery({
          queryKey: endpoint.key(query),
          queryFn: () => fetchDashboard(endpoint.path, query, true),
          staleTime: 0,
        }),
      ),
    );
  }, [queryClient, query]);
}

/**
 * Rows for one metric, excluding every dimensioned breakdown of it.
 *
 * The aggregator writes a metric twice: an undimensioned row that is the
 * total, and one row per dimension (`platform:ios`, `device:web`, …). Those
 * are different slices of the same population, not additional population — a
 * filter on `metricName` alone both multiplies the points on a trend chart and
 * double-counts the total on a KPI card.
 */
export function selectMetricRows(
  metrics: AnalyticsDailyAggregateRow[],
  metricName: string,
): AnalyticsDailyAggregateRow[] {
  return metrics.filter((r) => r.metricName === metricName && r.dimension == null);
}

/**
 * Rows for one metric whose `dimension` starts with `prefix`, keyed by the part
 * after it: `selectMetricRowsByDimension(m, 'surface_views', 'surface:')` gives
 * `{ digests: [...], bar_exams: [...] }`.
 *
 * A separate function rather than a looser `selectMetricRows`, on purpose.
 * `selectMetricRows` returns undimensioned rows ONLY so the KPI cards and trend
 * charts cannot double-count — a metric is written once as a total and again per
 * dimension, and those are slices of the same population. Relaxing it to serve
 * this panel would put that bug back on every card. Callers that want the
 * breakdown ask for the breakdown.
 *
 * Rows whose dimension does not match the prefix — including the undimensioned
 * total and a different prefix on the same metric (`platform:*` vs `device:*`) —
 * are excluded.
 */
export function selectMetricRowsByDimension(
  metrics: AnalyticsDailyAggregateRow[],
  metricName: string,
  prefix: string,
): Record<string, AnalyticsDailyAggregateRow[]> {
  const out: Record<string, AnalyticsDailyAggregateRow[]> = {};

  for (const row of metrics) {
    if (row.metricName !== metricName) continue;
    if (!row.dimension?.startsWith(prefix)) continue;

    const key = row.dimension.slice(prefix.length);
    if (!key) continue;
    (out[key] ??= []).push(row);
  }

  return out;
}

/**
 * Extract the latest value (or sum) for a given metric name
 * from a AnalyticsDailyAggregateRow[] array. Dimensioned rows are ignored;
 * see selectMetricRows.
 */
export function extractMetric(
  metrics: AnalyticsDailyAggregateRow[],
  metricName: string,
  aggregation: 'latest' | 'sum' = 'latest',
): number {
  const rows = selectMetricRows(metrics, metricName);
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
    queryFn: async () => {
      return fetchDashboard<AnalyticsOverviewResponse>('/admin/analytics/overview', query);
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Search metrics: total searches, zero-result rate, CTR, mean position */
export function useAnalyticsSearchMetrics(query?: AnalyticsDashboardQuery) {
  return useQuery({
    queryKey: analyticsKeys.search(query),
    queryFn: async () => {
      return fetchDashboard<AnalyticsOverviewResponse>('/admin/analytics/search', query);
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** AI metrics: total answers, avg response time, abstention rate, helpful rate */
export function useAnalyticsAiMetrics(query?: AnalyticsDashboardQuery) {
  return useQuery({
    queryKey: analyticsKeys.ai(query),
    queryFn: async () => {
      return fetchDashboard<AnalyticsOverviewResponse>('/admin/analytics/ai', query);
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Revenue metrics: subscriptions, upgrades, cancellations, churns */
export function useAnalyticsRevenueMetrics(query?: AnalyticsDashboardQuery) {
  return useQuery({
    queryKey: analyticsKeys.revenue(query),
    queryFn: async () => {
      return fetchDashboard<AnalyticsOverviewResponse>('/admin/analytics/revenue', query);
    },
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
    queryFn: async () => {
      return fetchDashboard<AnalyticsFunnelResponse>(`/admin/analytics/funnels/${funnelName}`, query);
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Retention cohort data */
export function useAnalyticsRetention(query?: AnalyticsDashboardQuery) {
  return useQuery({
    queryKey: analyticsKeys.retention(query),
    queryFn: async () => {
      return fetchDashboard<AnalyticsRetentionResponse>('/admin/analytics/retention', query);
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Mobile & Scan metrics: scans started/completed, success rate, quality, upgrades */
export function useAnalyticsScanMetrics(query?: AnalyticsDashboardQuery) {
  return useQuery({
    queryKey: analyticsKeys.scans(query),
    queryFn: async () => {
      return fetchDashboard<AnalyticsOverviewResponse>('/admin/analytics/scans', query);
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Study mode metrics: sessions, flashcards, accuracy, codal views, offline usage */
export function useAnalyticsStudyMetrics(query?: AnalyticsDashboardQuery) {
  return useQuery({
    queryKey: analyticsKeys.study(query),
    queryFn: async () => {
      return fetchDashboard<AnalyticsOverviewResponse>('/admin/analytics/study', query);
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Surface usage + platform split — the "where users go" panel.
 *
 * Returns DIMENSIONED rows (`surface:*`, `platform:*`) alongside the totals;
 * split them with `selectMetricRowsByDimension`, never by filtering on
 * `metricName` alone.
 */
export function useAnalyticsSurfaces(query?: AnalyticsDashboardQuery) {
  return useQuery({
    queryKey: analyticsKeys.surfaces(query),
    queryFn: async () => {
      return fetchDashboard<AnalyticsSurfaceResponse>('/admin/analytics/surfaces', query);
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Corpus & Ingestion metrics: documents ingested, errors, reviews, avg review time */
export function useAnalyticsIngestionMetrics(query?: AnalyticsDashboardQuery) {
  return useQuery({
    queryKey: analyticsKeys.ingestion(query),
    queryFn: async () => {
      return fetchDashboard<AnalyticsOverviewResponse>('/admin/analytics/ingestion', query);
    },
    staleTime: 5 * 60 * 1000,
  });
}
