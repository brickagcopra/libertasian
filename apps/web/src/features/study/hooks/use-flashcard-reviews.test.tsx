import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import {
  useFlashcardReviewStats,
  useSubmitFlashcardReview,
} from './use-flashcard-reviews';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);

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

describe('useFlashcardReviewStats', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches review stats for a flashcard set', async () => {
    const stats = {
      totalCards: 20,
      dueCards: 5,
      newCards: 3,
      reviewedToday: 12,
    };
    mockGet.mockResolvedValueOnce({ success: true, data: stats });

    const { result } = renderHook(() => useFlashcardReviewStats('set1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/study/flashcard-sets/set1/review-stats');
    expect(result.current.data).toEqual(stats);
  });

  it('is disabled when setId is empty', () => {
    const { result } = renderHook(() => useFlashcardReviewStats(''), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('handles error state', async () => {
    mockGet.mockRejectedValueOnce(new Error('Server error'));

    const { result } = renderHook(() => useFlashcardReviewStats('set1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useSubmitFlashcardReview', () => {
  beforeEach(() => mockPost.mockReset());

  it('submits a flashcard review via POST', async () => {
    const review = {
      id: 'rev1',
      flashcardId: 'fc1',
      quality: 4,
      nextReviewAt: '2026-03-25T00:00:00Z',
    };
    mockPost.mockResolvedValueOnce({ success: true, data: review });

    const { result } = renderHook(() => useSubmitFlashcardReview(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        flashcardId: 'fc1',
        input: { quality: 4, responseTimeMs: 3000 },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/study/flashcards/fc1/review', {
      quality: 4,
      responseTimeMs: 3000,
    });
    expect(result.current.data).toEqual(review);
  });

  it('handles review submission error', async () => {
    mockPost.mockRejectedValueOnce(new Error('Card not found'));

    const { result } = renderHook(() => useSubmitFlashcardReview(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        flashcardId: 'missing',
        input: { quality: 3, responseTimeMs: 2000 },
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
