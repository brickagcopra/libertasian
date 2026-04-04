import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import { useCreatePost } from './use-create-post';

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

describe('useCreatePost', () => {
  beforeEach(() => mockPost.mockReset());

  it('calls POST /feed/posts with body', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: { id: 'post-new', textContent: 'My post' },
    });

    const { result } = renderHook(() => useCreatePost(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        textContent: 'My post',
        visibility: 'organization',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/feed/posts', {
      textContent: 'My post',
      visibility: 'organization',
    });
  });

  it('sends mediaId when provided', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'p1' } });

    const { result } = renderHook(() => useCreatePost(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        textContent: 'With image',
        mediaId: 'media-1',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/feed/posts', {
      textContent: 'With image',
      mediaId: 'media-1',
    });
  });

  it('handles API error', async () => {
    mockPost.mockRejectedValueOnce(new Error('Server error'));

    const { result } = renderHook(() => useCreatePost(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ textContent: 'Fail' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeTruthy();
  });
});
