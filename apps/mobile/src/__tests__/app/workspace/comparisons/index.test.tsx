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

const mockUseComparisons = jest.fn();
const mockDeleteMutate = jest.fn();
jest.mock('@/features/case-comparisons/hooks/use-case-comparisons', () => ({
  useComparisons: (...args: unknown[]) => mockUseComparisons(...args),
  useDeleteComparison: () => ({ mutate: mockDeleteMutate }),
}));

import ComparisonsListScreen from '@/app/workspace/comparisons/index';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('ComparisonsListScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows empty state', () => {
    mockUseComparisons.mockReturnValue({ data: { data: [] }, isLoading: false, isFetching: false, refetch: jest.fn() });
    const { getByText } = render(<ComparisonsListScreen />, { wrapper: createWrapper() });
    expect(getByText(/No comparisons/i)).toBeTruthy();
  });

  it('renders status filter chips', () => {
    mockUseComparisons.mockReturnValue({ data: { data: [] }, isLoading: false, isFetching: false, refetch: jest.fn() });
    const { getByText } = render(<ComparisonsListScreen />, { wrapper: createWrapper() });
    expect(getByText('All')).toBeTruthy();
    expect(getByText('Completed')).toBeTruthy();
  });

  it('renders comparison cards', () => {
    mockUseComparisons.mockReturnValue({
      data: {
        data: [
          {
            id: 'c-1',
            comparisonType: 'full',
            status: 'completed',
            documentIds: ['d-1', 'd-2', 'd-3'],
            createdAt: '2024-03-01',
            matterId: null,
            matter: null,
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<ComparisonsListScreen />, { wrapper: createWrapper() });
    expect(getByText('Full Comparison')).toBeTruthy();
    expect(getByText('3 docs')).toBeTruthy();
  });
});
