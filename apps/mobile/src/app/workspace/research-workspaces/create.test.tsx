import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));
jest.mock(
  '../../../features/research-workspaces/hooks/use-research-workspaces',
  () => ({
    useCreateResearchWorkspace: () => ({
      mutateAsync: jest.fn(),
      isPending: false,
    }),
  }),
);

import CreateResearchWorkspaceScreen from './create';

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

describe('CreateResearchWorkspaceScreen', () => {
  it('renders title input field', () => {
    const { getByPlaceholderText } = render(
      <CreateResearchWorkspaceScreen />,
      { wrapper: createWrapper() },
    );
    expect(
      getByPlaceholderText(
        'e.g., Labor Law Research — Constructive Dismissal',
      ),
    ).toBeTruthy();
  });

  it('renders description input field', () => {
    const { getByPlaceholderText } = render(
      <CreateResearchWorkspaceScreen />,
      { wrapper: createWrapper() },
    );
    expect(
      getByPlaceholderText('Describe the research topic or context...'),
    ).toBeTruthy();
  });

  it('renders field labels', () => {
    const { getByText } = render(<CreateResearchWorkspaceScreen />, {
      wrapper: createWrapper(),
    });
    expect(getByText('Workspace Title *')).toBeTruthy();
    expect(getByText('Description (Optional)')).toBeTruthy();
  });

  it('renders info card', () => {
    const { getByText } = render(<CreateResearchWorkspaceScreen />, {
      wrapper: createWrapper(),
    });
    expect(
      getByText(/research workspace maintains persistent AI context/i),
    ).toBeTruthy();
  });
});
