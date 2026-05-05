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

jest.mock('@/features/case-comparisons/hooks/use-case-comparisons', () => ({
  useGenerateComparison: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock('@/features/search/hooks/use-search', () => ({
  useSearch: () => ({ data: null, isLoading: false }),
}));

import CreateComparisonScreen from '@/app/workspace/comparisons/create';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('CreateComparisonScreen', () => {
  it('renders document search area', () => {
    const { getByPlaceholderText } = render(<CreateComparisonScreen />, { wrapper: createWrapper() });
    expect(getByPlaceholderText(/Search cases/i)).toBeTruthy();
  });

  it('renders comparison type options', () => {
    const { getByText } = render(<CreateComparisonScreen />, { wrapper: createWrapper() });
    expect(getByText('Full Comparison')).toBeTruthy();
    expect(getByText('Doctrine Only')).toBeTruthy();
  });

  it('renders info text about generation', () => {
    const { getByText } = render(<CreateComparisonScreen />, { wrapper: createWrapper() });
    expect(getByText(/Generation may take up to 60 seconds/)).toBeTruthy();
  });
});
