import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
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

const mockUseMarketplaceFlashcardSets = jest.fn();
jest.mock('../../../features/community/hooks/use-marketplace', () => ({
  useMarketplaceFlashcardSets: (...args: unknown[]) => mockUseMarketplaceFlashcardSets(...args),
}));

jest.mock('../../../features/community/components/marketplace-item-card', () => ({
  MarketplaceItemCard: ({ item }: { item: { title: string } }) => {
    const { Text } = require('react-native');
    return <Text>{item.title}</Text>;
  },
}));

import MarketplaceFlashcardSetsScreen from './index';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('MarketplaceFlashcardSetsScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows empty state', () => {
    mockUseMarketplaceFlashcardSets.mockReturnValue({
      data: { data: { items: [] } },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<MarketplaceFlashcardSetsScreen />, { wrapper: createWrapper() });
    expect(getByText(/No flashcard sets/i)).toBeTruthy();
  });

  it('renders marketplace items', () => {
    mockUseMarketplaceFlashcardSets.mockReturnValue({
      data: {
        data: {
          items: [
            {
              id: 'mfs-1',
              contentType: 'flashcard_set',
              title: 'Civil Law Essentials',
              description: null,
              barSubject: null,
              topic: null,
              avgRating: 4.5,
              ratingCount: 12,
              itemCount: 20,
              creator: { id: 'u1', fullName: 'Juan', expertVerification: null },
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
    const { getByText } = render(<MarketplaceFlashcardSetsScreen />, { wrapper: createWrapper() });
    expect(getByText('Civil Law Essentials')).toBeTruthy();
  });

  it('renders sort pills', () => {
    mockUseMarketplaceFlashcardSets.mockReturnValue({
      data: { data: { items: [] } },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<MarketplaceFlashcardSetsScreen />, { wrapper: createWrapper() });
    expect(getByText(/Top Rated/i)).toBeTruthy();
    expect(getByText(/Newest/i)).toBeTruthy();
  });
});
