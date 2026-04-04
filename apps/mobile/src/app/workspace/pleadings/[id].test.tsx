import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null }, useLocalSearchParams: jest.fn(() => ({ id: 'p-1' })), router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) => { const { Text } = require('react-native'); return <Text>{name}</Text>; } }));

const mockUsePleading = jest.fn();
jest.mock('../../../features/pleadings/hooks/use-pleadings', () => ({
  usePleading: (...args: unknown[]) => mockUsePleading(...args),
  useDeletePleading: () => ({ mutate: jest.fn() }),
}));

jest.mock('../../../features/pleadings/types', () => ({
  PLEADING_CATEGORY_LABELS: { motion: 'Motion', complaint: 'Complaint', petition: 'Petition', answer: 'Answer', memorandum: 'Memorandum', appeal: 'Appeal', other: 'Other' },
}));

import PleadingDetailScreen from './[id]';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('PleadingDetailScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUsePleading.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { UNSAFE_root } = render(<PleadingDetailScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('renders completed pleading with sections', () => {
    mockUsePleading.mockReturnValue({
      data: {
        data: {
          id: 'p-1',
          template: { id: 'tpl-1', name: 'Motion to Dismiss', category: 'motion' },
          status: 'completed',
          generatedOutput: {
            title: 'Motion to Dismiss',
            sections: [{ key: 'prayer', heading: 'Prayer', content: 'Wherefore...', citations: [{ sourceId: 's1', text: 'Citation 1' }] }],
          },
          citationsJson: [{ sourceId: 's1', text: 'Citation 1' }],
          inputData: { caption: 'People v. Smith' },
          createdAt: '2024-03-01T00:00:00Z',
          updatedAt: '2024-03-01T00:00:00Z',
          matterId: null,
          matter: null,
          modelRunId: null,
          userId: 'u1',
          organizationId: 'org1',
        },
      },
      isLoading: false,
      error: null,
    });
    const { getByText } = render(<PleadingDetailScreen />, { wrapper: createWrapper() });
    expect(getByText(/Prayer/)).toBeTruthy();
  });
});
