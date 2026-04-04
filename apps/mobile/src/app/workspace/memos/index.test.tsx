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

const mockUseMemos = jest.fn();
const mockDeleteMutate = jest.fn();
jest.mock('../../../features/memos/hooks/use-memos', () => ({
  useMemos: (...args: unknown[]) => mockUseMemos(...args),
  useDeleteMemo: () => ({ mutate: mockDeleteMutate }),
}));

import MemosListScreen from './index';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('MemosListScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows empty state', () => {
    mockUseMemos.mockReturnValue({ data: { data: [] }, isLoading: false, isFetching: false, refetch: jest.fn() });
    const { getByText } = render(<MemosListScreen />, { wrapper: createWrapper() });
    expect(getByText(/No memos/i)).toBeTruthy();
  });

  it('renders status filter chips', () => {
    mockUseMemos.mockReturnValue({ data: { data: [] }, isLoading: false, isFetching: false, refetch: jest.fn() });
    const { getByText } = render(<MemosListScreen />, { wrapper: createWrapper() });
    expect(getByText('All')).toBeTruthy();
    expect(getByText('Completed')).toBeTruthy();
  });

  it('renders memo cards', () => {
    mockUseMemos.mockReturnValue({
      data: {
        data: [
          {
            id: 'memo-1',
            query: 'What is res judicata?',
            memoType: 'legal_opinion',
            status: 'completed',
            confidenceScore: 0.85,
            createdAt: '2024-03-01',
            updatedAt: '2024-03-01',
            matterId: null,
            matter: null,
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<MemosListScreen />, { wrapper: createWrapper() });
    expect(getByText(/res judicata/)).toBeTruthy();
  });
});
