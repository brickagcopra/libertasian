import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import { useAiAnswer } from './use-ai-answer';

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

describe('useAiAnswer', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it('does not fetch when query is null', () => {
    const { result } = renderHook(() => useAiAnswer(null, true), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('does not fetch when enabled is false', () => {
    const { result } = renderHook(() => useAiAnswer('test query', false), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('does not fetch when both query is null and enabled is false', () => {
    const { result } = renderHook(() => useAiAnswer(null, false), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('fetches AI answer when query is provided and enabled', async () => {
    const mockResponse = {
      success: true,
      data: {
        answer: 'The Supreme Court held...',
        sources: [
          {
            document_id: 'doc-1',
            title: 'Test Case',
            relevance_score: 0.9,
            passage_text: 'Relevant text...',
          },
        ],
        confidence: 0.85,
        abstained: false,
      },
      meta: { quota: { used: 5, limit: 200, remaining: 195 } },
    };
    mockPost.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(
      () => useAiAnswer('hearsay evidence', true),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockPost).toHaveBeenCalledWith('/ai-answers', {
      query: 'hearsay evidence',
    });
    expect(result.current.data).toEqual(mockResponse);
  });

  it('includes query in queryKey for cache isolation', async () => {
    mockPost.mockResolvedValue({
      success: true,
      data: { answer: 'Answer', sources: [], confidence: 0.9, abstained: false },
      meta: { quota: { used: 1, limit: 200, remaining: 199 } },
    });

    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useAiAnswer(query, true),
      {
        wrapper: createWrapper(),
        initialProps: { query: 'query A' },
      },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Rerender with different query should trigger new fetch
    rerender({ query: 'query B' });

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));

    expect(mockPost).toHaveBeenCalledWith('/ai-answers', { query: 'query A' });
    expect(mockPost).toHaveBeenCalledWith('/ai-answers', { query: 'query B' });
  });

  it('handles API error gracefully', async () => {
    mockPost.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(
      () => useAiAnswer('test', true),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeDefined();
  });
});
