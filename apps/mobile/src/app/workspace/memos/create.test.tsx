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

jest.mock('../../../features/memos/hooks/use-memos', () => ({
  useGenerateMemo: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

import CreateMemoScreen from './create';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('CreateMemoScreen', () => {
  it('renders research question input', () => {
    const { getByPlaceholderText } = render(<CreateMemoScreen />, { wrapper: createWrapper() });
    expect(getByPlaceholderText(/constructive dismissal/i)).toBeTruthy();
  });

  it('renders memo type options', () => {
    const { getByText } = render(<CreateMemoScreen />, { wrapper: createWrapper() });
    expect(getByText('Legal Opinion')).toBeTruthy();
    expect(getByText('Case Analysis')).toBeTruthy();
  });

  it('renders the research question label', () => {
    const { getByText } = render(<CreateMemoScreen />, { wrapper: createWrapper() });
    expect(getByText('Research Question')).toBeTruthy();
  });

  it('renders info text about generation', () => {
    const { getByText } = render(<CreateMemoScreen />, { wrapper: createWrapper() });
    expect(getByText(/Generation may take up to 30 seconds/)).toBeTruthy();
  });
});
