import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';

import {
  useMarketplaceFlashcardSets,
  useMarketplaceReviewerPacks,
  useMarketplaceDigests,
  useMarketplaceFeatured,
  useContributorProfile,
} from './use-marketplace';

jest.mock('../../../lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
  },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

const mockListResponse = {
  success: true,
  data: {
    items: [
      {
        id: 'item-1',
        contentType: 'flashcard_set' as const,
        title: 'Criminal Law Set',
        description: null,
        barSubject: 'criminal_law',
        topic: null,
        avgRating: 4.5,
        ratingCount: 10,
        itemCount: 25,
        creator: {
          id: 'user-1',
          fullName: 'Juan',
          expertVerification: null,
        },
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-01T00:00:00Z',
      },
    ],
    hasNext: false,
    nextCursor: null,
  },
};

const mockFeaturedResponse = {
  success: true,
  data: {
    flashcardSets: [],
    reviewerPacks: [],
    digests: [],
  },
};

const mockContributorResponse = {
  success: true,
  data: {
    user: { id: 'user-1', fullName: 'Juan', createdAt: '2026-01-01T00:00:00Z' },
    expertVerification: null,
    stats: {
      flashcardSetCount: 5,
      reviewerPackCount: 2,
      digestCount: 10,
      totalRatingsReceived: 15,
      avgRating: 4.2,
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useMarketplaceFlashcardSets', () => {
  it('fetches flashcard sets from the correct endpoint', async () => {
    mockGet.mockResolvedValueOnce(mockListResponse);

    const { result } = renderHook(() => useMarketplaceFlashcardSets(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith(
      '/community/marketplace/flashcard-sets',
      { params: { limit: '20' } },
    );
    expect(result.current.data).toEqual(mockListResponse);
  });

  it('passes search and filter params', async () => {
    mockGet.mockResolvedValueOnce(mockListResponse);

    renderHook(
      () =>
        useMarketplaceFlashcardSets({
          search: 'crim',
          barSubject: 'criminal_law',
          sortBy: 'top_rated',
          cursor: 'abc',
          limit: 10,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    expect(mockGet).toHaveBeenCalledWith(
      '/community/marketplace/flashcard-sets',
      {
        params: {
          limit: '10',
          cursor: 'abc',
          barSubject: 'criminal_law',
          search: 'crim',
          sortBy: 'top_rated',
        },
      },
    );
  });
});

describe('useMarketplaceReviewerPacks', () => {
  it('fetches reviewer packs from the correct endpoint', async () => {
    mockGet.mockResolvedValueOnce(mockListResponse);

    const { result } = renderHook(() => useMarketplaceReviewerPacks(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith(
      '/community/marketplace/reviewer-packs',
      { params: { limit: '20' } },
    );
  });

  it('passes query params correctly', async () => {
    mockGet.mockResolvedValueOnce(mockListResponse);

    renderHook(
      () =>
        useMarketplaceReviewerPacks({
          search: 'civil',
          sortBy: 'newest',
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    expect(mockGet).toHaveBeenCalledWith(
      '/community/marketplace/reviewer-packs',
      {
        params: expect.objectContaining({
          search: 'civil',
          sortBy: 'newest',
        }),
      },
    );
  });
});

describe('useMarketplaceDigests', () => {
  it('fetches digests from the correct endpoint', async () => {
    mockGet.mockResolvedValueOnce(mockListResponse);

    const { result } = renderHook(() => useMarketplaceDigests(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith(
      '/community/marketplace/digests',
      { params: { limit: '20' } },
    );
  });
});

describe('useMarketplaceFeatured', () => {
  it('fetches featured content', async () => {
    // GET /community/marketplace/featured is a bare { success, data }
    // envelope, so apiClient hands back `data` itself.
    mockGet.mockResolvedValueOnce(mockFeaturedResponse.data);

    const { result } = renderHook(() => useMarketplaceFeatured(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/community/marketplace/featured');
    expect(result.current.data).toEqual(mockFeaturedResponse.data);
  });
});

describe('useContributorProfile', () => {
  it('fetches contributor profile by user ID', async () => {
    mockGet.mockResolvedValueOnce(mockContributorResponse.data);

    const { result } = renderHook(
      () => useContributorProfile('user-1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/community/contributors/user-1');
    expect(result.current.data?.stats.flashcardSetCount).toBe(5);
  });

  it('is disabled when userId is empty', () => {
    const { result } = renderHook(
      () => useContributorProfile(''),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockGet).not.toHaveBeenCalled();
  });
});
