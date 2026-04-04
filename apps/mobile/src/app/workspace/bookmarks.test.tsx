import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';
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

const mockUseBookmarks = jest.fn();
const mockDeleteMutate = jest.fn();
jest.mock('../../features/bookmarks/hooks/use-bookmarks', () => ({
  useBookmarks: () => mockUseBookmarks(),
  useDeleteBookmark: () => ({ mutate: mockDeleteMutate }),
}));

import BookmarksScreen from './bookmarks';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('BookmarksScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows empty state', () => {
    mockUseBookmarks.mockReturnValue({ data: { data: [] }, isLoading: false, isFetching: false, refetch: jest.fn() });
    const { getByText } = render(<BookmarksScreen />, { wrapper: createWrapper() });
    expect(getByText(/No bookmarks/i)).toBeTruthy();
  });

  it('renders bookmark cards', () => {
    mockUseBookmarks.mockReturnValue({
      data: {
        data: [
          { id: 'b-1', legalDocumentId: 'doc-1', note: 'Important case', createdAt: '2024-03-01', legalDocument: { id: 'doc-1', title: 'People v. Test', documentType: 'case', grNo: '12345', court: 'SC', decisionDate: '2024-01-01' } },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<BookmarksScreen />, { wrapper: createWrapper() });
    expect(getByText('People v. Test')).toBeTruthy();
    expect(getByText('Important case')).toBeTruthy();
  });

  it('navigates to reader on card press', () => {
    mockUseBookmarks.mockReturnValue({
      data: {
        data: [
          { id: 'b-1', legalDocumentId: 'doc-1', note: null, createdAt: '2024-03-01', legalDocument: { id: 'doc-1', title: 'Test Doc', documentType: 'case' } },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<BookmarksScreen />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Test Doc'));
    const { router } = require('expo-router');
    expect(router.push).toHaveBeenCalledWith('/reader/doc-1');
  });
});
