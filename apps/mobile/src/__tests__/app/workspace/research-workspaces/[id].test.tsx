import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(() => ({ id: 'rw-1' })),
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseResearchWorkspace = jest.fn();
const mockUseResearchQueries = jest.fn();
jest.mock(
  '@/features/research-workspaces/hooks/use-research-workspaces',
  () => ({
    useResearchWorkspace: (...args: unknown[]) =>
      mockUseResearchWorkspace(...args),
    useResearchQueries: (...args: unknown[]) =>
      mockUseResearchQueries(...args),
    useAskResearchQuery: () => ({ mutateAsync: jest.fn(), isPending: false }),
    useDeleteResearchWorkspace: () => ({ mutate: jest.fn() }),
  }),
);

import ResearchWorkspaceDetailScreen from '@/app/workspace/research-workspaces/[id]';

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('ResearchWorkspaceDetailScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUseResearchWorkspace.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });
    mockUseResearchQueries.mockReturnValue({
      data: undefined,
      isLoading: true,
    });
    const { UNSAFE_root } = render(<ResearchWorkspaceDetailScreen />, {
      wrapper: createWrapper(),
    });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('renders workspace title and chat interface', () => {
    mockUseResearchWorkspace.mockReturnValue({
      data: {
        data: {
          id: 'rw-1',
          title: 'Negligence Research',
          description: 'Exploring standards',
          queryCount: 1,
          createdAt: '2024-03-01T00:00:00Z',
          updatedAt: '2024-03-01T00:00:00Z',
          contextJson: { pinnedDocumentIds: [], pinnedSectionIds: [], notes: '' },
          userId: 'u-1',
          organizationId: 'org-1',
        },
      },
      isLoading: false,
      error: null,
    });
    mockUseResearchQueries.mockReturnValue({
      data: {
        data: [
          {
            id: 'q-1',
            query: 'What is negligence?',
            responseJson: {
              answer: 'Negligence is...',
              followUpSuggestions: ['What about gross negligence?'],
            },
            citationsJson: [
              { sourceId: 's-1', sectionId: null, text: 'Case A' },
            ],
            createdAt: '2024-03-01T00:00:00Z',
          },
        ],
        meta: { hasNext: false, limit: 30 },
      },
      isLoading: false,
    });
    const { getByText } = render(<ResearchWorkspaceDetailScreen />, {
      wrapper: createWrapper(),
    });
    expect(getByText('What is negligence?')).toBeTruthy();
    expect(getByText('Negligence is...')).toBeTruthy();
  });

  it('shows empty chat state', () => {
    mockUseResearchWorkspace.mockReturnValue({
      data: {
        data: {
          id: 'rw-1',
          title: 'New Workspace',
          description: '',
          queryCount: 0,
          createdAt: '2024-03-01T00:00:00Z',
          updatedAt: '2024-03-01T00:00:00Z',
          contextJson: { pinnedDocumentIds: [], pinnedSectionIds: [], notes: '' },
          userId: 'u-1',
          organizationId: 'org-1',
        },
      },
      isLoading: false,
      error: null,
    });
    mockUseResearchQueries.mockReturnValue({
      data: { data: [], meta: { hasNext: false, limit: 30 } },
      isLoading: false,
    });
    const { getByText } = render(<ResearchWorkspaceDetailScreen />, {
      wrapper: createWrapper(),
    });
    expect(getByText('New Workspace')).toBeTruthy();
    expect(
      getByText('Ask a question to start your research'),
    ).toBeTruthy();
  });

  it('shows error state when workspace fails to load', () => {
    mockUseResearchWorkspace.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Network error'),
    });
    mockUseResearchQueries.mockReturnValue({
      data: undefined,
      isLoading: false,
    });
    const { getByText } = render(<ResearchWorkspaceDetailScreen />, {
      wrapper: createWrapper(),
    });
    expect(getByText('Failed to load workspace')).toBeTruthy();
    expect(getByText('Network error')).toBeTruthy();
    expect(getByText('Go Back')).toBeTruthy();
  });
});
