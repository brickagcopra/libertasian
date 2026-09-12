import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import {
  useEffectiveEntitlements,
  useStoredEntitlementKeyCounts,
  useSetEntitlementsJson,
  useClearEntitlementsJsonKey,
  usePruneEntitlementsJson,
  adminSubscriptionKeys,
} from './use-admin-subscriptions';
import { apiClient } from '@/lib/api-client';

// The apiClient is mocked, NOT the hook. A mocked hook cannot tell you whether
// the hook unwraps the {success, data} envelope correctly — which is exactly
// what hid the bug in #469.
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

const SUB = 'sub-1';

function reportEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      subscriptionId: SUB,
      organizationId: '9d72ed0e-f7e7-4784-ae0c-29c7287f2b35',
      planCode: 'free',
      platform: 'web',
      paywallEnforced: true,
      isResolvedSubscription: true,
      resolvedSubscriptionId: SUB,
      keys: [
        {
          key: 'aiAnswers',
          planValue: 15,
          storedValue: 0,
          hasStoredValue: true,
          activeOverrides: [],
          effectiveValue: 0,
          winningLayer: 'subscription',
          conflictsWithPlan: true,
        },
      ],
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useEffectiveEntitlements', () => {
  it('unwraps the {success, data} envelope into the report', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(reportEnvelope());

    const { result } = renderHook(() => useEffectiveEntitlements(SUB, 'web'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.planCode).toBe('free');
    expect(result.current.data?.keys[0].conflictsWithPlan).toBe(true);
    // NOT the envelope itself.
    expect(
      (result.current.data as unknown as { success?: boolean }).success,
    ).toBeUndefined();
  });

  it('requests the platform the caller asked for', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(reportEnvelope());

    renderHook(() => useEffectiveEntitlements(SUB, 'ios'), {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(apiClient.get).toHaveBeenCalledWith(
        `/admin/subscriptions/${SUB}/entitlements/effective?platform=ios`,
      ),
    );
  });

  it('keys the cache by platform so the switcher actually re-queries', () => {
    const web = adminSubscriptionKeys.effectiveEntitlements(SUB, 'web');
    const ios = adminSubscriptionKeys.effectiveEntitlements(SUB, 'ios');

    expect(web).not.toEqual(ios);
    expect(ios).toEqual([
      'admin',
      'subscriptions',
      'effective-entitlements',
      SUB,
      'ios',
    ]);
  });

  it('does not fire without a subscription id', () => {
    renderHook(() => useEffectiveEntitlements('', 'web'), {
      wrapper: createWrapper(),
    });

    expect(apiClient.get).not.toHaveBeenCalled();
  });
});

describe('useStoredEntitlementKeyCounts', () => {
  it('unwraps the envelope and narrows by plan code', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      success: true,
      data: { aiAnswers: { count: 9, values: [{ value: 0, count: 9 }] } },
    });

    const { result } = renderHook(() => useStoredEntitlementKeyCounts('free'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiClient.get).toHaveBeenCalledWith(
      '/admin/subscriptions/entitlements-json/stored-key-counts?planCode=free',
    );
    expect(result.current.data?.aiAnswers.count).toBe(9);
  });

  it('omits the query string when no plan code is given', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ success: true, data: {} });

    renderHook(() => useStoredEntitlementKeyCounts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(apiClient.get).toHaveBeenCalledWith(
        '/admin/subscriptions/entitlements-json/stored-key-counts',
      ),
    );
  });
});

describe('entitlements_json mutations', () => {
  it('PATCHes values to the subscription', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({ success: true, data: {} });

    const { result } = renderHook(() => useSetEntitlementsJson(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: SUB, data: { values: { aiAnswers: 15 } } });

    await waitFor(() =>
      expect(apiClient.patch).toHaveBeenCalledWith(
        `/admin/subscriptions/${SUB}/entitlements-json`,
        { values: { aiAnswers: 15 } },
      ),
    );
  });

  it('DELETEs a single key, url-encoded', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({ success: true, data: {} });

    const { result } = renderHook(() => useClearEntitlementsJsonKey(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: SUB, key: 'aiAnswers' });

    await waitFor(() =>
      expect(apiClient.delete).toHaveBeenCalledWith(
        `/admin/subscriptions/${SUB}/entitlements-json/aiAnswers`,
      ),
    );
  });

  it('POSTs a prune and unwraps the affected count', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      success: true,
      data: {
        key: 'aiAnswers',
        valueEquals: 0,
        affectedCount: 9,
        subscriptionIds: ['s1'],
      },
    });

    const { result } = renderHook(() => usePruneEntitlementsJson(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ key: 'aiAnswers', valueEquals: 0 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiClient.post).toHaveBeenCalledWith(
      '/admin/subscriptions/entitlements-json/prune',
      { key: 'aiAnswers', valueEquals: 0 },
    );
    expect(result.current.data?.affectedCount).toBe(9);
  });
});
