import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import {
  useAnalyticsOverview,
  useAnalyticsSearchMetrics,
  useAnalyticsAiMetrics,
  useAnalyticsRevenueMetrics,
  useAnalyticsFunnel,
  useAnalyticsRetention,
  useAnalyticsScanMetrics,
  useAnalyticsStudyMetrics,
  useAnalyticsIngestionMetrics,
  useAnalyticsSurfaces,
  useAnalyticsRefresh,
  extractMetric,
  selectMetricRows,
  selectMetricRowsByDimension,
  analyticsKeys,
} from './use-analytics-dashboard';

const mockGet = vi.mocked(apiClient.get);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const makeOverviewResponse = () => ({
  success: true,
  data: {
    metrics: [
      { metricName: 'dau', metricValue: 120, date: '2026-03-31' },
      { metricName: 'dau', metricValue: 100, date: '2026-03-30' },
      { metricName: 'searches', metricValue: 500, date: '2026-03-31' },
    ],
  },
});

describe('extractMetric', () => {
  const metrics = [
    { metricName: 'dau', metricValue: 120, date: '2026-03-31' },
    { metricName: 'dau', metricValue: 100, date: '2026-03-30' },
    { metricName: 'searches', metricValue: 500, date: '2026-03-31' },
    { metricName: 'searches', metricValue: 450, date: '2026-03-30' },
  ];

  it('returns latest value by default', () => {
    expect(extractMetric(metrics, 'dau')).toBe(120);
  });

  it('returns sum when aggregation is sum', () => {
    expect(extractMetric(metrics, 'searches', 'sum')).toBe(950);
  });

  it('returns 0 for missing metric', () => {
    expect(extractMetric(metrics, 'nonexistent')).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(extractMetric([], 'dau')).toBe(0);
  });

  it('ignores dimensioned rows so the KPI card is not double-counted', () => {
    // What the aggregator actually writes for one day: the total, plus one
    // row per platform. Summing all four rows would report 240 users.
    const withPlatforms = [
      { metricName: 'dau', metricValue: 120, date: '2026-03-31', dimension: null },
      { metricName: 'dau', metricValue: 70, date: '2026-03-31', dimension: 'platform:web' },
      { metricName: 'dau', metricValue: 30, date: '2026-03-31', dimension: 'platform:ios' },
      { metricName: 'dau', metricValue: 20, date: '2026-03-31', dimension: 'platform:android' },
    ];

    expect(extractMetric(withPlatforms, 'dau')).toBe(120);
    expect(extractMetric(withPlatforms, 'dau', 'sum')).toBe(120);
  });

  it('does not pick a dimensioned row as "latest"', () => {
    const rows = [
      { metricName: 'dau', metricValue: 120, date: '2026-03-30', dimension: null },
      { metricName: 'dau', metricValue: 9, date: '2026-03-31', dimension: 'platform:ios' },
    ];

    expect(extractMetric(rows, 'dau')).toBe(120);
  });

  it('returns 0 when a metric has only dimensioned rows', () => {
    const rows = [
      { metricName: 'dau', metricValue: 9, date: '2026-03-31', dimension: 'platform:ios' },
    ];

    expect(extractMetric(rows, 'dau')).toBe(0);
  });
});

describe('selectMetricRows', () => {
  const rows = [
    { metricName: 'dau', metricValue: 120, date: '2026-03-31', dimension: null },
    { metricName: 'dau', metricValue: 30, date: '2026-03-31', dimension: 'platform:ios' },
    { metricName: 'dau', metricValue: 100, date: '2026-03-30', dimension: null },
    { metricName: 'searches', metricValue: 500, date: '2026-03-31', dimension: null },
  ];

  it('keeps one point per day for a trend chart', () => {
    const dau = selectMetricRows(rows, 'dau');
    expect(dau).toHaveLength(2);
    expect(dau.map((r) => r.metricValue)).toEqual([120, 100]);
  });

  it('treats a row with no dimension field as the undimensioned total', () => {
    expect(selectMetricRows([{ metricName: 'dau', metricValue: 7, date: '2026-03-31' }], 'dau'))
      .toHaveLength(1);
  });

  it('returns an empty array for an unknown metric', () => {
    expect(selectMetricRows(rows, 'nonexistent')).toEqual([]);
  });
});

