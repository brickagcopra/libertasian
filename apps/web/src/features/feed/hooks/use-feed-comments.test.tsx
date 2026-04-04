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
  },
}));

import { apiClient } from '@/lib/api-client';
import {
  useComments,
  useCreateComment,
  useUpdateComment,
  useDeleteComment,
  useLikeComment,
  useUnlikeComment,
} from './use-feed-comments';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockPatch = vi.mocked(apiClient.patch);
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

const makeCommentsResponse = (count = 2) => ({
  success: true,
  data: Array.from({ length: count }, (_, i) => ({
    id: `comment-${i}`,
    textContent: `Comment ${i}`,
    author: { id: 'u1', fullName: 'Commenter' },
    likeCount: 0,
    isLikedByMe: false,
    createdAt: new Date().toISOString(),
    editedAt: null,
    replies: [],
  })),
  meta: { hasNext: false, nextCursor: null },
});

describe('useComments', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches comments for a post', async () => {
    mockGet.mockResolvedValueOnce(makeCommentsResponse());
    const { result } = renderHook(() => useComments('post-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/feed/posts/post-1/comments', {
      params: { limit: '20' },
    });
    expect(result.current.data?.pages[0].data).toHaveLength(2);
  });

  it('does not fetch when postId is null', () => {
    renderHook(() => useComments(null), {
      wrapper: createWrapper(),
    });
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('useCreateComment', () => {
  beforeEach(() => mockPost.mockReset());

  it('posts a new comment', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: { id: 'c-new', textContent: 'New comment' },
    });

    const { result } = renderHook(() => useCreateComment(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        postId: 'post-1',
        textContent: 'New comment',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/feed/posts/post-1/comments', {
      textContent: 'New comment',
      parentId: undefined,
    });
  });

  it('creates reply with parentId', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'r1' } });

    const { result } = renderHook(() => useCreateComment(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        postId: 'post-1',
        textContent: 'Reply',
        parentId: 'comment-1',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/feed/posts/post-1/comments', {
      textContent: 'Reply',
      parentId: 'comment-1',
    });
  });
});

describe('useUpdateComment', () => {
  beforeEach(() => mockPatch.mockReset());

  it('patches comment text', async () => {
    mockPatch.mockResolvedValueOnce({ success: true, data: { id: 'c1' } });

    const { result } = renderHook(() => useUpdateComment(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        commentId: 'comment-1',
        textContent: 'Updated text',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPatch).toHaveBeenCalledWith('/feed/comments/comment-1', {
      textContent: 'Updated text',
    });
  });
});

describe('useDeleteComment', () => {
  beforeEach(() => mockDelete.mockReset());

  it('deletes a comment', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useDeleteComment(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('comment-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/feed/comments/comment-1');
  });
});

describe('useLikeComment', () => {
  beforeEach(() => mockPost.mockReset());

  it('likes a comment', async () => {
    mockPost.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useLikeComment(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('comment-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/feed/comments/comment-1/like');
  });
});

describe('useUnlikeComment', () => {
  beforeEach(() => mockDelete.mockReset());

  it('unlikes a comment', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useUnlikeComment(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('comment-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/feed/comments/comment-1/like');
  });
});
