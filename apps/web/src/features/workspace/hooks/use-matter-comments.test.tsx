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
import {
  useMatterComments,
  useCreateMatterComment,
  useDeleteMatterComment,
} from './use-matter-comments';

const mockGet = vi.mocked(apiClient.get);
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

describe('useMatterComments', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockDelete.mockReset();
  });

  it('fetches comments for a matter', async () => {
    const comments = [
      { id: 'mc1', body: 'Need to review', userId: 'u1' },
      { id: 'mc2', body: 'Done reviewing', userId: 'u2' },
    ];
    mockGet.mockResolvedValueOnce({ success: true, data: comments });

    const { result } = renderHook(() => useMatterComments('m1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/matters/m1/comments');
    expect(result.current.data).toEqual(comments);
  });

  it('is disabled when matterId is null', () => {
    const { result } = renderHook(() => useMatterComments(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('handles error state', async () => {
    mockGet.mockRejectedValueOnce(new Error('Not found'));

    const { result } = renderHook(() => useMatterComments('m1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useCreateMatterComment', () => {
  beforeEach(() => mockPost.mockReset());

  it('creates a matter comment via POST', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: { id: 'mc3', body: 'New comment', userId: 'u1' },
    });

    const { result } = renderHook(() => useCreateMatterComment(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ matterId: 'm1', body: 'New comment' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/matters/m1/comments', {
      body: 'New comment',
    });
  });

  it('handles creation error', async () => {
    mockPost.mockRejectedValueOnce(new Error('Bad request'));

    const { result } = renderHook(() => useCreateMatterComment(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ matterId: 'm1', body: '' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useDeleteMatterComment', () => {
  beforeEach(() => mockDelete.mockReset());

  it('deletes a matter comment via DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useDeleteMatterComment(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ matterId: 'm1', commentId: 'mc1' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDelete).toHaveBeenCalledWith('/matters/m1/comments/mc1');
  });
});
