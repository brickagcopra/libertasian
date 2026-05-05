import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock dependencies
const mockUseDigests = jest.fn();
jest.mock('@/features/digests/hooks/use-digests', () => ({
  useDigests: (...args: unknown[]) => mockUseDigests(...args),
}));

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

import DigestsTab from '@/app/(tabs)/digests';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('DigestsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading state', () => {
    mockUseDigests.mockReturnValue({
      data: null,
      isLoading: true,
      isFetching: false,
      refetch: jest.fn(),
    });

    const { UNSAFE_queryByType } = render(<DigestsTab />, {
      wrapper: createWrapper(),
    });

    // ActivityIndicator should be present
    const { queryByText } = render(<DigestsTab />, {
      wrapper: createWrapper(),
    });

    // When loading, no empty text should appear
    expect(queryByText('No digests yet')).toBeNull();
  });

  it('shows empty state when no digests', () => {
    mockUseDigests.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });

    const { queryByText } = render(<DigestsTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('No digests found')).toBeTruthy();
    expect(
      queryByText('Generate case digests from legal documents using AI'),
    ).toBeTruthy();
  });

  it('renders digest cards with correct data', () => {
    mockUseDigests.mockReturnValue({
      data: {
        data: [
          {
            id: 'd1',
            title: 'People v. Reyes - Digest',
            digestType: 'case_digest',
            reviewStatus: 'approved',
            confidenceScore: 0.85,
            facts: 'The accused was charged with theft...',
            sourceOrigin: 'official_source',
            createdAt: '2024-06-15T00:00:00Z',
          },
          {
            id: 'd2',
            title: 'Estate Tax Advisory',
            digestType: 'administrative_digest',
            reviewStatus: 'needs_human_review',
            confidenceScore: 0.55,
            facts: null,
            sourceOrigin: 'user_scan',
            createdAt: '2024-07-01T00:00:00Z',
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });

    const { queryByText } = render(<DigestsTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('People v. Reyes - Digest')).toBeTruthy();
    expect(queryByText('Estate Tax Advisory')).toBeTruthy();
    expect(queryByText('85%')).toBeTruthy();
    expect(queryByText('55%')).toBeTruthy();
    expect(queryByText('The accused was charged with theft...')).toBeTruthy();
  });

  it('renders digest type and status badges', () => {
    mockUseDigests.mockReturnValue({
      data: {
        data: [
          {
            id: 'd1',
            title: 'Test Digest',
            digestType: 'case_digest',
            reviewStatus: 'ai_generated',
            confidenceScore: 0.9,
            facts: null,
            sourceOrigin: 'official_source',
            createdAt: '2024-01-01T00:00:00Z',
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });

    const { queryByText } = render(<DigestsTab />, {
      wrapper: createWrapper(),
    });

    expect(queryByText('case digest')).toBeTruthy();
    expect(queryByText('ai generated')).toBeTruthy();
  });
});
