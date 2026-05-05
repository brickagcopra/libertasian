import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null }, router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) => { const { Text } = require('react-native'); return <Text>{name}</Text>; } }));
jest.mock('@/features/timelines/hooks/use-timelines', () => ({ useGenerateTimeline: () => ({ mutateAsync: jest.fn(), isPending: false }) }));
jest.mock('@/features/search/hooks/use-search', () => ({ useSearch: () => ({ data: null, isLoading: false }) }));

import CreateTimelineScreen from '@/app/workspace/timelines/create';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('CreateTimelineScreen', () => {
  it('renders title input and document search', () => {
    const { getByPlaceholderText } = render(<CreateTimelineScreen />, { wrapper: createWrapper() });
    expect(getByPlaceholderText(/History of Agrarian Reform/i)).toBeTruthy();
  });

  it('renders info text about timeline generation', () => {
    const { getByText } = render(<CreateTimelineScreen />, { wrapper: createWrapper() });
    expect(getByText(/chronological timeline/i)).toBeTruthy();
  });
});
