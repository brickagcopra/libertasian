import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

const mockUseDocuments = jest.fn();
jest.mock('@/features/documents/hooks/use-documents', () => ({
  useDocuments: (...args: unknown[]) => mockUseDocuments(...args),
}));

jest.mock('@/hooks/use-network-state', () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true, type: 'wifi' }),
}));

import { router } from 'expo-router';
import DocumentsRoute from '@/app/documents/index';

beforeEach(() => {
  jest.clearAllMocks();
});

function noopPage<T>(data: T[]) {
  return {
    data: { pages: [{ data, meta: { hasNext: false, nextCursor: null, limit: 20, total: data.length } }] },
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: jest.fn(),
    refetch: jest.fn(),
  };
}

describe('DocumentsRoute (Phase 2 LibraryScreen)', () => {
  it('renders the redesigned Library screen with category filter chips', () => {
    mockUseDocuments.mockReturnValue(noopPage([]));
    const { getAllByText, getByText } = render(<DocumentsRoute />);

    // Title appears twice (header + bottom tab label) — assert it renders.
    expect(getAllByText('Library').length).toBeGreaterThanOrEqual(1);
    // Filter chips from FILTER_LABELS
    expect(getByText('All')).toBeTruthy();
    expect(getByText('Cases')).toBeTruthy();
    expect(getByText('Statutes')).toBeTruthy();
  });

  it('renders the redesigned search field copy', () => {
    mockUseDocuments.mockReturnValue(noopPage([]));
    const { getByText } = render(<DocumentsRoute />);
    // The search bar is a Pressable that displays the placeholder as Text,
    // not a TextInput — assert by text content.
    expect(getByText('Search 12,000+ cases & statutes')).toBeTruthy();
  });

  it('groups documents into sections by document type', () => {
    mockUseDocuments.mockReturnValue(
      noopPage([
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
      ]),
    );
    const { getByText } = render(<DocumentsRoute />);
    expect(getByText('People v. Santos')).toBeTruthy();
    expect(getByText('Republic Act No. 11313')).toBeTruthy();
  });

  it('navigates to /reader/:id on item press', () => {
    mockUseDocuments.mockReturnValue(
      noopPage([
        {
          id: 'doc1',
          title: 'Test Case',
          shortTitle: null,
          documentType: 'supreme_court_decision',
          court: null,
          grNo: null,
          citationText: null,
          promulgationDate: null,
          sectionCount: 0,
          hasDigest: false,
        },
      ]),
    );
    const { getByText } = render(<DocumentsRoute />);
    fireEvent.press(getByText('Test Case'));
    expect(router.push).toHaveBeenCalledWith('/reader/doc1');
  });

  it('shows the empty section when no documents are returned', () => {
    mockUseDocuments.mockReturnValue(noopPage([]));
    const { getByText } = render(<DocumentsRoute />);
    expect(getByText('No documents')).toBeTruthy();
  });

  it('exposes the camera Scan FAB', () => {
    mockUseDocuments.mockReturnValue(noopPage([]));
    const { getByLabelText } = render(<DocumentsRoute />);
    expect(getByLabelText('Scan a document')).toBeTruthy();
  });
});
