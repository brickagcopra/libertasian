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
jest.mock('@/features/study/hooks/use-codals', () => ({
  useInfiniteCodals: (filters: unknown) => mockUseInfiniteCodals(filters),
  useOfflineCodals: (filters: unknown) => mockUseOfflineFallback(filters),
}));

const mockIsOffline = jest.fn(() => false);
const mockSaveForOffline = jest.fn();
const mockRemoveOffline = jest.fn();
jest.mock('@/features/study/hooks/use-offline-codals', () => ({
  useOfflineCodals: () => ({
    isOffline: (...args: unknown[]) => mockIsOffline(...(args as [])),
    saveForOffline: (...args: unknown[]) => mockSaveForOffline(...args),
    removeOffline: (...args: unknown[]) => mockRemoveOffline(...args),
    saving: null,
    lastError: null,
    clearError: jest.fn(),
    offlineIds: new Set(),
  }),
}));

// Offline-save gate — default unlocked; the gate block flips `locked`.
const mockUseCanUseOffline = jest.fn(() => ({ locked: false }));
jest.mock('@/features/billing/hooks/use-can-use-offline', () => ({
  useCanUseOffline: () => mockUseCanUseOffline(),
}));

const mockUseNetworkState = jest.fn(() => ({
  isConnected: true,
  isInternetReachable: true,
  type: 'wifi',
}));
jest.mock('@/hooks/use-network-state', () => ({
  useNetworkState: () => mockUseNetworkState(),
}));

jest.mock('@/components/offline-banner', () => ({
  OfflineBanner: () => {
    const { Text } = require('react-native');
    return <Text testID="offline-banner">Offline</Text>;
  },
}));

jest.mock('@/features/study/components/codal-card', () => ({
  CodalCard: ({
    item,
    onToggleOffline,
  }: {
    item: { id: string; title: string; shortTitle?: string };
    onToggleOffline: () => void;
  }) => {
    const { Text } = require('react-native');
    return (
      <Text testID={`toggle-offline-${item.id}`} onPress={onToggleOffline}>
        {item.shortTitle ?? item.title}
      </Text>
    );
  },
}));

