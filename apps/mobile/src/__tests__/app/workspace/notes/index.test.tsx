import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { push: jest.fn(), back: jest.fn() },
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseNotes = jest.fn();
const mockDeleteNote = { mutate: jest.fn(), mutateAsync: jest.fn() };
jest.mock('@/features/workspace/hooks/use-notes', () => ({
  useNotes: (...args: unknown[]) => mockUseNotes(...args),
  useDeleteNote: () => mockDeleteNote,
}));

import NotesListScreen from '@/app/workspace/notes/index';

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('NotesListScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows empty state', () => {
    mockUseNotes.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<NotesListScreen />, {
      wrapper: createWrapper(),
    });
    expect(getByText('No notes yet')).toBeTruthy();
  });

  it('renders note cards', () => {
    mockUseNotes.mockReturnValue({
      data: {
        data: [
          {
            id: 'n-1',
            title: 'Research Notes',
            visibility: 'private',
            body: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'My notes here' }],
                },
              ],
            },
            createdAt: '2024-03-01',
            updatedAt: '2024-03-01',
            user: { id: 'u-1', fullName: 'Juan' },
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<NotesListScreen />, {
      wrapper: createWrapper(),
    });
    expect(getByText('Research Notes')).toBeTruthy();
  });

  it('renders visibility filter chips', () => {
    mockUseNotes.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<NotesListScreen />, {
      wrapper: createWrapper(),
    });
    expect(getByText('All')).toBeTruthy();
    expect(getByText('Private')).toBeTruthy();
  });
});
