import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock Stack.Screen to render headerRight if provided
jest.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options?: { headerRight?: () => React.ReactNode } }) => {
      const { View } = require('react-native');
      if (options?.headerRight) {
        return <View testID="header-right">{options.headerRight()}</View>;
      }
      return null;
    },
  },
  router: { back: jest.fn(), push: jest.fn() },
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));
jest.mock('../../../features/workspace/hooks/use-notes', () => ({
  useCreateNote: () => ({
    mutateAsync: jest.fn(),
    isPending: false,
    error: null,
  }),
}));

import CreateNoteScreen from './create';

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

describe('CreateNoteScreen', () => {
  it('renders title input and visibility toggles', () => {
    const { getByPlaceholderText, getByText } = render(
      <CreateNoteScreen />,
      { wrapper: createWrapper() },
    );
    expect(getByPlaceholderText('Note title (optional)')).toBeTruthy();
    expect(getByText('Private')).toBeTruthy();
    expect(getByText('Organization')).toBeTruthy();
  });

  it('renders Save button in header', () => {
    const { getByText } = render(<CreateNoteScreen />, {
      wrapper: createWrapper(),
    });
    expect(getByText('Save')).toBeTruthy();
  });
});
