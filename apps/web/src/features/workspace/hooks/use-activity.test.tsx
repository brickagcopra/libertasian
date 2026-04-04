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
import { useActivity } from './use-activity';

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

describe('useActivity', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches activity with default limit', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [{ id: 'act1', action: 'created', entityType: 'matter' }],
      meta: { hasNext: false },
    });

    const { result } = renderHook(() => useActivity(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/activity', {
      params: { limit: '20' },
    });
  });

  it('passes entityType, actorUserId, and cursor params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [], meta: {} });

    renderHook(
      () =>
        useActivity({
          entityType: 'matter',
          actorUserId: 'u1',
          cursor: 'c1',
          limit: 10,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/activity', {
        params: {
          limit: '10',
          entityType: 'matter',
          actorUserId: 'u1',
          cursor: 'c1',
        },
      }),
    );
  });

  it('omits undefined optional params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [], meta: {} });

    renderHook(() => useActivity({ limit: 5 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      const callParams = mockGet.mock.calls[0]?.[1] as { params: Record<string, string> };
      expect(callParams.params).toEqual({ limit: '5' });
      expect(callParams.params).not.toHaveProperty('entityType');
    });
  });

  it('handles error state', async () => {
    mockGet.mockRejectedValueOnce(new Error('Server error'));

    const { result } = renderHook(() => useActivity(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
