import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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

const mockUseAnnotations = jest.fn();
const mockCreateAnnotation = jest.fn();
const mockDeleteAnnotation = jest.fn();
jest.mock('@/features/annotations/hooks/use-annotations', () => ({
  useAnnotations: (...args: unknown[]) => mockUseAnnotations(...args),
  useCreateAnnotation: () => ({ mutateAsync: mockCreateAnnotation, isPending: false }),
  useDeleteAnnotation: () => ({ mutateAsync: mockDeleteAnnotation, isPending: false }),
}));

jest.mock('@/features/documents/hooks/use-documents', () => ({
  useDocumentCitations: () => ({ data: [], isLoading: false }),
  useRelatedDocuments: () => ({ data: [], isLoading: false }),
}));

// Edu+ paywall gate — default unlocked so pre-existing tests exercise the
// normal create sheets. The paywall describe block flips `locked` per test.
const mockUseCanUseBookmarksAnnotations = jest.fn();
jest.mock('@/features/billing/hooks/use-can-use-bookmarks-annotations', () => ({
  useCanUseBookmarksAnnotations: (...args: unknown[]) =>
    mockUseCanUseBookmarksAnnotations(...args),
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
  mockUseAnnotations.mockReturnValue({ data: [] });
  mockCreateAnnotation.mockResolvedValue({ id: 'an-new' });
  mockDeleteAnnotation.mockResolvedValue({ message: 'Annotation deleted' });
  mockUseCanUseBookmarksAnnotations.mockReturnValue({
    locked: false,
    planName: 'Free',
  });
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

function sectionWith(plainText: string) {
  return {
    id: 's-1',
    legalDocumentId: 'doc-1',
    parentSectionId: null,
    sectionType: 'facts',
    sectionLabel: 'Facts',
    ordering: 1,
    plainText,
    htmlText: null,
    pageStart: 1,
    pageEnd: 2,
    tokenCount: null,
    createdAt: '2024-01-15T00:00:00Z',
  };
}

function annotation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'an-1',
    userId: 'u-1',
    legalDocumentId: 'doc-1',
    sectionId: 's-1',
    textAnchor: { startOffset: 0, endOffset: 5, anchorText: 'Alpha' },
    annotationText: null,
    color: 'yellow',
    createdAt: '2024-01-15T00:00:00Z',
    ...overrides,
  };
}

describe('ReaderRoute — annotation anchor offsets', () => {
  beforeEach(() => {
    mockUseDocument.mockReturnValue({
      data: baseDoc(),
      isLoading: false,
      error: null,
    });
  });

  it('anchors an annotation on the SECOND of two identical paragraphs at the second offset', async () => {
    // "Same para." occurs at offsets 0 and 12 ("Same para." = 10 chars + "\n\n").
    mockUseDocumentSections.mockReturnValue({
      data: [sectionWith('Same para.\n\nSame para.')],
      isLoading: false,
    });

    const { getAllByText, getByText } = render(<ReaderRoute />, {
      wrapper: createWrapper(),
    });

    const paragraphs = getAllByText('Same para.');
    expect(paragraphs).toHaveLength(2);

    // Long-press the SECOND occurrence and save the highlight.
    fireEvent(paragraphs[1], 'longPress');
    fireEvent.press(getByText('Save highlight'));

    await waitFor(() => expect(mockCreateAnnotation).toHaveBeenCalledTimes(1));
    expect(mockCreateAnnotation).toHaveBeenCalledWith({
      legalDocumentId: 'doc-1',
      sectionId: 's-1',
      textAnchor: {
        startOffset: 12,
        endOffset: 22,
        anchorText: 'Same para.',
      },
      annotationText: undefined,
      color: 'yellow',
    });
  });

  it('anchors the FIRST of two identical paragraphs at offset 0', async () => {
    mockUseDocumentSections.mockReturnValue({
      data: [sectionWith('Same para.\n\nSame para.')],
      isLoading: false,
    });

    const { getAllByText, getByText } = render(<ReaderRoute />, {
      wrapper: createWrapper(),
    });

    fireEvent(getAllByText('Same para.')[0], 'longPress');
    fireEvent.press(getByText('Save highlight'));

    await waitFor(() => expect(mockCreateAnnotation).toHaveBeenCalledTimes(1));
    expect(mockCreateAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        textAnchor: { startOffset: 0, endOffset: 10, anchorText: 'Same para.' },
      }),
    );
  });
});

