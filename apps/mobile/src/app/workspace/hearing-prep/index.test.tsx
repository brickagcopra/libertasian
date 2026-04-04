import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null }, router: { push: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) => { const { Text } = require('react-native'); return <Text>{name}</Text>; } }));

const mockUseHearingPreps = jest.fn();
jest.mock('../../../features/hearing-prep/hooks/use-hearing-prep', () => ({
  useHearingPreps: (...args: unknown[]) => mockUseHearingPreps(...args),
  useDeleteHearingPrep: () => ({ mutate: jest.fn() }),
}));

jest.mock('../../../features/hearing-prep/types', () => ({
  HEARING_PREP_STATUS_LABELS: { pending: 'Pending', generating: 'Generating...', completed: 'Completed', failed: 'Failed' },
}));

import HearingPrepListScreen from './index';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('HearingPrepListScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows empty state', () => {
    mockUseHearingPreps.mockReturnValue({ data: { data: [] }, isLoading: false, isFetching: false, refetch: jest.fn() });
    const { getByText } = render(<HearingPrepListScreen />, { wrapper: createWrapper() });
    expect(getByText('No hearing preps yet')).toBeTruthy();
  });

  it('renders hearing prep cards', () => {
    mockUseHearingPreps.mockReturnValue({
      data: {
        data: [{
          id: 'hp-1',
          topic: 'Cross-examination strategy',
          issue: 'Witness credibility',
          status: 'completed',
          createdAt: '2024-03-01T00:00:00Z',
          matterId: null,
        }],
      },
      isLoading: false, isFetching: false, refetch: jest.fn(),
    });
    const { getByText } = render(<HearingPrepListScreen />, { wrapper: createWrapper() });
    expect(getByText('Cross-examination strategy')).toBeTruthy();
  });
});
