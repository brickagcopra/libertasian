import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null }, router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) => { const { Text } = require('react-native'); return <Text>{name}</Text>; } }));
jest.mock('@/features/contradictions/hooks/use-contradictions', () => ({ useGenerateContradiction: () => ({ mutateAsync: jest.fn(), isPending: false }) }));
jest.mock('@/features/contradictions/types', () => ({ ContradictionScope: {} }));
jest.mock('@/features/search/hooks/use-search', () => ({ useSearch: () => ({ data: null, isLoading: false }) }));

import CreateContradictionScreen from '@/app/workspace/contradictions/create';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('CreateContradictionScreen', () => {
  it('renders scope selection options', () => {
    const { getByText } = render(<CreateContradictionScreen />, { wrapper: createWrapper() });
    expect(getByText('Selected Documents')).toBeTruthy();
    expect(getByText('Topic-Based')).toBeTruthy();
  });

  it('renders analysis scope label', () => {
    const { getByText } = render(<CreateContradictionScreen />, { wrapper: createWrapper() });
    expect(getByText('Analysis Scope')).toBeTruthy();
  });
});
