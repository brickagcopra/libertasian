import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null }, router: { push: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) => { const { Text } = require('react-native'); return <Text>{name}</Text>; } }));

const mockUseContradictions = jest.fn();
jest.mock('@/features/contradictions/hooks/use-contradictions', () => ({
  useContradictions: (...args: unknown[]) => mockUseContradictions(...args),
  useDeleteContradiction: () => ({ mutate: jest.fn() }),
}));

jest.mock('@/features/contradictions/types', () => ({
  CONTRADICTION_STATUS_LABELS: { pending: 'Pending', generating: 'Analyzing...', completed: 'Completed', failed: 'Failed' },
  SCOPE_LABELS: { selected: 'Selected Documents', topic_based: 'Topic-Based' },
}));

import ContradictionsListScreen from '@/app/workspace/contradictions/index';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('ContradictionsListScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows empty state', () => {
    mockUseContradictions.mockReturnValue({ data: { data: [] }, isLoading: false, isFetching: false, refetch: jest.fn() });
    const { getByText } = render(<ContradictionsListScreen />, { wrapper: createWrapper() });
    expect(getByText('No contradiction reports')).toBeTruthy();
  });

  it('renders contradiction cards', () => {
    mockUseContradictions.mockReturnValue({
      data: {
        data: [{
          id: 'ct-1',
          scope: 'selected',
          topic: 'Negligence standard',
          documentIds: ['d1', 'd2', 'd3'],
          status: 'completed',
          createdAt: '2024-03-01T00:00:00Z',
        }],
      },
      isLoading: false, isFetching: false, refetch: jest.fn(),
    });
    const { getByText } = render(<ContradictionsListScreen />, { wrapper: createWrapper() });
    expect(getByText(/Negligence standard/)).toBeTruthy();
  });
});
