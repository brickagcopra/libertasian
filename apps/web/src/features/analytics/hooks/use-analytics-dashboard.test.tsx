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
  extractMetric,
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
