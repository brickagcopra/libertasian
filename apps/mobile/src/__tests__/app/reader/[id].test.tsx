import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => ({ id: 'doc-1' })),
  router: { back: jest.fn(), push: jest.fn() },
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

const mockUseDigests = jest.fn();
jest.mock('@/features/digests/hooks/use-digests', () => ({
  useDigests: (...args: unknown[]) => mockUseDigests(...args),
  useGenerateDigest: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock('@/features/documents/hooks/use-recently-viewed', () => ({
  useRecentlyViewed: () => ({ addEntry: jest.fn() }),
}));

jest.mock('@/features/documents/hooks/use-documents', () => ({
  useDocumentCitations: () => ({ data: [], isLoading: false }),
  useRelatedDocuments: () => ({ data: [], isLoading: false }),
}));

jest.mock('@/features/study/hooks/use-offline-codals', () => ({
  useOfflineCodals: () => ({
    isOffline: jest.fn(() => false),
    saveForOffline: jest.fn(),
    removeOffline: jest.fn(),
    saving: null,
  }),
}));

jest.mock('@/features/documents/components/content-disclaimer', () => ({
  ContentDisclaimer: ({ contentClass }: { contentClass: string }) => {
    const { Text } = require('react-native');
    return <Text>disclaimer:{contentClass}</Text>;
  },
}));

import ReaderRoute from '@/app/reader/[id]';

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseBookmarks.mockReturnValue({ data: { data: [] } });
  mockUseDocumentSections.mockReturnValue({ data: null, isLoading: false });
  mockUseDigests.mockReturnValue({ data: { data: [] } });
});

function baseDoc(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'doc-1',
    title: 'Test',
    shortTitle: null,
    documentType: 'case_decision',
    grNo: null,
    ponente: null,
    decisionDate: null,
    court: null,
    citationText: null,
    docketNo: null,
    agency: null,
    jurisdiction: 'PH',
    language: 'en',
    promulgationDate: null,
    publicationDate: null,
    status: 'published',
    isOfficial: false,
    isPublished: true,
    truthfulnessStatus: 'verified',
    versionNo: 1,
    createdAt: '2024-01-15T00:00:00Z',
    ...overrides,
  };
}

describe('ReaderRoute (Phase 3 DocumentReaderScreen)', () => {
  it('shows the not-found state when the document fails to load', () => {
    mockUseDocument.mockReturnValue({ data: null, isLoading: false, error: new Error('Not found') });
    const { getByText } = render(<ReaderRoute />, { wrapper: createWrapper() });
    expect(getByText('Document not found')).toBeTruthy();
  });

  it('renders the redesigned reader header with eyebrow + title + meta', () => {
    mockUseDocument.mockReturnValue({
      data: {
        id: 'doc-1',
        title: 'People v. Dela Cruz',
        shortTitle: 'Dela Cruz',
        documentType: 'supreme_court_decision',
        grNo: 'G.R. No. 123456',
        ponente: 'J. Reyes',
        decisionDate: '2024-01-15T00:00:00Z',
        court: 'Supreme Court',
        citationText: null,
        docketNo: null,
        agency: null,
        jurisdiction: 'PH',
        language: 'en',
        promulgationDate: null,
        publicationDate: null,
        status: 'published',
        isOfficial: true,
        isPublished: true,
        truthfulnessStatus: 'verified',
        versionNo: 1,
        createdAt: '2024-01-15T00:00:00Z',
      },
      isLoading: false,
      error: null,
    });

    const { getByText } = render(<ReaderRoute />, { wrapper: createWrapper() });

    // Title — uses shortTitle if present.
    expect(getByText('Dela Cruz')).toBeTruthy();
    // Eyebrow comes from the doc-type label map.
    expect(getByText('Supreme Court · Case')).toBeTruthy();
    // Meta concatenates citation/grNo + ponente + decision date.
    expect(getByText(/G\.R\. No\. 123456/)).toBeTruthy();
    expect(getByText(/J\. Reyes/)).toBeTruthy();
  });

  it('renders sections grouped from plainText paragraphs', () => {
    mockUseDocument.mockReturnValue({
      data: {
        id: 'doc-1',
        title: 'Test',
        shortTitle: null,
        documentType: 'case_decision',
        grNo: null,
        ponente: null,
        decisionDate: null,
        court: null,
        citationText: null,
        docketNo: null,
        agency: null,
        jurisdiction: 'PH',
        language: 'en',
        promulgationDate: null,
        publicationDate: null,
        status: 'published',
        isOfficial: false,
        isPublished: true,
        truthfulnessStatus: 'verified',
        versionNo: 1,
        createdAt: '2024-01-15T00:00:00Z',
      },
      isLoading: false,
      error: null,
    });
    mockUseDocumentSections.mockReturnValue({
      data: [
        {
          id: 's-1',
          legalDocumentId: 'doc-1',
          parentSectionId: null,
          sectionType: 'facts',
          sectionLabel: 'Facts',
          ordering: 1,
          plainText: 'Para one.\n\nPara two.',
          htmlText: null,
          pageStart: 1,
          pageEnd: 2,
          tokenCount: null,
          createdAt: '2024-01-15T00:00:00Z',
        },
      ],
      isLoading: false,
    });

    const { getByText } = render(<ReaderRoute />, { wrapper: createWrapper() });
    expect(getByText('Facts')).toBeTruthy();
    expect(getByText('Para one.')).toBeTruthy();
    expect(getByText('Para two.')).toBeTruthy();
  });
});

