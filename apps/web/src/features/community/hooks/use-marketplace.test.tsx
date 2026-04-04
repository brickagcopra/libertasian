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
  useMarketplaceFlashcardSets,
  useMarketplaceReviewerPacks,
  useMarketplaceDigests,
  useMarketplaceFeatured,
  useContributorProfile,
} from './use-marketplace';

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

const makeListResponse = (count = 2) => ({
  success: true,
  data: {
    items: Array.from({ length: count }, (_, i) => ({
      id: `item-${i}`,
      title: `Item ${i}`,
      contentType: 'flashcard_set',
      creator: { id: 'u1', fullName: 'Test User', expertVerification: null },
      avgRating: 4.5,
      ratingCount: 10,
      itemCount: 20,
      voteScore: 0,
      barSubject: null,
      topic: null,
      description: null,
      createdAt: '2026-01-01T00:00:00Z',
    })),
    hasNext: false,
    nextCursor: null,
  },
});

describe('useMarketplaceFlashcardSets', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches flashcard sets with default limit', async () => {
    mockGet.mockResolvedValueOnce(makeListResponse());

    const { result } = renderHook(() => useMarketplaceFlashcardSets(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith(
      '/community/marketplace/flashcard-sets',
      { params: { limit: '20' } },
    );
    expect(result.current.data?.data.items).toHaveLength(2);
  });

  it('passes search, barSubject, sortBy, and cursor params', async () => {
    mockGet.mockResolvedValueOnce(makeListResponse(1));

    const { result } = renderHook(
      () =>
        useMarketplaceFlashcardSets({
          search: 'civil',
          barSubject: 'civil_law',
          sortBy: 'top_rated',
          cursor: 'abc',
          limit: 10,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith(
      '/community/marketplace/flashcard-sets',
      {
        params: {
          limit: '10',
          search: 'civil',
          barSubject: 'civil_law',
          sortBy: 'top_rated',
          cursor: 'abc',
        },
      },
    );
  });

  it('omits undefined optional params', async () => {
    mockGet.mockResolvedValueOnce(makeListResponse());

    const { result } = renderHook(
      () => useMarketplaceFlashcardSets({ limit: 5 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const callParams = mockGet.mock.calls[0]?.[1] as { params: Record<string, string> };
    expect(callParams.params).toEqual({ limit: '5' });
    expect(callParams.params).not.toHaveProperty('search');
    expect(callParams.params).not.toHaveProperty('cursor');
  });
});

describe('useMarketplaceReviewerPacks', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches reviewer packs from correct endpoint', async () => {
    mockGet.mockResolvedValueOnce(makeListResponse());

    const { result } = renderHook(() => useMarketplaceReviewerPacks(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith(
      '/community/marketplace/reviewer-packs',
      { params: { limit: '20' } },
    );
  });

  it('passes all filter params', async () => {
    mockGet.mockResolvedValueOnce(makeListResponse());

    const { result } = renderHook(
      () =>
        useMarketplaceReviewerPacks({
          search: 'remedial',
          sortBy: 'newest',
          barSubject: 'remedial_law',
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith(
      '/community/marketplace/reviewer-packs',
      {
        params: {
          limit: '20',
          search: 'remedial',
          sortBy: 'newest',
          barSubject: 'remedial_law',
        },
      },
    );
  });
});

describe('useMarketplaceDigests', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches digests from correct endpoint', async () => {
    mockGet.mockResolvedValueOnce(makeListResponse());

    const { result } = renderHook(() => useMarketplaceDigests(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith(
      '/community/marketplace/digests',
      { params: { limit: '20' } },
    );
  });

  it('applies trending sort', async () => {
    mockGet.mockResolvedValueOnce(makeListResponse());

    renderHook(
      () => useMarketplaceDigests({ sortBy: 'trending' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith(
        '/community/marketplace/digests',
        { params: { limit: '20', sortBy: 'trending' } },
      ),
    );
  });
});

describe('useMarketplaceFeatured', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches featured content', async () => {
    const featured = {
      success: true,
      data: {
        flashcardSets: [{ id: 'fs1', title: 'Set 1' }],
        reviewerPacks: [{ id: 'rp1', title: 'Pack 1' }],
        digests: [{ id: 'd1', title: 'Digest 1' }],
      },
    };
    mockGet.mockResolvedValueOnce(featured);

    const { result } = renderHook(() => useMarketplaceFeatured(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/community/marketplace/featured');
    expect(result.current.data?.data.flashcardSets).toHaveLength(1);
  });

  it('handles error state', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useMarketplaceFeatured(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe('Network error');
  });
});

describe('useContributorProfile', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches contributor profile by userId', async () => {
    const profile = {
      success: true,
      data: {
        id: 'u1',
        fullName: 'Juan Dela Cruz',
        flashcardSetCount: 5,
        reviewerPackCount: 3,
        digestCount: 10,
        avgRating: 4.2,
        totalRatingsReceived: 50,
        expertVerification: null,
        joinedAt: '2025-06-01T00:00:00Z',
      },
    };
    mockGet.mockResolvedValueOnce(profile);

    const { result } = renderHook(() => useContributorProfile('u1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/community/contributors/u1');
    expect(result.current.data?.data.fullName).toBe('Juan Dela Cruz');
  });

  it('does not fetch when userId is empty', () => {
    const { result } = renderHook(() => useContributorProfile(''), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('handles API error gracefully', async () => {
    mockGet.mockRejectedValueOnce(new Error('Not found'));

    const { result } = renderHook(() => useContributorProfile('invalid'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