describe('analyticsKeys', () => {
  it('generates correct key structure', () => {
    expect(analyticsKeys.all).toEqual(['analytics']);
    expect(analyticsKeys.overview()).toEqual(['analytics', 'overview', {}]);
    expect(analyticsKeys.search({ from: '2026-01-01' })).toEqual([
      'analytics',
      'search',
      { from: '2026-01-01' },
    ]);
    expect(analyticsKeys.funnel('signup_to_activation')).toEqual([
      'analytics',
      'funnel',
      'signup_to_activation',
      {},
    ]);
  });
});

describe('useAnalyticsOverview', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches from /admin/analytics/overview', async () => {
    mockGet.mockResolvedValueOnce(makeOverviewResponse());
    const { result } = renderHook(() => useAnalyticsOverview(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/analytics/overview', {
      params: {},
    });
  });

  it('passes query params', async () => {
    mockGet.mockResolvedValueOnce(makeOverviewResponse());
    const { result } = renderHook(
      () => useAnalyticsOverview({ from: '2026-03-01', to: '2026-03-31', granularity: 'week' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/analytics/overview', {
      params: { from: '2026-03-01', to: '2026-03-31', granularity: 'week' },
    });
  });
});

describe('useAnalyticsSearchMetrics', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches from /admin/analytics/search', async () => {
    mockGet.mockResolvedValueOnce(makeOverviewResponse());
    const { result } = renderHook(() => useAnalyticsSearchMetrics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/analytics/search', {
      params: {},
    });
  });
});

describe('useAnalyticsAiMetrics', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches from /admin/analytics/ai', async () => {
    mockGet.mockResolvedValueOnce(makeOverviewResponse());
    const { result } = renderHook(() => useAnalyticsAiMetrics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/analytics/ai', { params: {} });
  });
});

describe('useAnalyticsRevenueMetrics', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches from /admin/analytics/revenue', async () => {
    mockGet.mockResolvedValueOnce(makeOverviewResponse());
    const { result } = renderHook(() => useAnalyticsRevenueMetrics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/analytics/revenue', {
      params: {},
    });
  });
});

describe('useAnalyticsFunnel', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches funnel by name', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { steps: [] } });
    const { result } = renderHook(
      () => useAnalyticsFunnel('signup_to_activation' as const),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith(
      '/admin/analytics/funnels/signup_to_activation',
      { params: {} },
    );
  });
});

describe('useAnalyticsRetention', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches from /admin/analytics/retention', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { cohorts: [] } });
    const { result } = renderHook(() => useAnalyticsRetention(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/analytics/retention', {
      params: {},
    });
  });
});

describe('useAnalyticsScanMetrics', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches from /admin/analytics/scans', async () => {
    mockGet.mockResolvedValueOnce(makeOverviewResponse());
    const { result } = renderHook(() => useAnalyticsScanMetrics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/analytics/scans', {
      params: {},
    });
  });
});

describe('useAnalyticsStudyMetrics', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches from /admin/analytics/study', async () => {
    mockGet.mockResolvedValueOnce(makeOverviewResponse());
    const { result } = renderHook(() => useAnalyticsStudyMetrics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/analytics/study', {
      params: {},
    });
  });
});

describe('useAnalyticsIngestionMetrics', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches from /admin/analytics/ingestion', async () => {
    mockGet.mockResolvedValueOnce(makeOverviewResponse());
    const { result } = renderHook(() => useAnalyticsIngestionMetrics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/analytics/ingestion', {
      params: {},
    });
  });
});

