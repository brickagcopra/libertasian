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

const mockUseMarketplaceFeatured = jest.fn();
jest.mock('../../features/community/hooks/use-marketplace', () => ({
  useMarketplaceFeatured: () => mockUseMarketplaceFeatured(),
}));

jest.mock('../../features/community/components/marketplace-item-card', () => ({
  MarketplaceItemCard: ({ item }: { item: { title: string } }) => {
    const { Text } = require('react-native');
    return <Text>{item.title}</Text>;
  },
}));

import CommunityScreen from './index';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('CommunityScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUseMarketplaceFeatured.mockReturnValue({ data: undefined, isLoading: true, isFetching: false, refetch: jest.fn() });
    const { UNSAFE_root } = render(<CommunityScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('renders browse category cards', () => {
    mockUseMarketplaceFeatured.mockReturnValue({
      data: { data: { flashcardSets: [], reviewerPacks: [], digests: [] } },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getAllByText } = render(<CommunityScreen />, { wrapper: createWrapper() });
    expect(getAllByText(/Flashcard Sets/i).length).toBeGreaterThanOrEqual(1);
    expect(getAllByText(/Reviewer Packs/i).length).toBeGreaterThanOrEqual(1);
    expect(getAllByText(/Case Digests/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders expert verification CTA', () => {
    mockUseMarketplaceFeatured.mockReturnValue({
      data: { data: { flashcardSets: [], reviewerPacks: [], digests: [] } },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<CommunityScreen />, { wrapper: createWrapper() });
    expect(getByText('Get Verified')).toBeTruthy();
  });
});
