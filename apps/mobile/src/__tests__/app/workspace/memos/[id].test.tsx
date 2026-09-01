import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(() => ({ id: 'memo-1' })),
  router: { back: jest.fn(), push: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseMemo = jest.fn();
const mockDeleteMutate = jest.fn();
jest.mock('@/features/memos/hooks/use-memos', () => ({
  useMemo: (...args: unknown[]) => mockUseMemo(...args),
  useDeleteMemo: () => ({ mutate: mockDeleteMutate }),
}));

import MemoDetailScreen from '@/app/workspace/memos/[id]';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('MemoDetailScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUseMemo.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { UNSAFE_root } = render(<MemoDetailScreen />, { wrapper: createWrapper() });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('renders completed memo with sections', () => {
    mockUseMemo.mockReturnValue({
      data: {
          id: 'memo-1',
          query: 'What is res judicata?',
          memoType: 'legal_opinion',
          status: 'completed',
          confidenceScore: 0.88,
          createdAt: '2024-03-01',
          updatedAt: '2024-03-01',
          matterId: null,
          matter: null,
          structuredOutput: {
            title: 'Legal Opinion on Res Judicata',
            summary: 'Summary text',
            sections: [
              { heading: 'Analysis', content: 'Analysis content', citations: [{ sourceId: 's-1', text: 'Citation 1' }] },
            ],
            conclusion: 'Conclusion text',
          },
          citationsJson: [{ sourceId: 's-1', text: 'Citation 1' }],
          modelRunId: null,
          userId: 'u-1',
          organizationId: 'org-1',
        },
      isLoading: false,
      error: null,
    });
    const { getByText } = render(<MemoDetailScreen />, { wrapper: createWrapper() });
    expect(getByText('Legal Opinion on Res Judicata')).toBeTruthy();
  });

  it('shows generating state', () => {
    mockUseMemo.mockReturnValue({
      data: {
          id: 'memo-1',
          query: 'Test query',
          memoType: 'legal_opinion',
          status: 'generating',
          confidenceScore: null,
          createdAt: '2024-03-01',
          updatedAt: '2024-03-01',
          matterId: null,
          matter: null,
          structuredOutput: null,
          citationsJson: [],
          modelRunId: null,
          userId: 'u-1',
          organizationId: 'org-1',
        },
      isLoading: false,
      error: null,
    });
    const { getByText } = render(<MemoDetailScreen />, { wrapper: createWrapper() });
    expect(getByText(/Generating your memo/i)).toBeTruthy();
  });

  it('shows error state when memo not found', () => {
    mockUseMemo.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Not found'),
    });
    const { getByText } = render(<MemoDetailScreen />, { wrapper: createWrapper() });
    expect(getByText('Failed to load memo')).toBeTruthy();
  });
});
