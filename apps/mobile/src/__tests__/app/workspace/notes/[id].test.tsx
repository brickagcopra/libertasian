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
  useLocalSearchParams: jest.fn(() => ({ id: 'n-1' })),
  router: { back: jest.fn(), push: jest.fn() },
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseNote = jest.fn();
jest.mock('@/features/workspace/hooks/use-notes', () => ({
  useNote: (...args: unknown[]) => mockUseNote(...args),
  useUpdateNote: () => ({
    mutateAsync: jest.fn(),
    mutate: jest.fn(),
    isPending: false,
  }),
  useDeleteNote: () => ({
    mutateAsync: jest.fn(),
    mutate: jest.fn(),
  }),
}));

import NoteDetailScreen from '@/app/workspace/notes/[id]';

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

describe('NoteDetailScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows loading state', () => {
    mockUseNote.mockReturnValue({ data: undefined, isLoading: true });
    const { UNSAFE_root } = render(<NoteDetailScreen />, {
      wrapper: createWrapper(),
    });
    expect(UNSAFE_root).toBeTruthy();
  });

  it('renders note title and body', () => {
    mockUseNote.mockReturnValue({
      data: {
        id: 'n-1',
        title: 'My Research',
        visibility: 'private',
        body: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Research body here' }],
            },
          ],
        },
        createdAt: '2024-03-01',
        updatedAt: '2024-03-02',
        user: { id: 'u-1', fullName: 'Juan' },
        matter: null,
      },
      isLoading: false,
    });
    const { getByText } = render(<NoteDetailScreen />, {
      wrapper: createWrapper(),
    });
    expect(getByText('My Research')).toBeTruthy();
    expect(getByText('Research body here')).toBeTruthy();
  });
});
