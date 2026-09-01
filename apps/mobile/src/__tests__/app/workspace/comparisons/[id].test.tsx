import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(() => ({ id: 'c-1' })),
  router: { back: jest.fn(), push: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseComparison = jest.fn();
const mockDeleteMutate = jest.fn();
jest.mock('@/features/case-comparisons/hooks/use-case-comparisons', () => ({
  useComparison: (...args: unknown[]) => mockUseComparison(...args),
  useDeleteComparison: () => ({ mutate: mockDeleteMutate }),
}));

import ComparisonDetailScreen from '@/app/workspace/comparisons/[id]';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('ComparisonDetailScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUseComparison.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { UNSAFE_root } = render(<ComparisonDetailScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('renders completed comparison with dimensions', () => {
    mockUseComparison.mockReturnValue({
      data: {
          id: 'c-1',
          comparisonType: 'full',
          status: 'completed',
          documentIds: ['d-1', 'd-2'],
          createdAt: '2024-03-01',
          updatedAt: '2024-03-01',
          matterId: null,
          matter: null,
          modelRunId: null,
          userId: 'u-1',
          organizationId: 'org-1',
          resultJson: {
            documents: [
              { documentId: 'd-1', title: 'People v. A', citationText: null, court: 'SC', decisionDate: '2024-01-01' },
              { documentId: 'd-2', title: 'People v. B', citationText: null, court: 'SC', decisionDate: '2024-02-01' },
            ],
            dimensions: [
              {
                dimension: 'Facts',
                entries: [
                  { documentId: 'd-1', content: 'Facts of case A', citations: [] },
                  { documentId: 'd-2', content: 'Facts of case B', citations: [] },
                ],
                analysis: 'Different facts',
              },
            ],
            overallAnalysis: 'Overall analysis text',
          },
        },
      isLoading: false,
      error: null,
    });
    const { getByText } = render(<ComparisonDetailScreen />, { wrapper: createWrapper() });
    expect(getByText('1. Facts')).toBeTruthy();
    expect(getByText('Documents Compared')).toBeTruthy();
  });

  it('shows generating state', () => {
    mockUseComparison.mockReturnValue({
      data: {
          id: 'c-1',
          comparisonType: 'full',
          status: 'generating',
          documentIds: ['d-1', 'd-2'],
          createdAt: '2024-03-01',
          updatedAt: '2024-03-01',
          matterId: null,
          matter: null,
          modelRunId: null,
          userId: 'u-1',
          organizationId: 'org-1',
          resultJson: null,
        },
      isLoading: false,
      error: null,
    });
    const { getByText } = render(<ComparisonDetailScreen />, { wrapper: createWrapper() });
    expect(getByText(/Comparing cases/i)).toBeTruthy();
  });

  it('shows error state when comparison not found', () => {
    mockUseComparison.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Not found'),
    });
    const { getByText } = render(<ComparisonDetailScreen />, { wrapper: createWrapper() });
    expect(getByText('Failed to load comparison')).toBeTruthy();
  });
});