describe('envelope unwrapping', () => {
  beforeEach(() => mockGet.mockReset());

  /**
   * The controllers return `{ success: true, data }` and `apiClient` returns
   * the response body verbatim, so each queryFn must unwrap `.data` itself.
   * Without that, `overview.metrics` is `undefined` on a perfectly good 200
   * and the dashboard renders a grid of zeros — the exact shipped bug. These
   * tests feed the real envelope through and assert on the hook's `data`.
   */

  const metricHooks = [
    ['useAnalyticsOverview', useAnalyticsOverview],
    ['useAnalyticsSearchMetrics', useAnalyticsSearchMetrics],
    ['useAnalyticsAiMetrics', useAnalyticsAiMetrics],
    ['useAnalyticsRevenueMetrics', useAnalyticsRevenueMetrics],
    ['useAnalyticsScanMetrics', useAnalyticsScanMetrics],
    ['useAnalyticsStudyMetrics', useAnalyticsStudyMetrics],
    ['useAnalyticsIngestionMetrics', useAnalyticsIngestionMetrics],
  ] as const;

  it.each(metricHooks)('%s exposes metrics, not the envelope', async (_name, hook) => {
    mockGet.mockResolvedValueOnce(makeOverviewResponse());
    const { result } = renderHook(() => hook(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).not.toHaveProperty('success');
    expect(result.current.data?.metrics).toHaveLength(3);
    expect(result.current.data?.metrics[0]).toMatchObject({
      metricName: 'dau',
      metricValue: 120,
    });
  });

  it('overview metrics feed extractMetric the way page.tsx uses them', async () => {
    // page.tsx: `const metrics = overview?.metrics ?? []` then extractMetric.
    // Against the un-unwrapped shape this silently fell back to [] → zeros.
    mockGet.mockResolvedValueOnce(makeOverviewResponse());
    const { result } = renderHook(() => useAnalyticsOverview(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const metrics = result.current.data?.metrics ?? [];
    expect(metrics).not.toHaveLength(0);
    expect(extractMetric(metrics, 'dau', 'latest')).toBe(120);
    expect(extractMetric(metrics, 'searches', 'sum')).toBe(500);
  });

  it('useAnalyticsFunnel exposes steps — page.tsx reads funnel?.steps', async () => {
    const steps = [
      { stepName: 'signup', stepOrder: 1, enteredCount: 100, completedCount: 80 },
      { stepName: 'first_search', stepOrder: 2, enteredCount: 80, completedCount: 55 },
    ];
    mockGet.mockResolvedValueOnce({
      success: true,
      data: { funnelName: 'signup_to_activation', steps },
    });

    const { result } = renderHook(
      () => useAnalyticsFunnel('signup_to_activation' as const),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).not.toHaveProperty('success');
    expect(result.current.data?.steps).toHaveLength(2);
    expect(result.current.data?.steps[0]).toMatchObject({ stepName: 'signup' });
  });

  it('useAnalyticsRetention exposes cohorts', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: {
        cohorts: [{ cohortWeek: '2026-03-01', retentionWeek: 0, userCount: 100 }],
      },
    });

    const { result } = renderHook(() => useAnalyticsRetention(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).not.toHaveProperty('success');
    expect(result.current.data?.cohorts).toHaveLength(1);
  });

  it('surfaces isError when the request rejects', async () => {
    // page.tsx renders an error banner off this; without it a failed fetch
    // is indistinguishable from a genuinely empty corpus.
    mockGet.mockRejectedValueOnce(new Error('Forbidden'));

    const { result } = renderHook(() => useAnalyticsOverview(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe('selectMetricRowsByDimension', () => {
  /**
   * What the aggregator actually writes for one day of surface views: a row per
   * surface plus an undimensioned total, and the sessions metric carrying two
   * different dimension prefixes at once.
   */
  const rows = [
    { metricName: 'surface_views', metricValue: 96, uniqueUsers: 11, date: '2026-09-11', dimension: null },
    { metricName: 'surface_views', metricValue: 42, uniqueUsers: 7, date: '2026-09-11', dimension: 'surface:digests' },
    { metricName: 'surface_views', metricValue: 31, uniqueUsers: 5, date: '2026-09-11', dimension: 'surface:bar_exams' },
    { metricName: 'surface_views', metricValue: 40, uniqueUsers: 6, date: '2026-09-10', dimension: 'surface:digests' },
    { metricName: 'sessions', metricValue: 12, uniqueUsers: 0, date: '2026-09-11', dimension: 'platform:ios' },
    { metricName: 'sessions', metricValue: 12, uniqueUsers: 0, date: '2026-09-11', dimension: 'device:ios' },
    { metricName: 'dau', metricValue: 9, uniqueUsers: 9, date: '2026-09-11', dimension: 'platform:web' },
  ];

  it('groups a metric by the part of the dimension after the prefix', () => {
    const bySurface = selectMetricRowsByDimension(rows, 'surface_views', 'surface:');
    expect(Object.keys(bySurface).sort()).toEqual(['bar_exams', 'digests']);
    expect(bySurface['digests']).toHaveLength(2);
    expect(bySurface['bar_exams']).toHaveLength(1);
  });

  it('carries uniqueUsers through, not only the value', () => {
    const bySurface = selectMetricRowsByDimension(rows, 'surface_views', 'surface:');
    expect(bySurface['digests']!.map((r) => r.uniqueUsers)).toEqual([7, 6]);
  });

  it('excludes the undimensioned total', () => {
    const bySurface = selectMetricRowsByDimension(rows, 'surface_views', 'surface:');
    const values = Object.values(bySurface).flat().map((r) => r.metricValue);
    expect(values).not.toContain(96);
  });

  it('does not mix two prefixes on the same metric', () => {
    // sessions is written under both platform:* and device:*; adding them would
    // double-count the same sessions.
    const byPlatform = selectMetricRowsByDimension(rows, 'sessions', 'platform:');
    expect(Object.keys(byPlatform)).toEqual(['ios']);
    expect(byPlatform['ios']).toHaveLength(1);
  });

  it('returns an empty object for a metric with no dimensioned rows', () => {
    expect(selectMetricRowsByDimension(rows, 'searches', 'surface:')).toEqual({});
  });

  it('leaves selectMetricRows untouched — the KPI cards still get totals only', () => {
    // Relaxing selectMetricRows to serve this panel would put the
    // double-counting bug back on every card.
    expect(selectMetricRows(rows, 'surface_views')).toHaveLength(1);
    expect(selectMetricRows(rows, 'surface_views')[0]!.metricValue).toBe(96);
  });
});

describe('useAnalyticsSurfaces', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches from /admin/analytics/surfaces', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { metrics: [] } });
    const { result } = renderHook(() => useAnalyticsSurfaces(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/analytics/surfaces', { params: {} });
  });

  it('unwraps the envelope and keeps the dimensioned rows', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: {
        metrics: [
          { metricName: 'surface_views', metricValue: 42, uniqueUsers: 7, date: '2026-09-11', dimension: 'surface:digests' },
        ],
        lastAggregatedAt: '2026-09-11',
      },
    });

    const { result } = renderHook(() => useAnalyticsSurfaces(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).not.toHaveProperty('success');
    expect(result.current.data?.metrics[0]).toMatchObject({ dimension: 'surface:digests' });
    expect(result.current.data?.lastAggregatedAt).toBe('2026-09-11');
  });

  it('surfaces isError when the request rejects', async () => {
    mockGet.mockRejectedValueOnce(new Error('Forbidden'));
    const { result } = renderHook(() => useAnalyticsSurfaces(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe('lastAggregatedAt on the overview', () => {
  beforeEach(() => mockGet.mockReset());

  it('reaches the consumer', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: { metrics: [], lastAggregatedAt: '2026-09-11' },
    });

    const { result } = renderHook(() => useAnalyticsOverview(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.lastAggregatedAt).toBe('2026-09-11');
  });

  it('is null, not missing, when nothing has ever been aggregated', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: { metrics: [], lastAggregatedAt: null },
    });

    const { result } = renderHook(() => useAnalyticsOverview(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveProperty('lastAggregatedAt', null);
  });
});

describe('useAnalyticsRefresh', () => {
  beforeEach(() => mockGet.mockReset());

  it('sends refresh=true so the API bypasses its 5-minute cache', async () => {
    mockGet.mockResolvedValue({ success: true, data: { metrics: [] } });

    const { result } = renderHook(() => useAnalyticsRefresh({ from: '2026-09-01' }), {
      wrapper: createWrapper(),
    });
    await result.current();

    const paths = mockGet.mock.calls.map(([path]) => path);
    expect(paths).toEqual(
      expect.arrayContaining(['/admin/analytics/overview', '/admin/analytics/surfaces']),
    );
    for (const [, options] of mockGet.mock.calls) {
      expect((options as { params: Record<string, string> }).params).toMatchObject({
        from: '2026-09-01',
        refresh: 'true',
      });
    }
  });

  it('writes into the key the mounted query already reads', async () => {
    // A refresh that landed under a different key would leave the page on the
    // stale entry until the TTL expired — the bug, moved.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    mockGet.mockResolvedValue({
      success: true,
      data: { metrics: [{ metricName: 'dau', metricValue: 7, date: '2026-09-11' }] },
    });

    const { result } = renderHook(() => useAnalyticsRefresh(), { wrapper: Wrapper });
    await result.current();

    expect(queryClient.getQueryData(analyticsKeys.overview())).toMatchObject({
      metrics: [{ metricName: 'dau', metricValue: 7 }],
    });
    expect(queryClient.getQueryData(analyticsKeys.surfaces())).toBeDefined();
  });

  it('does not send refresh on the ordinary hooks', async () => {
    mockGet.mockResolvedValueOnce(makeOverviewResponse());
    const { result } = renderHook(() => useAnalyticsOverview({ from: '2026-09-01' }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/analytics/overview', {
      params: { from: '2026-09-01' },
    });
  });
});
