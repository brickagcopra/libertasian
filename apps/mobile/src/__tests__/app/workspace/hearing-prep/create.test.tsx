import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null }, router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) => { const { Text } = require('react-native'); return <Text>{name}</Text>; } }));
jest.mock('@/features/hearing-prep/hooks/use-hearing-prep', () => ({ useGenerateHearingPrep: () => ({ mutateAsync: jest.fn(), isPending: false }) }));
jest.mock('@/features/search/hooks/use-search', () => ({ useSearch: () => ({ data: null, isLoading: false }) }));

import CreateHearingPrepScreen from '@/app/workspace/hearing-prep/create';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('CreateHearingPrepScreen', () => {
  it('renders topic input', () => {
    const { getByText } = render(<CreateHearingPrepScreen />, { wrapper: createWrapper() });
    expect(getByText('Hearing Topic *')).toBeTruthy();
  });

  it('renders legal issue input', () => {
    const { getByText } = render(<CreateHearingPrepScreen />, { wrapper: createWrapper() });
    expect(getByText('Legal Issue (Optional)')).toBeTruthy();
  });
});
