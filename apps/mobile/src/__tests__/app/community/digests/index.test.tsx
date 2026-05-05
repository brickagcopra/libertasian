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

const mockUseMarketplaceDigests = jest.fn();
jest.mock('@/features/community/hooks/use-marketplace', () => ({
  useMarketplaceDigests: (...args: unknown[]) => mockUseMarketplaceDigests(...args),
}));

jest.mock('@/features/community/components/marketplace-item-card', () => ({
  MarketplaceItemCard: ({ item }: { item: { title: string } }) => {
    const { Text } = require('react-native');
    return <Text>{item.title}</Text>;
  },
}));

import MarketplaceDigestsScreen from '@/app/community/digests/index';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('MarketplaceDigestsScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows empty state', () => {
    mockUseMarketplaceDigests.mockReturnValue({
      data: { data: { items: [] } },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<MarketplaceDigestsScreen />, { wrapper: createWrapper() });
    expect(getByText(/No digests/i)).toBeTruthy();
  });

  it('renders marketplace digest items', () => {
    mockUseMarketplaceDigests.mockReturnValue({
      data: {
        data: {
          items: [
            {
              id: 'md-1',
              contentType: 'digest',
              title: 'People v. Macaraig Digest',
              description: null,
              barSubject: null,
              topic: null,
              avgRating: 4.2,
              ratingCount: 8,
              itemCount: 5,
              creator: { id: 'u3', fullName: 'Pedro', expertVerification: null },
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
    const { getByText } = render(<MarketplaceDigestsScreen />, { wrapper: createWrapper() });
    expect(getByText('People v. Macaraig Digest')).toBeTruthy();
  });

  it('renders sort options', () => {
    mockUseMarketplaceDigests.mockReturnValue({
      data: { data: { items: [] } },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<MarketplaceDigestsScreen />, { wrapper: createWrapper() });
    expect(getByText(/Top Rated/i)).toBeTruthy();
    expect(getByText(/Newest/i)).toBeTruthy();
  });
});
