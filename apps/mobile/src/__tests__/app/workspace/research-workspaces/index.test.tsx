import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseResearchWorkspaces = jest.fn();
const mockDeleteMutate = jest.fn();
jest.mock(
  '@/features/research-workspaces/hooks/use-research-workspaces',
  () => ({
    useResearchWorkspaces: () => mockUseResearchWorkspaces(),
    useDeleteResearchWorkspace: () => ({ mutate: mockDeleteMutate }),
  }),
);

import ResearchWorkspacesListScreen from '@/app/workspace/research-workspaces/index';

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

describe('ResearchWorkspacesListScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows empty state', () => {
    mockUseResearchWorkspaces.mockReturnValue({
      data: { data: [], meta: { hasNext: false, limit: 30 } },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<ResearchWorkspacesListScreen />, {
      wrapper: createWrapper(),
    });
    expect(getByText(/No research workspaces/i)).toBeTruthy();
  });

  it('renders workspace cards', () => {
    mockUseResearchWorkspaces.mockReturnValue({
      data: {
        data: [
          {
            id: 'rw-1',
            title: 'Negligence Research',
            description: 'Exploring negligence standards',
            queryCount: 5,
            createdAt: '2024-03-01T00:00:00Z',
            updatedAt: '2024-03-01T00:00:00Z',
          },
        ],
        meta: { hasNext: false, limit: 30 },
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<ResearchWorkspacesListScreen />, {
      wrapper: createWrapper(),
    });
    expect(getByText('Negligence Research')).toBeTruthy();
    expect(getByText('5 queries')).toBeTruthy();
  });

  it('navigates to workspace detail on press', () => {
    mockUseResearchWorkspaces.mockReturnValue({
      data: {
        data: [
          {
            id: 'rw-1',
            title: 'Test Research',
            description: '',
            queryCount: 0,
            createdAt: '2024-03-01T00:00:00Z',
            updatedAt: '2024-03-01T00:00:00Z',
          },
        ],
        meta: { hasNext: false, limit: 30 },
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<ResearchWorkspacesListScreen />, {
      wrapper: createWrapper(),
    });
    fireEvent.press(getByText('Test Research'));
    const { router } = require('expo-router');
    expect(router.push).toHaveBeenCalledWith(
      '/workspace/research-workspaces/rw-1',
    );
  });
});
