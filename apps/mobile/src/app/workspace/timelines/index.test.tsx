import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null }, router: { push: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) => { const { Text } = require('react-native'); return <Text>{name}</Text>; } }));

const mockUseTimelines = jest.fn();
jest.mock('../../../features/timelines/hooks/use-timelines', () => ({
  useTimelines: (...args: unknown[]) => mockUseTimelines(...args),
  useDeleteTimeline: () => ({ mutate: jest.fn() }),
}));

jest.mock('../../../features/timelines/types', () => ({
  TIMELINE_STATUS_LABELS: { pending: 'Pending', generating: 'Generating...', completed: 'Completed', failed: 'Failed' },
}));

import TimelinesListScreen from './index';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('TimelinesListScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows empty state', () => {
    mockUseTimelines.mockReturnValue({ data: { data: [] }, isLoading: false, isFetching: false, refetch: jest.fn() });
    const { getByText } = render(<TimelinesListScreen />, { wrapper: createWrapper() });
    expect(getByText('No timelines yet')).toBeTruthy();
  });

  it('renders timeline cards', () => {
    mockUseTimelines.mockReturnValue({
      data: {
        data: [{
          id: 'tl-1',
          title: 'Smith v. Jones Timeline',
          status: 'completed',
          documentIds: ['d1', 'd2', 'd3', 'd4', 'd5'],
          createdAt: '2024-03-01T00:00:00Z',
          matterId: null,
        }],
      },
      isLoading: false, isFetching: false, refetch: jest.fn(),
    });
    const { getByText } = render(<TimelinesListScreen />, { wrapper: createWrapper() });
    expect(getByText('Smith v. Jones Timeline')).toBeTruthy();
  });
});
