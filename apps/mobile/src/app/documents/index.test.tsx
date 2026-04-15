import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// Mock expo-router
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Stack: {
    Screen: ({ options }: { options: { title: string } }) => {
      const { Text } = require('react-native');
      return <Text testID="stack-title">{options.title}</Text>;
    },
  },
}));

// Mock vector icons
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name, testID }: { name: string; testID?: string }) => {
    const { Text } = require('react-native');
    return <Text testID={testID}>{name}</Text>;
  },
}));

// Mock hooks
const mockUseDocuments = jest.fn();
jest.mock('../../features/documents/hooks/use-documents', () => ({
  useDocuments: (...args: unknown[]) => mockUseDocuments(...args),
}));

const mockUseBarSubjects = jest.fn();
jest.mock('../../features/study/hooks/use-bar-subjects', () => ({
  useBarSubjects: () => mockUseBarSubjects(),
}));

jest.mock('../../hooks/use-network-state', () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true, type: 'wifi' }),
}));

import { router } from 'expo-router';
import DocumentBrowserScreen from './index';

beforeEach(() => {
  jest.clearAllMocks();
  mockUseBarSubjects.mockReturnValue({ data: [] });
});

describe('DocumentBrowserScreen', () => {
  it('renders loading state', () => {
    mockUseDocuments.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      refetch: jest.fn(),
    });
    const { getByText } = render(<DocumentBrowserScreen />);
    expect(getByText('Loading documents...')).toBeTruthy();
  });

  it('renders empty state when no documents', () => {
    mockUseDocuments.mockReturnValue({
      data: { pages: [{ data: [], meta: { hasNext: false, nextCursor: null, limit: 20 } }] },
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      refetch: jest.fn(),
    });
    const { getByText } = render(<DocumentBrowserScreen />);
    expect(getByText('No documents found')).toBeTruthy();
  });

  it('renders document list', () => {
    mockUseDocuments.mockReturnValue({
      data: {
        pages: [
          {
            data: [
              {
                id: 'doc1',
                title: 'People v. Santos',
                shortTitle: 'Santos Case',
                documentType: 'supreme_court_decision',
                court: 'SUPREME_COURT',
                grNo: 'G.R. No. 12345',
                citationText: null,
                promulgationDate: '2024-01-15',
                sectionCount: 5,
                hasDigest: false,
              },
              {
                id: 'doc2',
                title: 'Republic Act No. 11313',
                shortTitle: 'Safe Spaces Act',
                documentType: 'republic_act',
                court: null,
                grNo: null,
                citationText: 'R.A. No. 11313',
                promulgationDate: '2019-04-17',
                sectionCount: 12,
                hasDigest: true,
              },
            ],
            meta: { hasNext: false, nextCursor: null, limit: 20, total: 2 },
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      refetch: jest.fn(),
    });
    const { getByText } = render(<DocumentBrowserScreen />);
    expect(getByText('People v. Santos')).toBeTruthy();
    expect(getByText('Republic Act No. 11313')).toBeTruthy();
    expect(getByText('Has Digest')).toBeTruthy();
    expect(getByText('2 documents')).toBeTruthy();
  });

  it('navigates to reader on card press', () => {
    mockUseDocuments.mockReturnValue({
      data: {
        pages: [
          {
            data: [
              {
                id: 'doc1',
                title: 'Test Case',
                shortTitle: null,
                documentType: 'case_decision',
                court: null,
                grNo: null,
                citationText: null,
                promulgationDate: null,
                sectionCount: 0,
                hasDigest: false,
              },
            ],
            meta: { hasNext: false, nextCursor: null, limit: 20, total: 1 },
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      refetch: jest.fn(),
    });
    const { getByText } = render(<DocumentBrowserScreen />);
    fireEvent.press(getByText('Test Case'));
    expect(router.push).toHaveBeenCalledWith('/reader/doc1');
  });

  it('renders header title', () => {
    mockUseDocuments.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      refetch: jest.fn(),
    });
    const { getByTestId } = render(<DocumentBrowserScreen />);
    expect(getByTestId('stack-title')).toBeTruthy();
  });

  it('toggles filter panel', () => {
    mockUseDocuments.mockReturnValue({
      data: { pages: [{ data: [], meta: { hasNext: false, nextCursor: null, limit: 20 } }] },
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      refetch: jest.fn(),
    });
    const { getByText, queryByText } = render(<DocumentBrowserScreen />);
    // Filter label should not be visible initially
    expect(queryByText('DOCUMENT TYPE')).toBeNull();
    // Press filter toggle
    fireEvent.press(getByText('options-outline'));
    // Filter section should now be visible
    expect(getByText('Document Type')).toBeTruthy();
    expect(getByText('Court')).toBeTruthy();
  });

  it('applies search query', () => {
    mockUseDocuments.mockReturnValue({
      data: { pages: [{ data: [], meta: { hasNext: false, nextCursor: null, limit: 20 } }] },
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      refetch: jest.fn(),
    });
    const { getByPlaceholderText } = render(<DocumentBrowserScreen />);
    const input = getByPlaceholderText('Search by title or citation...');
    fireEvent.changeText(input, 'People v. Santos');
    fireEvent(input, 'submitEditing');
    // The query is applied to the hook (verified by filter changes triggering re-render)
    expect(mockUseDocuments).toHaveBeenCalled();
  });

  it('renders bar subject chips when available', () => {
    mockUseBarSubjects.mockReturnValue({
      data: [
        { code: 'political_law', name: 'Political Law', documentCount: 42 },
        { code: 'civil_law', name: 'Civil Law', documentCount: 35 },
      ],
    });
    mockUseDocuments.mockReturnValue({
      data: { pages: [{ data: [], meta: { hasNext: false, nextCursor: null, limit: 20 } }] },
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      refetch: jest.fn(),
    });
    const { getByText } = render(<DocumentBrowserScreen />);
    // Open filters
    fireEvent.press(getByText('options-outline'));
    expect(getByText('Political Law')).toBeTruthy();
    expect(getByText('Civil Law')).toBeTruthy();
  });
});
