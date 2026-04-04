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
jest.mock('../../../features/community/hooks/use-marketplace', () => ({
  useMarketplaceReviewerPacks: (...args: unknown[]) => mockUseMarketplaceReviewerPacks(...args),
}));

jest.mock('../../../features/community/components/marketplace-item-card', () => ({
  MarketplaceItemCard: ({ item }: { item: { title: string } }) => {
    const { Text } = require('react-native');
    return <Text>{item.title}</Text>;
  },
}));

import MarketplaceReviewerPacksScreen from './index';

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
      data: { data: { items: [] } },
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
        },
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
      data: { data: { items: [] } },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<MarketplaceReviewerPacksScreen />, { wrapper: createWrapper() });
    expect(getByText(/Top Rated/i)).toBeTruthy();
  });
});
