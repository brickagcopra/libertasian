import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';

import {
  useRatings,
  useMyRating,
  useUpsertRating,
  useDeleteRating,
} from './use-community-ratings';

jest.mock('../../../lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockDelete = apiClient.delete as jest.MockedFunction<typeof apiClient.delete>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

const mockRatingsResponse = {
  success: true,
  data: [
    {
      id: 'r-1',
      userId: 'u-1',
      entityType: 'flashcard_set' as const,
      entityId: 'fs-1',
      score: 5,
      reviewTitle: 'Great set',
      reviewBody: 'Very helpful',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
      user: { id: 'u-1', fullName: 'Juan' },
    },
  ],
  meta: { hasNext: false, nextCursor: null },
  aggregate: { avgRating: 4.5, ratingCount: 10, distribution: { 5: 6, 4: 3, 3: 1 } },
};

const mockMyRatingResponse = {
  success: true,
  data: {
    id: 'r-1',
    userId: 'u-1',
    entityType: 'flashcard_set' as const,
    entityId: 'fs-1',
    score: 4,
    reviewTitle: null,
    reviewBody: null,
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useRatings', () => {
  it('fetches ratings with correct endpoint and params', async () => {
    mockGet.mockResolvedValueOnce(mockRatingsResponse);

    const { result } = renderHook(
      () => useRatings('flashcard_set', 'fs-1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith(
      '/community/ratings/flashcard_set/fs-1',
      { params: { limit: '20' } },
    );
    expect(result.current.data).toEqual(mockRatingsResponse);
  });

  it('passes cursor param when provided', async () => {
    mockGet.mockResolvedValueOnce(mockRatingsResponse);

    renderHook(
      () => useRatings('digest', 'd-1', { cursor: 'xyz', limit: 10 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    expect(mockGet).toHaveBeenCalledWith(
      '/community/ratings/digest/d-1',
      { params: { limit: '10', cursor: 'xyz' } },
    );
  });

  it('is disabled when entityId is empty', () => {
    const { result } = renderHook(
      () => useRatings('flashcard_set', ''),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('useMyRating', () => {
  it('fetches user rating from the correct endpoint', async () => {
    mockGet.mockResolvedValueOnce(mockMyRatingResponse);

    const { result } = renderHook(
      () => useMyRating('flashcard_set', 'fs-1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith(
      '/community/ratings/mine/flashcard_set/fs-1',
    );
  });

  it('is disabled when entityId is empty', () => {
    const { result } = renderHook(
      () => useMyRating('flashcard_set', ''),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useUpsertRating', () => {
  it('posts rating data to the correct endpoint', async () => {
    const mockResponse = { success: true, data: { ...mockMyRatingResponse.data, score: 5 } };
    mockPost.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useUpsertRating(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        entityType: 'flashcard_set',
        entityId: 'fs-1',
        score: 5,
        reviewTitle: 'Amazing',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/community/ratings', {
      entityType: 'flashcard_set',
      entityId: 'fs-1',
      score: 5,
      reviewTitle: 'Amazing',
    });
  });

  it('handles mutation error', async () => {
    mockPost.mockRejectedValueOnce(new Error('Validation failed'));

    const { result } = renderHook(() => useUpsertRating(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        entityType: 'flashcard_set',
        entityId: 'fs-1',
        score: 0,
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Validation failed');
  });
});

describe('useDeleteRating', () => {
  it('calls delete endpoint with rating ID', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useDeleteRating(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        ratingId: 'r-1',
        entityType: 'flashcard_set',
        entityId: 'fs-1',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDelete).toHaveBeenCalledWith('/community/ratings/r-1');
  });

  it('handles delete error', async () => {
    mockDelete.mockRejectedValueOnce(new Error('Not found'));

    const { result } = renderHook(() => useDeleteRating(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        ratingId: 'r-999',
        entityType: 'flashcard_set',
        entityId: 'fs-1',
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
