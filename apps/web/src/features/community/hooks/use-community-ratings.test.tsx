import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import { useRatings, useMyRating, useUpsertRating, useDeleteRating } from './use-community-ratings';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
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

const mockRating = {
  id: 'r1',
  entityType: 'flashcard_set' as const,
  entityId: 'fs1',
  userId: 'u1',
  score: 4,
  reviewTitle: 'Great set',
  reviewBody: 'Very helpful',
  createdAt: '2026-01-01T00:00:00Z',
  user: { id: 'u1', fullName: 'Test User' },
};

describe('useRatings', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockDelete.mockReset();
  });

  it('fetches ratings for an entity with default limit', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [mockRating],
      meta: { hasNext: false, nextCursor: null },
      aggregate: { avgRating: 4.0, ratingCount: 1, distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 } },
    });

    const { result } = renderHook(
      () => useRatings('flashcard_set', 'fs1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith(
      '/community/ratings/flashcard_set/fs1',
      { params: { limit: '20' } },
    );
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.aggregate?.avgRating).toBe(4.0);
  });

  it('passes cursor and limit params', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { hasNext: false, nextCursor: null },
      aggregate: { avgRating: null, ratingCount: 0, distribution: {} },
    });

    renderHook(
      () => useRatings('reviewer_pack', 'rp1', { cursor: 'abc', limit: 10 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith(
        '/community/ratings/reviewer_pack/rp1',
        { params: { limit: '10', cursor: 'abc' } },
      ),
    );
  });

  it('does not fetch when entityId is empty', () => {
    const { result } = renderHook(
      () => useRatings('flashcard_set', ''),
      { wrapper: createWrapper() },
    );

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('useMyRating', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches current user rating', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: mockRating });

    const { result } = renderHook(
      () => useMyRating('flashcard_set', 'fs1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/community/ratings/mine/flashcard_set/fs1');
    expect(result.current.data?.data?.score).toBe(4);
  });

  it('returns null data when no rating exists', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: null });

    const { result } = renderHook(
      () => useMyRating('digest', 'd1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.data).toBeNull();
  });

  it('does not fetch when entityId is empty', () => {
    const { result } = renderHook(
      () => useMyRating('flashcard_set', ''),
      { wrapper: createWrapper() },
    );

    expect(result.current.isFetching).toBe(false);
  });
});

describe('useUpsertRating', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it('posts a new rating and invalidates queries', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: mockRating });

    const { result } = renderHook(() => useUpsertRating(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        entityType: 'flashcard_set',
        entityId: 'fs1',
        score: 4,
        reviewTitle: 'Great set',
      });
    });

    expect(mockPost).toHaveBeenCalledWith('/community/ratings', {
      entityType: 'flashcard_set',
      entityId: 'fs1',
      score: 4,
      reviewTitle: 'Great set',
    });
  });

  it('handles API error on upsert', async () => {
    mockPost.mockRejectedValueOnce(new Error('Forbidden'));

    const { result } = renderHook(() => useUpsertRating(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          entityType: 'flashcard_set',
          entityId: 'fs1',
          score: 5,
        });
      }),
    ).rejects.toThrow('Forbidden');
  });
});

describe('useDeleteRating', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockDelete.mockReset();
  });

  it('deletes a rating by id', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useDeleteRating(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        ratingId: 'r1',
        entityType: 'flashcard_set',
        entityId: 'fs1',
      });
    });

    expect(mockDelete).toHaveBeenCalledWith('/community/ratings/r1');
  });

  it('handles delete error', async () => {
    mockDelete.mockRejectedValueOnce(new Error('Not found'));

    const { result } = renderHook(() => useDeleteRating(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          ratingId: 'invalid',
          entityType: 'flashcard_set',
          entityId: 'fs1',
        });
      }),
    ).rejects.toThrow('Not found');
  });
});
