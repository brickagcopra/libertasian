import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => ({ id: 'doc-1' })),
  router: { back: jest.fn(), push: jest.fn() },
  Stack: { Screen: ({ options }: { options: { title: string } }) => {
    const { Text } = require('react-native');
    return <Text>StackScreen: {options?.title}</Text>;
  }},
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

const mockUseDocument = jest.fn();
const mockUseDocumentSections = jest.fn();
jest.mock('@/features/documents/hooks/use-document', () => ({
  useDocument: (...args: unknown[]) => mockUseDocument(...args),
  useDocumentSections: (...args: unknown[]) => mockUseDocumentSections(...args),
}));

const mockUseBookmarks = jest.fn();
jest.mock('@/features/bookmarks/hooks/use-bookmarks', () => ({
  useBookmarks: (...args: unknown[]) => mockUseBookmarks(...args),
  useCreateBookmark: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock('@/features/digests/hooks/use-digests', () => ({
  useDigests: () => ({ data: null }),
  useGenerateDigest: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock('@/features/documents/hooks/use-documents', () => ({
  useDocumentCitations: () => ({ data: [], isLoading: false }),
  useRelatedDocuments: () => ({ data: [], isLoading: false }),
}));

jest.mock('@/features/documents/hooks/use-recently-viewed', () => ({
  useRecentlyViewed: () => ({ addEntry: jest.fn() }),
}));

jest.mock('@/features/study/hooks/use-offline-codals', () => ({
  useOfflineCodals: () => ({
    isOffline: jest.fn(() => false),
    saveForOffline: jest.fn(),
    removeOffline: jest.fn(),
    saving: null,
  }),
}));

jest.mock('@/features/study/components/offline-badge', () => ({
  OfflineBadge: () => {
    const { Text } = require('react-native');
    return <Text>OfflineBadge</Text>;
  },
}));

import ReaderScreen from '@/app/reader/[id]';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('ReaderScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseBookmarks.mockReturnValue({ data: { data: [] } });
    mockUseDocumentSections.mockReturnValue({ data: null, isLoading: false });
  });

  it('shows loading state', () => {
    mockUseDocument.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { getByText } = render(<ReaderScreen />, { wrapper: createWrapper() });
    expect(getByText('StackScreen: Loading...')).toBeTruthy();
  });

  it('shows error state when document not found', () => {
    mockUseDocument.mockReturnValue({ data: null, isLoading: false, error: new Error('Not found') });
    const { getByText } = render(<ReaderScreen />, { wrapper: createWrapper() });
    expect(getByText('Document not found')).toBeTruthy();
    expect(getByText('Go Back')).toBeTruthy();
  });

  it('navigates back on Go Back in error state', () => {
    mockUseDocument.mockReturnValue({ data: null, isLoading: false, error: new Error('Not found') });
    const { getByText } = render(<ReaderScreen />, { wrapper: createWrapper() });
    fireEvent.press(getByText('Go Back'));
    const { router } = require('expo-router');
    expect(router.back).toHaveBeenCalled();
  });

  it('renders document header with title and metadata', () => {
    mockUseDocument.mockReturnValue({
      data: {
        id: 'doc-1',
        title: 'People v. Dela Cruz',
        shortTitle: 'Dela Cruz',
        documentType: 'case',
        isOfficial: true,
        grNo: '123456',
        court: 'Supreme Court',
        ponente: 'Reyes',
        decisionDate: '2024-01-15',
      },
      isLoading: false,
      error: null,
    });
    const { getByText } = render(<ReaderScreen />, { wrapper: createWrapper() });
    expect(getByText('People v. Dela Cruz')).toBeTruthy();
    expect(getByText('case')).toBeTruthy();
    expect(getByText('Official')).toBeTruthy();
    expect(getByText('123456')).toBeTruthy();
    expect(getByText('Supreme Court')).toBeTruthy();
    expect(getByText('J. Reyes')).toBeTruthy();
  });

  it('shows Generate Digest and Save Offline buttons', () => {
    mockUseDocument.mockReturnValue({
      data: { id: 'doc-1', title: 'Test', shortTitle: null, documentType: 'case', isOfficial: false },
      isLoading: false,
      error: null,
    });
    const { getByText } = render(<ReaderScreen />, { wrapper: createWrapper() });
    expect(getByText('Generate Digest')).toBeTruthy();
    expect(getByText('Save Offline')).toBeTruthy();
  });

  it('shows Bookmark button when not bookmarked', () => {
    mockUseDocument.mockReturnValue({
      data: { id: 'doc-1', title: 'Test', shortTitle: null, documentType: 'case', isOfficial: false },
      isLoading: false,
      error: null,
    });
    mockUseBookmarks.mockReturnValue({ data: { data: [] } });
    const { getByText } = render(<ReaderScreen />, { wrapper: createWrapper() });
    expect(getByText('Bookmark')).toBeTruthy();
  });

  it('shows Bookmarked badge when already bookmarked', () => {
    mockUseDocument.mockReturnValue({
      data: { id: 'doc-1', title: 'Test', shortTitle: null, documentType: 'case', isOfficial: false },
      isLoading: false,
      error: null,
    });
    mockUseBookmarks.mockReturnValue({ data: { data: [{ id: 'bk-1' }] } });
    const { getByText } = render(<ReaderScreen />, { wrapper: createWrapper() });
    expect(getByText('Bookmarked')).toBeTruthy();
  });

  it('renders document sections', () => {
    mockUseDocument.mockReturnValue({
      data: { id: 'doc-1', title: 'Test', shortTitle: null, documentType: 'case', isOfficial: false },
      isLoading: false,
      error: null,
    });
    mockUseDocumentSections.mockReturnValue({
      data: [
        { id: 's-1', sectionLabel: 'Facts', sectionType: 'facts', plainText: 'The facts of the case...', pageStart: 1, pageEnd: 3 },
        { id: 's-2', sectionLabel: null, sectionType: 'ruling', plainText: 'The court rules...', pageStart: 4, pageEnd: null },
      ],
      isLoading: false,
    });
    const { getByText } = render(<ReaderScreen />, { wrapper: createWrapper() });
    // Tabs should be visible
    expect(getByText(/Sections/)).toBeTruthy();
    expect(getByText(/Citations/)).toBeTruthy();
    expect(getByText(/Related/)).toBeTruthy();
    // Sections tab is active by default
    expect(getByText('Facts')).toBeTruthy();
    expect(getByText('The facts of the case...')).toBeTruthy();
    expect(getByText('p.1-3')).toBeTruthy();
    expect(getByText('ruling')).toBeTruthy();
  });

  it('shows empty sections message', () => {
    mockUseDocument.mockReturnValue({
      data: { id: 'doc-1', title: 'Test', shortTitle: null, documentType: 'case', isOfficial: false },
      isLoading: false,
      error: null,
    });
    mockUseDocumentSections.mockReturnValue({ data: [], isLoading: false });
    const { getByText } = render(<ReaderScreen />, { wrapper: createWrapper() });
    expect(getByText('No sections available for this document')).toBeTruthy();
  });
});
