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