describe('ReaderRoute — multi-annotation view sheet', () => {
  beforeEach(() => {
    mockUseDocument.mockReturnValue({
      data: baseDoc(),
      isLoading: false,
      error: null,
    });
    mockUseDocumentSections.mockReturnValue({
      data: [sectionWith('Alpha beta gamma delta.')],
      isLoading: false,
    });
    mockUseAnnotations.mockReturnValue({
      data: [
        annotation({
          id: 'an-1',
          textAnchor: { startOffset: 0, endOffset: 5, anchorText: 'Alpha' },
          annotationText: 'First note',
          color: 'yellow',
        }),
        annotation({
          id: 'an-2',
          textAnchor: { startOffset: 6, endOffset: 10, anchorText: 'beta' },
          annotationText: null,
          color: 'green',
        }),
      ],
    });
  });

  it('lists EVERY annotation overlapping the tapped paragraph', () => {
    const { getByText, getAllByText } = render(<ReaderRoute />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('Alpha beta gamma delta.'));

    // Sheet header reflects the count, and both entries render with their
    // own note (or placeholder) and their own delete button.
    expect(getByText('Annotations (2)')).toBeTruthy();
    expect(getByText('First note')).toBeTruthy();
    expect(getByText('No note added.')).toBeTruthy();
    expect(getByText('“Alpha”')).toBeTruthy();
    expect(getByText('“beta”')).toBeTruthy();
    expect(getAllByText('Delete highlight')).toHaveLength(2);
  });

  it('deletes only the annotation whose delete button was pressed', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByText, getAllByText } = render(<ReaderRoute />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByText('Alpha beta gamma delta.'));
    fireEvent.press(getAllByText('Delete highlight')[1]);

    // Existing confirm pattern — Alert with Cancel/Delete.
    expect(alertSpy).toHaveBeenCalledWith(
      'Delete annotation',
      'Remove this highlight and its note?',
      expect.any(Array),
    );
    const buttons = alertSpy.mock.calls.at(-1)?.[2] as Array<{
      text: string;
      onPress?: () => void | Promise<void>;
    }>;
    const confirm = buttons.find((b) => b.text === 'Delete');
    await act(async () => {
      await confirm?.onPress?.();
    });

    await waitFor(() => expect(mockDeleteAnnotation).toHaveBeenCalledTimes(1));
    expect(mockDeleteAnnotation).toHaveBeenCalledWith('an-2');
    // The remaining annotation is still listed in the sheet.
    expect(getByText('First note')).toBeTruthy();
    expect(getAllByText('Delete highlight')).toHaveLength(1);
  });
});

describe('ReaderRoute — Edu+ paywall (bookmarks + annotations)', () => {
  beforeEach(() => {
    mockUseDocument.mockReturnValue({
      data: baseDoc(),
      isLoading: false,
      error: null,
    });
    mockUseDocumentSections.mockReturnValue({
      data: [sectionWith('Alpha beta gamma delta.')],
      isLoading: false,
    });
  });

  describe('below-edu org (locked)', () => {
    beforeEach(() => {
      mockUseCanUseBookmarksAnnotations.mockReturnValue({
        locked: true,
        planName: 'Free',
      });
    });

    it('long-press opens the upsell sheet instead of the create sheet', () => {
      const { getByText, queryByText } = render(<ReaderRoute />, {
        wrapper: createWrapper(),
      });

      fireEvent(getByText('Alpha beta gamma delta.'), 'longPress');

      expect(getByText('Available on Edu plans and above')).toBeTruthy();
      expect(
        getByText(/Save bookmarks and highlight passages with notes/),
      ).toBeTruthy();
      expect(getByText(/You're on the Free plan/)).toBeTruthy();
      // Create sheet never opened and no annotation request fired.
      expect(queryByText('Highlight paragraph')).toBeNull();
      expect(queryByText('Save highlight')).toBeNull();
      expect(mockCreateAnnotation).not.toHaveBeenCalled();
    });

    it('bookmark button opens the upsell sheet instead of the note sheet', () => {
      const { getByLabelText, getByText, queryByText } = render(
        <ReaderRoute />,
        { wrapper: createWrapper() },
      );

      fireEvent.press(getByLabelText('Bookmark'));

      expect(getByText('Available on Edu plans and above')).toBeTruthy();
      // Bookmark note sheet never opened.
      expect(queryByText('Add a note')).toBeNull();
      expect(queryByText('Save bookmark')).toBeNull();
    });

    it('"See plans" navigates to Settings → Plans', () => {
      const { router } = jest.requireMock('expo-router') as {
        router: { push: jest.Mock };
      };
      const { getByLabelText, getByText } = render(<ReaderRoute />, {
        wrapper: createWrapper(),
      });

      fireEvent.press(getByLabelText('Bookmark'));
      fireEvent.press(getByText('See plans'));

      expect(router.push).toHaveBeenCalledWith('/settings/plans');
    });
  });

  describe('edu+ org (unlocked)', () => {
    beforeEach(() => {
      mockUseCanUseBookmarksAnnotations.mockReturnValue({
        locked: false,
        planName: 'Edu',
      });
    });

    it('long-press opens the create-annotation sheet and saving fires the mutation', async () => {
      const { getByText, queryByText } = render(<ReaderRoute />, {
        wrapper: createWrapper(),
      });

      fireEvent(getByText('Alpha beta gamma delta.'), 'longPress');

      expect(queryByText('Available on Edu plans and above')).toBeNull();
      fireEvent.press(getByText('Save highlight'));

      await waitFor(() => expect(mockCreateAnnotation).toHaveBeenCalledTimes(1));
    });

    it('bookmark button opens the note sheet', () => {
      const { getByLabelText, getByText, queryByText } = render(
        <ReaderRoute />,
        { wrapper: createWrapper() },
      );

      fireEvent.press(getByLabelText('Bookmark'));

      expect(getByText('Add a note')).toBeTruthy();
      expect(queryByText('Available on Edu plans and above')).toBeNull();
    });
  });
});