import CodalListScreen from '@/app/study/codals/[subject]';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('CodalListScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsOffline.mockReturnValue(false);
    mockUseCanUseOffline.mockReturnValue({ locked: false });
  });

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

  it('shows empty state when no codals found online (default Statutes tab)', () => {
    mockUseNetworkState.mockReturnValue({ isConnected: true, isInternetReachable: true, type: 'wifi' });
    mockUseInfiniteCodals.mockReturnValue({
      data: { pages: [{ data: [] }] },
      isLoading: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      isFetchingNextPage: false,
    });
    const { getByText } = render(<CodalListScreen />, { wrapper: createWrapper() });
    expect(getByText(/No statutes yet for Civil law/i)).toBeTruthy();
  });

  it('renders the 4 codal tabs and defaults to Statutes', () => {
    mockUseNetworkState.mockReturnValue({ isConnected: true, isInternetReachable: true, type: 'wifi' });
    mockUseInfiniteCodals.mockReturnValue({
      data: { pages: [{ data: [] }] },
      isLoading: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      isFetchingNextPage: false,
    });
    const { getByText } = render(<CodalListScreen />, { wrapper: createWrapper() });
    expect(getByText('Statutes')).toBeTruthy();
    expect(getByText('Constitutions')).toBeTruthy();
    expect(getByText('Executive Issuances')).toBeTruthy();
    expect(getByText('Rules')).toBeTruthy();

    // Defaults to the statutes tabGroup on first render.
    const lastCall = mockUseInfiniteCodals.mock.calls.at(-1) as unknown[];
    expect((lastCall[0] as { tabGroup: string }).tabGroup).toBe('statutes');
  });

  it('switches tabGroup when a tab is pressed', () => {
    mockUseNetworkState.mockReturnValue({ isConnected: true, isInternetReachable: true, type: 'wifi' });
    mockUseInfiniteCodals.mockReturnValue({
      data: { pages: [{ data: [] }] },
      isLoading: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      isFetchingNextPage: false,
    });
    const { getByText } = render(<CodalListScreen />, { wrapper: createWrapper() });

    fireEvent.press(getByText('Rules'));

    const lastCall = mockUseInfiniteCodals.mock.calls.at(-1) as unknown[];
    expect((lastCall[0] as { tabGroup: string }).tabGroup).toBe('rules');
  });

  it('shows the "Coming soon" copy for the Executive Issuances tab when empty', () => {
    mockUseNetworkState.mockReturnValue({ isConnected: true, isInternetReachable: true, type: 'wifi' });
    mockUseInfiniteCodals.mockReturnValue({
      data: { pages: [{ data: [] }] },
      isLoading: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      isFetchingNextPage: false,
    });
    const { getByText } = render(<CodalListScreen />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Executive Issuances'));
    expect(getByText(/Coming soon/i)).toBeTruthy();
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

  describe('offline download gate (offlineReading entitlement)', () => {
    const codal = { id: 'codal-1', title: 'Civil Code', shortTitle: 'Civil Code' };

    function renderWithOneCodal() {
      mockUseNetworkState.mockReturnValue({
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
      });
      mockUseInfiniteCodals.mockReturnValue({
        data: { pages: [{ data: [codal] }] },
        isLoading: false,
        hasNextPage: false,
        fetchNextPage: jest.fn(),
        isFetchingNextPage: false,
      });
      return render(<CodalListScreen />, { wrapper: createWrapper() });
    }

    it('below-edu: download opens the not-included sheet and never writes to storage', () => {
      mockUseCanUseOffline.mockReturnValue({ locked: true });

      const { getByTestId, getByText } = renderWithOneCodal();
      fireEvent.press(getByTestId('toggle-offline-codal-1'));

      expect(getByText('Not included in your plan')).toBeTruthy();
      expect(
        getByText(
          /Downloading codals for offline reading is not included in your plan/,
        ),
      ).toBeTruthy();
      expect(mockSaveForOffline).not.toHaveBeenCalled();
    });

    it('below-edu: an already-downloaded codal can still be removed', () => {
      mockUseCanUseOffline.mockReturnValue({ locked: true });
      mockIsOffline.mockReturnValue(true);

      const { getByTestId, queryByText } = renderWithOneCodal();
      fireEvent.press(getByTestId('toggle-offline-codal-1'));

      expect(mockRemoveOffline).toHaveBeenCalledWith('codal-1');
      expect(queryByText('Not included in your plan')).toBeNull();
    });

    // App Review 2.1(b): the sheet may not name a tier, show a price, or route
    // anywhere. Its only control dismisses it.
    it('offers no purchase path — no tier name, no price, no navigation', () => {
      mockUseCanUseOffline.mockReturnValue({ locked: true });

      const { getByTestId, getByText, queryByText } = renderWithOneCodal();
      fireEvent.press(getByTestId('toggle-offline-codal-1'));

      expect(queryByText('See plans')).toBeNull();
      expect(queryByText(/Edu|Pro|Free|upgrade/i)).toBeNull();
      expect(queryByText(/₱/)).toBeNull();

      fireEvent.press(getByText('OK'));
      expect(queryByText('Not included in your plan')).toBeNull();
    });

    it('edu+: download saves without the not-included sheet', () => {
      mockUseCanUseOffline.mockReturnValue({ locked: false });

      const { getByTestId, queryByText } = renderWithOneCodal();
      fireEvent.press(getByTestId('toggle-offline-codal-1'));

      expect(mockSaveForOffline).toHaveBeenCalledWith('codal-1', 'civil_law');
      expect(queryByText('Not included in your plan')).toBeNull();
    });
  });
});
