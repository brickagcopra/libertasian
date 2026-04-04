import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import {
  useLikePost,
  useUnlikePost,
  useBookmarkPost,
  useUnbookmarkPost,
  useReportPost,
} from './use-feed-interactions';

const mockPost = vi.mocked(apiClient.post);
const mockDelete = vi.mocked(apiClient.delete);

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

describe('useLikePost', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockDelete.mockReset();
  });

  it('calls POST /feed/posts/:id/like', async () => {
    mockPost.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useLikePost(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('post-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/feed/posts/post-1/like');
  });
});

describe('useUnlikePost', () => {
  beforeEach(() => mockDelete.mockReset());

  it('calls DELETE /feed/posts/:id/like', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useUnlikePost(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('post-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/feed/posts/post-1/like');
  });
});

describe('useBookmarkPost', () => {
  beforeEach(() => mockPost.mockReset());

  it('calls POST /feed/posts/:id/bookmark', async () => {
    mockPost.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useBookmarkPost(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('post-2');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/feed/posts/post-2/bookmark');
  });
});

describe('useUnbookmarkPost', () => {
  beforeEach(() => mockDelete.mockReset());

  it('calls DELETE /feed/posts/:id/bookmark', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useUnbookmarkPost(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('post-2');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/feed/posts/post-2/bookmark');
  });
});

describe('useReportPost', () => {
  beforeEach(() => mockPost.mockReset());

  it('calls POST /feed/posts/:id/report with reason and details', async () => {
    mockPost.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useReportPost(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        postId: 'post-3',
        reason: 'spam' as const,
        details: 'This is spam',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/feed/posts/post-3/report', {
      reason: 'spam',
      details: 'This is spam',
    });
  });

  it('submits without details', async () => {
    mockPost.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useReportPost(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        postId: 'post-4',
        reason: 'harassment' as const,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/feed/posts/post-4/report', {
      reason: 'harassment',
      details: undefined,
    });
  });
});
