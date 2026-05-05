import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { back: jest.fn(), push: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockMutateAsync = jest.fn();
jest.mock('@/features/workspace/hooks/use-matters', () => ({
  useCreateMatter: () => ({ mutateAsync: (...a: unknown[]) => mockMutateAsync(...a), isPending: false, error: null }),
}));

import CreateMatterScreen from '@/app/workspace/matters/create';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('CreateMatterScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders title field with correct placeholder', () => {
    const { getByPlaceholderText } = render(<CreateMatterScreen />, { wrapper: createWrapper() });
    expect(getByPlaceholderText('e.g. Reyes v. Santos')).toBeTruthy();
  });

  it('renders matter type chips', () => {
    const { getByText } = render(<CreateMatterScreen />, { wrapper: createWrapper() });
    expect(getByText('Civil')).toBeTruthy();
    expect(getByText('Criminal')).toBeTruthy();
    expect(getByText('Labor')).toBeTruthy();
    expect(getByText('Commercial')).toBeTruthy();
    expect(getByText('Administrative')).toBeTruthy();
    expect(getByText('Special Proceedings')).toBeTruthy();
    expect(getByText('Other')).toBeTruthy();
  });

  it('renders description and court fields with correct placeholders', () => {
    const { getByPlaceholderText } = render(<CreateMatterScreen />, { wrapper: createWrapper() });
    expect(getByPlaceholderText('Brief description of the matter...')).toBeTruthy();
    expect(getByPlaceholderText('e.g. RTC Branch 123, Manila')).toBeTruthy();
  });

  it('renders field labels', () => {
    const { getByText } = render(<CreateMatterScreen />, { wrapper: createWrapper() });
    expect(getByText('Title *')).toBeTruthy();
    expect(getByText('Description')).toBeTruthy();
    expect(getByText('Type')).toBeTruthy();
    expect(getByText('Court')).toBeTruthy();
  });

  it('allows selecting a matter type chip', () => {
    const { getByText } = render(<CreateMatterScreen />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Criminal'));
    // The chip should toggle (no assertion on visual change needed, just no crash)
    expect(getByText('Criminal')).toBeTruthy();
  });
});
