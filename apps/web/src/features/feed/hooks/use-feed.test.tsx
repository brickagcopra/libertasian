import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import {
  usePublicFeed,
  useOrganizationFeed,
  useUserProfileFeed,
  useBookmarkedPosts,
} from './use-feed';

const mockGet = vi.mocked(apiClient.get);

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

const makeFeedResponse = (count = 2, hasNext = false) => ({
  success: true,
  data: Array.from({ length: count }, (_, i) => ({
    id: `post-${i}`,
    textContent: `Post ${i}`,
    author: { id: 'u1', fullName: 'Test User' },
    likeCount: 0,
    commentCount: 0,
    bookmarkCount: 0,
  })),
  meta: { hasNext, nextCursor: hasNext ? 'cursor-abc' : null },
});

describe('usePublicFeed', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches public feed from /feed endpoint', async () => {
    mockGet.mockResolvedValueOnce(makeFeedResponse());
    const { result } = renderHook(() => usePublicFeed(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/feed', {
      params: { limit: '20' },
    });
    expect(result.current.data?.pages[0].data).toHaveLength(2);
  });

  it('supports pagination with cursor', async () => {
    mockGet.mockResolvedValueOnce(makeFeedResponse(2, true));
    const { result } = renderHook(() => usePublicFeed(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
  });

  it('returns hasNextPage=false when no more pages', async () => {
    mockGet.mockResolvedValueOnce(makeFeedResponse(2, false));
    const { result } = renderHook(() => usePublicFeed(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });
});

describe('useOrganizationFeed', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches from /feed/organization', async () => {
    mockGet.mockResolvedValueOnce(makeFeedResponse());
    const { result } = renderHook(() => useOrganizationFeed(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/feed/organization', {
      params: { limit: '20' },
    });
  });
});

describe('useUserProfileFeed', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches from /feed/user/:userId', async () => {
    mockGet.mockResolvedValueOnce(makeFeedResponse());
    const { result } = renderHook(() => useUserProfileFeed('user-42'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/feed/user/user-42', {
      params: { limit: '20' },
    });
  });

  it('does not fetch when userId is empty', () => {
    renderHook(() => useUserProfileFeed(''), {
      wrapper: createWrapper(),
    });
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('useBookmarkedPosts', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches from /feed/bookmarks', async () => {
    mockGet.mockResolvedValueOnce(makeFeedResponse());
    const { result } = renderHook(() => useBookmarkedPosts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/feed/bookmarks', {
      params: { limit: '20' },
    });
  });
});
