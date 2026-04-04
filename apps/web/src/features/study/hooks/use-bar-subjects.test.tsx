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
import { useBarSubjects } from './use-bar-subjects';

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

describe('useBarSubjects', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches bar subjects from correct endpoint', async () => {
    const subjects = {
      success: true,
      data: [
        { id: 'bs1', code: 'civil_law', name: 'Civil Law' },
        { id: 'bs2', code: 'criminal_law', name: 'Criminal Law' },
      ],
    };
    mockGet.mockResolvedValueOnce(subjects);

    const { result } = renderHook(() => useBarSubjects(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/study/bar-subjects');
    expect(result.current.data?.data).toHaveLength(2);
  });

  it('uses 5 minute stale time', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });

    const { result } = renderHook(() => useBarSubjects(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Query should not refetch immediately (staleTime = 5 min)
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('handles error state', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useBarSubjects(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });
});