describe('ReaderRoute — codal-class digest UI gating', () => {
  describe.each([
    'codal',
    'constitution',
    'rules_of_court',
    'republic_act',
  ])('documentType=%s (codal-class)', (docType) => {
    it('disables useDigests and hides Generate Digest FAB + Digest-available link', () => {
      mockUseDocument.mockReturnValue({
        data: baseDoc({ id: 'doc-1', documentType: docType, isOfficial: true }),
        isLoading: false,
        error: null,
      });
      // Even if a digest existed server-side, the hook would be disabled.
      mockUseDigests.mockReturnValue({
        data: { data: [{ id: 'pre-existing-digest' }] },
      });

      const { queryByLabelText, queryByText } = render(<ReaderRoute />, {
        wrapper: createWrapper(),
      });

      // useDigests should be called with enabled:false for codal-class docs.
      expect(mockUseDigests).toHaveBeenCalled();
      const lastCall = mockUseDigests.mock.calls.at(-1) as unknown[];
      expect(lastCall[1]).toEqual({ enabled: false });

      // FAB is gated by the onAdd prop — DocumentReaderScreen renders nothing
      // when onAdd is undefined.
      expect(queryByLabelText('Add note')).toBeNull();
      // The "Digest available" link is also hidden.
      expect(queryByText('Digest available')).toBeNull();
    });
  });

  describe.each(['decision', 'administrative_matter', 'case_decision'])(
    'documentType=%s (non-codal)',
    (docType) => {
      it('enables useDigests and renders the Generate Digest FAB', () => {
        mockUseDocument.mockReturnValue({
          data: baseDoc({ id: 'doc-1', documentType: docType }),
          isLoading: false,
          error: null,
        });
        mockUseDigests.mockReturnValue({ data: { data: [] } });

        const { queryByLabelText } = render(<ReaderRoute />, {
          wrapper: createWrapper(),
        });

        expect(mockUseDigests).toHaveBeenCalled();
        const lastCall = mockUseDigests.mock.calls.at(-1) as unknown[];
        // Either no options arg (legacy) or enabled:true.
        const opts = lastCall[1] as { enabled?: boolean } | undefined;
        expect(opts?.enabled ?? true).toBe(true);

        expect(queryByLabelText('Add note')).toBeTruthy();
      });

      it('renders the Digest-available link when a digest exists', () => {
        mockUseDocument.mockReturnValue({
          data: baseDoc({ id: 'doc-1', documentType: docType }),
          isLoading: false,
          error: null,
        });
        mockUseDigests.mockReturnValue({
          data: { data: [{ id: 'digest-7' }] },
        });

        const { getByText } = render(<ReaderRoute />, {
          wrapper: createWrapper(),
        });
        expect(getByText('Digest available')).toBeTruthy();
      });
    },
  );
});
