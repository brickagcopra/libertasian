import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null }, router: { push: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) => { const { Text } = require('react-native'); return <Text>{name}</Text>; } }));

const mockUsePleadings = jest.fn();
jest.mock('../../../features/pleadings/hooks/use-pleadings', () => ({
  usePleadings: (...args: unknown[]) => mockUsePleadings(...args),
  useDeletePleading: () => ({ mutate: jest.fn() }),
}));

jest.mock('../../../features/pleadings/types', () => ({
  PLEADING_CATEGORY_LABELS: { motion: 'Motion', complaint: 'Complaint', petition: 'Petition', answer: 'Answer', memorandum: 'Memorandum', appeal: 'Appeal', other: 'Other' },
}));

import PleadingsListScreen from './index';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('PleadingsListScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows empty state', () => {
    mockUsePleadings.mockReturnValue({ data: { data: [] }, isLoading: false, isFetching: false, refetch: jest.fn() });
    const { getByText } = render(<PleadingsListScreen />, { wrapper: createWrapper() });
    expect(getByText('No pleadings yet')).toBeTruthy();
  });

  it('renders pleading cards', () => {
    mockUsePleadings.mockReturnValue({
      data: {
        data: [{
          id: 'p-1',
          template: { id: 'tpl-1', name: 'Motion to Dismiss', category: 'motion' },
          status: 'completed',
          createdAt: '2024-03-01T00:00:00Z',
          updatedAt: '2024-03-01T00:00:00Z',
          matterId: null,
        }],
      },
      isLoading: false, isFetching: false, refetch: jest.fn(),
    });
    const { getByText } = render(<PleadingsListScreen />, { wrapper: createWrapper() });
    expect(getByText('Motion to Dismiss')).toBeTruthy();
  });
});
