import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import { useMyVote, useUpsertVote, useRemoveVote } from './use-community-votes';

const mockGet = vi.mocked(apiClient.get);
const mockPut = vi.mocked(apiClient.put);
const mockDelete = vi.mocked(apiClient.delete);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const mockVote = {
  id: 'v1',
  entityType: 'digest',
  entityId: 'd1',
  userId: 'u1',
  voteType: 'up' as const,
  createdAt: '2026-01-01T00:00:00Z',
};

describe('useMyVote', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPut.mockReset();
    mockDelete.mockReset();
  });

  it('fetches current user vote for an entity', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: mockVote });

    const { result } = renderHook(
      () => useMyVote('digest', 'd1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/community/votes/mine/digest/d1');
    expect(result.current.data?.data?.voteType).toBe('up');
  });

  it('returns null when no vote exists', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: null });

    const { result } = renderHook(
      () => useMyVote('digest', 'd2'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.data).toBeNull();
  });

  it('does not fetch when entityId is empty', () => {
    const { result } = renderHook(
      () => useMyVote('digest', ''),
      { wrapper: createWrapper() },
    );

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('handles API error', async () => {
    mockGet.mockRejectedValueOnce(new Error('Server error'));

    const { result } = renderHook(
      () => useMyVote('digest', 'd1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useUpsertVote', () => {
  beforeEach(() => {
    mockPut.mockReset();
  });

  it('creates an upvote via PUT', async () => {
    mockPut.mockResolvedValueOnce({ success: true, data: mockVote });

    const { result } = renderHook(() => useUpsertVote(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        entityType: 'digest',
        entityId: 'd1',
        voteType: 'up',
      });
    });

    expect(mockPut).toHaveBeenCalledWith(
      '/community/votes/digest/d1',
      { voteType: 'up' },
    );
  });

  it('creates a downvote', async () => {
    const downVote = { ...mockVote, voteType: 'down' };
    mockPut.mockResolvedValueOnce({ success: true, data: downVote });

    const { result } = renderHook(() => useUpsertVote(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        entityType: 'digest',
        entityId: 'd1',
        voteType: 'down',
      });
    });

    expect(mockPut).toHaveBeenCalledWith(
      '/community/votes/digest/d1',
      { voteType: 'down' },
    );
  });

  it('handles error on upsert', async () => {
    mockPut.mockRejectedValueOnce(new Error('Forbidden'));

    const { result } = renderHook(() => useUpsertVote(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          entityType: 'digest',
          entityId: 'd1',
          voteType: 'up',
        });
      }),
    ).rejects.toThrow('Forbidden');
  });
});

describe('useRemoveVote', () => {
  beforeEach(() => {
    mockDelete.mockReset();
  });

  it('removes a vote via DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useRemoveVote(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        entityType: 'digest',
        entityId: 'd1',
      });
    });

    expect(mockDelete).toHaveBeenCalledWith('/community/votes/digest/d1');
  });

  it('handles error on remove', async () => {
    mockDelete.mockRejectedValueOnce(new Error('Not found'));

    const { result } = renderHook(() => useRemoveVote(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          entityType: 'digest',
          entityId: 'invalid',
        });
      }),
    ).rejects.toThrow('Not found');
  });
});
