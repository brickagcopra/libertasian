import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import {
  useAutoPromoteStatus,
  useTriggerAutoPromoteSweep,
  AUTO_PROMOTE_STATUS_QUERY_KEY,
} from './use-pipeline-ops';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

function createWrapper(client?: QueryClient) {
  const queryClient = client ?? createTestQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('useAutoPromoteStatus', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches GET /admin/auto-promote/status with no params and unwraps data', async () => {
    const payload = {
      lastSweepAt: '2026-04-27T01:00:00.000Z',
      lastPromoted: 5,
      last24hPromoted: 7,
      totalPromoted: 220,
      configThreshold: 0.85,
      configExcludedTypes: ['mcq_question', 'subject_outline'],
    };
    mockGet.mockResolvedValueOnce({ success: true, data: payload });

    const { result } = renderHook(() => useAutoPromoteStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/admin/auto-promote/status');
    expect(result.current.data).toEqual(payload);
  });
});

describe('useTriggerAutoPromoteSweep', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it('calls POST /admin/auto-promote/sweep with no body and returns the unwrapped result', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: { promoted: 12, scanned: 30 },
    });

    const { result } = renderHook(() => useTriggerAutoPromoteSweep(), {
      wrapper: createWrapper(),
    });

    let returned: { promoted: number; scanned: number } | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync();
    });

    expect(mockPost).toHaveBeenCalledWith('/admin/auto-promote/sweep');
    expect(returned).toEqual({ promoted: 12, scanned: 30 });
  });

  it('invalidates the auto-promote status query on success', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    mockPost.mockResolvedValueOnce({
      success: true,
      data: { promoted: 1, scanned: 2 },
    });

    const { result } = renderHook(() => useTriggerAutoPromoteSweep(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: AUTO_PROMOTE_STATUS_QUERY_KEY,
    });
  });
});
