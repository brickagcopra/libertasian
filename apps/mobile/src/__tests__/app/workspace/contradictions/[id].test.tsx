import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null }, useLocalSearchParams: jest.fn(() => ({ id: 'ct-1' })), router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) => { const { Text } = require('react-native'); return <Text>{name}</Text>; } }));

const mockUseContradiction = jest.fn();
jest.mock('@/features/contradictions/hooks/use-contradictions', () => ({
  useContradiction: (...args: unknown[]) => mockUseContradiction(...args),
  useDeleteContradiction: () => ({ mutate: jest.fn() }),
}));

jest.mock('@/features/contradictions/types', () => ({
  CONTRADICTION_STATUS_LABELS: { pending: 'Pending', generating: 'Analyzing...', completed: 'Completed', failed: 'Failed' },
  SCOPE_LABELS: { selected: 'Selected Documents', topic_based: 'Topic-Based' },
  SEVERITY_LABELS: { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' },
}));

import ContradictionDetailScreen from '@/app/workspace/contradictions/[id]';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('ContradictionDetailScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUseContradiction.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { UNSAFE_root } = render(<ContradictionDetailScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('renders completed contradiction report', () => {
    mockUseContradiction.mockReturnValue({
      data: {
          id: 'ct-1',
          scope: 'selected',
          topic: null,
          status: 'completed',
          documentIds: ['d1', 'd2', 'd3'],
          createdAt: '2024-03-01T00:00:00Z',
          updatedAt: '2024-03-01T00:00:00Z',
          modelRunId: null,
          userId: 'u1',
          organizationId: 'org1',
          resultJson: {
            summary: 'Found 2 contradictions in negligence standards',
            documentsAnalyzed: 3,
            contradictions: [{
              documentAId: 'd1',
              documentATitle: 'Case A',
              documentAPassage: 'Text A says...',
              documentBId: 'd2',
              documentBTitle: 'Case B',
              documentBPassage: 'Text B says...',
              description: 'Conflicting negligence standard',
              severity: 'high',
              doctrineArea: 'Negligence',
            }],
          },
        },
      isLoading: false,
      error: null,
    });
    const { getByText } = render(<ContradictionDetailScreen />, { wrapper: createWrapper() });
    expect(getByText(/2 contradictions/)).toBeTruthy();
  });
});
