import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(() => ({ userId: 'user-1' })),
  router: { back: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseContributorProfile = jest.fn();
jest.mock('@/features/community/hooks/use-marketplace', () => ({
  useContributorProfile: (...args: unknown[]) => mockUseContributorProfile(...args),
}));

jest.mock('@/features/community/components/expert-badge', () => ({
  ExpertBadge: () => null,
}));

jest.mock('@/features/community/components/star-rating', () => ({
  StarRatingDisplay: () => null,
}));

import ContributorProfileScreen from '@/app/community/contributors/[userId]';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('ContributorProfileScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUseContributorProfile.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { UNSAFE_root } = render(<ContributorProfileScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('shows error state when profile not found', () => {
    mockUseContributorProfile.mockReturnValue({ data: null, isLoading: false, error: new Error('Not found') });
    const { getByText } = render(<ContributorProfileScreen />, { wrapper: createWrapper() });
    expect(getByText('Not found')).toBeTruthy();
  });

  it('renders contributor profile', () => {
    mockUseContributorProfile.mockReturnValue({
      data: {
          user: {
            id: 'user-1',
            fullName: 'Maria Santos',
            createdAt: '2024-01-15T00:00:00Z',
          },
          expertVerification: null,
          stats: {
            flashcardSetCount: 5,
            reviewerPackCount: 3,
            digestCount: 12,
            totalRatingsReceived: 45,
            avgRating: 4.7,
          },
        },
      isLoading: false,
      error: null,
    });
    const { getByText } = render(<ContributorProfileScreen />, { wrapper: createWrapper() });
    expect(getByText('Maria Santos')).toBeTruthy();
  });

  it('displays stat cards', () => {
    mockUseContributorProfile.mockReturnValue({
      data: {
          user: {
            id: 'user-1',
            fullName: 'Maria Santos',
            createdAt: '2024-01-15T00:00:00Z',
          },
          expertVerification: null,
          stats: {
            flashcardSetCount: 5,
            reviewerPackCount: 3,
            digestCount: 12,
            totalRatingsReceived: 45,
            avgRating: 4.0,
          },
        },
      isLoading: false,
      error: null,
    });
    const { getByText } = render(<ContributorProfileScreen />, { wrapper: createWrapper() });
    expect(getByText('5')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
    expect(getByText('12')).toBeTruthy();
  });
});
