import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * These two behaviours are what make the derivatives admin page feel alive:
 * a dispatch must refresh the stat cards, and the auto-promote counters must
 * advance on their own. Both were broken — the backfill mutation invalidated
 * a key nothing was registered under, and the status query had no polling
 * interval — so the page showed pre-dispatch numbers until a manual reload.
 */

const mockGet = vi.hoisted(() => vi.fn());
const mockPost = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: vi.fn(),
    delete: vi.fn(),
    put: vi.fn(),
  },
}));

import { useDerivativeStats } from './use-derivatives-admin';
import { useAutoPromoteStatus, useBackfillMissingDerivatives } from './use-admin';

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function countCalls(url: string) {
  return mockGet.mock.calls.filter((c) => c[0] === url).length;
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockGet.mockResolvedValue({
    success: true,
    data: { byType: [], globalEnabled: true, typesEnabled: {} },
  });
  mockPost.mockResolvedValue({
    success: true,
    data: {
      dispatchedByType: {},
      totalDispatched: 3,
      remainingByType: {},
      totalRemaining: 0,
    },
  });
});

describe('derivative stats refresh after a dispatch', () => {
  it('refetches /admin/derivatives/stats when the backfill mutation succeeds', async () => {
    const client = newClient();
    const w = wrapper(client);

    const stats = renderHook(() => useDerivativeStats(), { wrapper: w });
    const backfill = renderHook(() => useBackfillMissingDerivatives(), {
      wrapper: w,
    });

    await waitFor(() => expect(stats.result.current.isSuccess).toBe(true));
    expect(countCalls('/admin/derivatives/stats')).toBe(1);

    await act(async () => {
      await backfill.result.current.mutateAsync({ limit: 10 });
    });

    await waitFor(() =>
      expect(countCalls('/admin/derivatives/stats')).toBeGreaterThan(1),
    );
  });
});

describe('useAutoPromoteStatus polling', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refetches on the same 30s cadence as the stat cards', async () => {
    // shouldAdvanceTime keeps waitFor's own real-timer polling alive while
    // react-query's refetch interval runs on the fake clock.
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const client = newClient();
    const status = renderHook(() => useAutoPromoteStatus(), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(status.result.current.isSuccess).toBe(true));
    expect(countCalls('/admin/auto-promote/status')).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });

    expect(countCalls('/admin/auto-promote/status')).toBeGreaterThan(1);
  });
});
