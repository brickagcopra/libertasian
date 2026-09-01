import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseMarketplaceReviewerPacks = jest.fn();
jest.mock('@/features/community/hooks/use-marketplace', () => ({
  useMarketplaceReviewerPacks: (...args: unknown[]) => mockUseMarketplaceReviewerPacks(...args),
}));

jest.mock('@/features/community/components/marketplace-item-card', () => ({
  MarketplaceItemCard: ({ item }: { item: { title: string } }) => {
    const { Text } = require('react-native');
    return <Text>{item.title}</Text>;
  },
}));

import MarketplaceReviewerPacksScreen from '@/app/community/reviewer-packs/index';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('MarketplaceReviewerPacksScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows empty state', () => {
    mockUseMarketplaceReviewerPacks.mockReturnValue({
      data: { items: [], hasNext: false },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<MarketplaceReviewerPacksScreen />, { wrapper: createWrapper() });
    expect(getByText(/No reviewer packs/i)).toBeTruthy();
  });

  it('renders marketplace items', () => {
    mockUseMarketplaceReviewerPacks.mockReturnValue({
      data: {
        items: [
            {
              id: 'mrp-1',
              contentType: 'reviewer_pack',
              title: 'Bar Exam Reviewer',
              description: null,
              barSubject: null,
              topic: null,
              avgRating: 4.8,
              ratingCount: 25,
              itemCount: 15,
              creator: { id: 'u2', fullName: 'Maria', expertVerification: null },
              createdAt: '2024-01-01',
              updatedAt: '2024-01-01',
            },
        ],
        hasNext: false,
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<MarketplaceReviewerPacksScreen />, { wrapper: createWrapper() });
    expect(getByText('Bar Exam Reviewer')).toBeTruthy();
  });

  it('renders sort pills', () => {
    mockUseMarketplaceReviewerPacks.mockReturnValue({
      data: { items: [], hasNext: false },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<MarketplaceReviewerPacksScreen />, { wrapper: createWrapper() });
    expect(getByText(/Top Rated/i)).toBeTruthy();
  });
  /**
   * PAGING COMES FROM `meta`, AND THE ITEMS COME FROM `data`.
   *
   * The response is `{ success, data: MarketplaceItem[], meta: { hasNext,
   * nextCursor } }`. This screen used to read `data.data.items` — a field that
   * does not exist, because `data` IS the array — so the list rendered empty no
   * matter what the server returned, and the cursor under `meta` was never read
   * by anything.
   */
  it('renders the items the hook flattened, and pages when the list ends', () => {
    const fetchNextPage = jest.fn();
    mockUseMarketplaceReviewerPacks.mockReturnValue({
      data: { items: [{
        id: 'rp-1',
        contentType: 'reviewer_pack',
        title: 'Sample Item',
        description: null,
        barSubject: null,
        topic: null,
        avgRating: 4.2,
        ratingCount: 8,
        itemCount: 5,
        creator: { id: 'u3', fullName: 'Pedro', expertVerification: null },
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      }], hasNext: true },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
      fetchNextPage,
      hasNextPage: true,
      isFetchingNextPage: false,
    });

    const { UNSAFE_getByType } = render(<MarketplaceReviewerPacksScreen />, {
      wrapper: createWrapper(),
    });

    const { FlatList } = require('react-native');
    const list = UNSAFE_getByType(FlatList);

    // The list is populated at all — this was `[]` before the fix.
    expect(list.props.data).toHaveLength(1);
    expect(list.props.data[0].id).toBe('rp-1');

    list.props.onEndReached();
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('does not page past the last page the server reports', () => {
    const fetchNextPage = jest.fn();
    mockUseMarketplaceReviewerPacks.mockReturnValue({
      data: { items: [{
        id: 'rp-1',
        contentType: 'reviewer_pack',
        title: 'Sample Item',
        description: null,
        barSubject: null,
        topic: null,
        avgRating: 4.2,
        ratingCount: 8,
        itemCount: 5,
        creator: { id: 'u3', fullName: 'Pedro', expertVerification: null },
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      }], hasNext: false },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
      fetchNextPage,
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    const { UNSAFE_getByType } = render(<MarketplaceReviewerPacksScreen />, {
      wrapper: createWrapper(),
    });
    const { FlatList } = require('react-native');
    UNSAFE_getByType(FlatList).props.onEndReached();

    // `hasNextPage` is derived from `meta.hasNext`; honouring it is what stops
    // an endless tail of requests at the bottom of the list.
    expect(fetchNextPage).not.toHaveBeenCalled();
  });
});
