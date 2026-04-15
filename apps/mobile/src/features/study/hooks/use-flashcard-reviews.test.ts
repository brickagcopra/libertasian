import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useFlashcardReviewStats, useSubmitFlashcardReview } from './use-flashcard-reviews';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useFlashcardReviewStats', () => {
  it('fetches review stats for a set', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { totalCards: 25, dueCards: 5 } });
    const { result } = renderHook(() => useFlashcardReviewStats('set-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/study/flashcard-sets/set-1/review-stats');
    expect(result.current.data).toEqual({ totalCards: 25, dueCards: 5 });
  });

  it('is disabled when setId is empty', () => {
    const { result } = renderHook(() => useFlashcardReviewStats(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('handles errors', async () => {
    mockGet.mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useFlashcardReviewStats('set-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useSubmitFlashcardReview', () => {
  it('posts review to correct endpoint', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'r1', quality: 4 } });
    const { result } = renderHook(() => useSubmitFlashcardReview(), { wrapper: createWrapper() });
    await act(async () => {
      result.current.mutate({ flashcardId: 'c1', input: { response: 'good' } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/study/flashcards/c1/review', { response: 'good' });
  });

  it('handles errors', async () => {
    mockPost.mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useSubmitFlashcardReview(), { wrapper: createWrapper() });
    await act(async () => {
      result.current.mutate({ flashcardId: 'c1', input: { response: 'hard' } });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
