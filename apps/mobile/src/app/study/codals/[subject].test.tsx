import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(() => ({ subject: 'civil_law' })),
  router: { push: jest.fn(), back: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseInfiniteCodals = jest.fn();
const mockUseOfflineFallback = jest.fn().mockReturnValue({ data: [], isLoading: false });
jest.mock('../../../features/study/hooks/use-codals', () => ({
  useInfiniteCodals: (filters: unknown) => mockUseInfiniteCodals(filters),
  useOfflineCodals: (filters: unknown) => mockUseOfflineFallback(filters),
}));

jest.mock('../../../features/study/hooks/use-offline-codals', () => ({
  useOfflineCodals: () => ({
    isOffline: jest.fn(() => false),
    saveForOffline: jest.fn(),
    removeOffline: jest.fn(),
    saving: null,
    lastError: null,
    clearError: jest.fn(),
    offlineIds: new Set(),
  }),
}));

const mockUseNetworkState = jest.fn(() => ({
  isConnected: true,
  isInternetReachable: true,
  type: 'wifi',
}));
jest.mock('../../../hooks/use-network-state', () => ({
  useNetworkState: () => mockUseNetworkState(),
}));

jest.mock('../../../components/offline-banner', () => ({
  OfflineBanner: () => {
    const { Text } = require('react-native');
    return <Text testID="offline-banner">Offline</Text>;
  },
}));

jest.mock('../../../features/study/components/codal-card', () => ({
  CodalCard: ({ item }: { item: { title: string; shortTitle?: string } }) => {
    const { Text } = require('react-native');
    return <Text>{item.shortTitle ?? item.title}</Text>;
  },
}));

import CodalListScreen from './[subject]';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('CodalListScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUseNetworkState.mockReturnValue({ isConnected: true, isInternetReachable: true, type: 'wifi' });
    mockUseInfiniteCodals.mockReturnValue({
      data: undefined,
      isLoading: true,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      isFetchingNextPage: false,
    });
    const { UNSAFE_root } = render(<CodalListScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('shows empty state when no codals found online', () => {
    mockUseNetworkState.mockReturnValue({ isConnected: true, isInternetReachable: true, type: 'wifi' });
    mockUseInfiniteCodals.mockReturnValue({
      data: { pages: [{ data: [] }] },
      isLoading: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      isFetchingNextPage: false,
    });
    const { getByText } = render(<CodalListScreen />, { wrapper: createWrapper() });
    expect(getByText(/No codals found/i)).toBeTruthy();
  });

  it('renders filter chips', () => {
    mockUseNetworkState.mockReturnValue({ isConnected: true, isInternetReachable: true, type: 'wifi' });
    mockUseInfiniteCodals.mockReturnValue({
      data: { pages: [{ data: [] }] },
      isLoading: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      isFetchingNextPage: false,
    });
    const { getAllByText } = render(<CodalListScreen />, { wrapper: createWrapper() });
    expect(getAllByText('All')[0]).toBeTruthy();
  });

  it('renders codal items when online', () => {
    mockUseNetworkState.mockReturnValue({ isConnected: true, isInternetReachable: true, type: 'wifi' });
    mockUseInfiniteCodals.mockReturnValue({
      data: {
        pages: [{
          data: [
            {
              id: 'c-1',
              title: 'Republic Act No. 386',
              shortTitle: 'Civil Code',
              citationText: 'RA 386',
              documentType: 'statute',
              sectionCount: 5,
            },
          ],
        }],
      },
      isLoading: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      isFetchingNextPage: false,
    });
    const { getByText } = render(<CodalListScreen />, { wrapper: createWrapper() });
    expect(getByText('Civil Code')).toBeTruthy();
  });

  it('shows offline banner when disconnected', () => {
    mockUseNetworkState.mockReturnValue({ isConnected: false, isInternetReachable: false, type: 'none' });
    mockUseInfiniteCodals.mockReturnValue({
      data: undefined,
      isLoading: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      isFetchingNextPage: false,
    });
    mockUseOfflineFallback.mockReturnValue({
      data: [],
      isLoading: false,
    });

    const { getByTestId } = render(<CodalListScreen />, { wrapper: createWrapper() });
    expect(getByTestId('offline-banner')).toBeTruthy();
  });

  it('shows cached codals when offline', () => {
    mockUseNetworkState.mockReturnValue({ isConnected: false, isInternetReachable: false, type: 'none' });
    mockUseInfiniteCodals.mockReturnValue({
      data: undefined,
      isLoading: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      isFetchingNextPage: false,
    });
    mockUseOfflineFallback.mockReturnValue({
      data: [
        {
          id: 'cached-1',
          title: 'Cached Civil Code',
          shortTitle: 'Civil Code',
          documentType: 'statute',
        },
      ],
      isLoading: false,
    });

    const { getByText } = render(<CodalListScreen />, { wrapper: createWrapper() });
    expect(getByText('Civil Code')).toBeTruthy();
  });

  it('shows offline empty state with guidance', () => {
    mockUseNetworkState.mockReturnValue({ isConnected: false, isInternetReachable: false, type: 'none' });
    mockUseInfiniteCodals.mockReturnValue({
      data: undefined,
      isLoading: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      isFetchingNextPage: false,
    });
    mockUseOfflineFallback.mockReturnValue({
      data: [],
      isLoading: false,
    });

    const { getByText } = render(<CodalListScreen />, { wrapper: createWrapper() });
    expect(getByText(/No cached codals/)).toBeTruthy();
    expect(getByText(/Download codals while online/)).toBeTruthy();
  });

  it('does not show offline banner when online', () => {
    mockUseNetworkState.mockReturnValue({ isConnected: true, isInternetReachable: true, type: 'wifi' });
    mockUseInfiniteCodals.mockReturnValue({
      data: { pages: [{ data: [] }] },
      isLoading: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      isFetchingNextPage: false,
    });

    const { queryByTestId } = render(<CodalListScreen />, { wrapper: createWrapper() });
    expect(queryByTestId('offline-banner')).toBeNull();
  });
});
