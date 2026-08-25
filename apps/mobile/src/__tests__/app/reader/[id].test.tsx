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

const mockIsOffline = jest.fn(() => false);
const mockSaveForOffline = jest.fn();
const mockRemoveOffline = jest.fn();
jest.mock('@/features/study/hooks/use-offline-codals', () => ({
  useOfflineCodals: () => ({
    isOffline: (...args: unknown[]) => mockIsOffline(...(args as [])),
    saveForOffline: (...args: unknown[]) => mockSaveForOffline(...args),
    removeOffline: (...args: unknown[]) => mockRemoveOffline(...args),
    saving: null,
  }),
}));

// Audio rendition hook — the ONLY thing in the reader that hits the audio
// endpoint. Mocked so the section-audio tests can assert exactly which content
// ids were requested (and that nothing is requested on render: the first
// not-ready GET enqueues paid synthesis).
const mockUseAudioRendition = jest.fn();
jest.mock('@/features/audio/hooks/use-audio-rendition', () => ({
  useAudioRendition: (opts: unknown) => mockUseAudioRendition(opts),
  audioRenditionQueryKey: (t: string, i: string) => ['audio-rendition', t, i],
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
  mockIsOffline.mockReturnValue(false);
  mockUseAudioRendition.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isTakingTooLong: false,
    refetch: jest.fn(),
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

// Inverted deliberately. This suite used to assert that a below-Edu org got a
// not-included sheet instead of the bookmark / annotation / offline-save
// actions. The client no longer predicts entitlement from a plan code, so all
// three are unconditional and the sheet — with its tier wording — is gone.
// The request path's error Alert is the only remaining fallback.
describe('ReaderRoute — bookmarks, annotations and offline saving', () => {
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

  it('long-press opens the create-annotation sheet and saving fires the mutation', async () => {
    const { getByText, queryByText } = render(<ReaderRoute />, {
      wrapper: createWrapper(),
    });

    fireEvent(getByText('Alpha beta gamma delta.'), 'longPress');

    expect(
      queryByText(/plan|premium|upgrade|subscription|tier|not included/i),
    ).toBeNull();
    fireEvent.press(getByText('Save highlight'));

    await waitFor(() => expect(mockCreateAnnotation).toHaveBeenCalledTimes(1));
  });

  it('bookmark button opens the note sheet, with no gate in the way', () => {
    const { getByLabelText, getByText, queryByText } = render(<ReaderRoute />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByLabelText('Bookmark'));

    expect(getByText('Add a note')).toBeTruthy();
    expect(
      queryByText(/plan|premium|upgrade|subscription|tier|not included/i),
    ).toBeNull();
  });

  it('"Save offline" writes to storage unconditionally', async () => {
    const { getByLabelText, queryByText } = render(<ReaderRoute />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByLabelText('Save offline'));

    await waitFor(() => expect(mockSaveForOffline).toHaveBeenCalled());
    expect(
      queryByText(/plan|premium|upgrade|subscription|tier|not included/i),
    ).toBeNull();
  });

  it('still removes an already-saved document', async () => {
    mockIsOffline.mockReturnValue(true);

    const { getByLabelText } = render(<ReaderRoute />, {
      wrapper: createWrapper(),
    });

    fireEvent.press(getByLabelText('Saved offline'));

    await waitFor(() => expect(mockRemoveOffline).toHaveBeenCalledWith('doc-1'));
    expect(mockSaveForOffline).not.toHaveBeenCalled();
  });
});

// -- Per-section audio ------------------------------------------------------

describe('ReaderRoute — per-section audio', () => {
  const READY_RENDITION = {
    status: 'ready' as const,
    audioUrl: 'https://s3.example.com/a.mp3?sig=abc',
    marksUrl: null,
    readalongUrl: null,
    durationMs: 90_000,
    language: 'en',
    voiceId: 'Ruth',
  };

  function sectionsFor(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `s-${i + 1}`,
      legalDocumentId: 'doc-1',
      parentSectionId: null,
      sectionType: 'article',
      sectionLabel: `Article ${i + 1}`,
      ordering: i + 1,
      plainText: `Body of article ${i + 1}.`,
      htmlText: null,
      pageStart: null,
      pageEnd: null,
      tokenCount: null,
      createdAt: '2024-01-15T00:00:00Z',
    }));
  }

  /** Distinct content ids the audio hook was asked to fetch (enabled only). */
  function requestedIds(): string[] {
    return [
      ...new Set(
        mockUseAudioRendition.mock.calls
          .map(([opts]) => opts as { contentId: string; enabled: boolean })
          .filter((opts) => opts.enabled)
          .map((opts) => opts.contentId),
      ),
    ];
  }

  function renderCodal(sectionCount = 3) {
    mockUseDocument.mockReturnValue({
      data: baseDoc({ documentType: 'codal', title: 'Civil Code' }),
      isLoading: false,
      error: null,
    });
    mockUseDocumentSections.mockReturnValue({
      data: sectionsFor(sectionCount),
      isLoading: false,
    });
    return render(<ReaderRoute />, { wrapper: createWrapper() });
  }

  it('offers a Listen button per section on a codal', () => {
    const { getByTestId } = renderCodal();

    expect(getByTestId('section-listen-s-1')).toBeTruthy();
    expect(getByTestId('section-listen-s-2')).toBeTruthy();
    expect(getByTestId('section-listen-s-3')).toBeTruthy();
  });

  it('offers no section audio on a decision, which is narrated whole', () => {
    mockUseDocument.mockReturnValue({
      data: baseDoc({ documentType: 'case_decision' }),
      isLoading: false,
      error: null,
    });
    mockUseDocumentSections.mockReturnValue({
      data: sectionsFor(3),
      isLoading: false,
    });

    const { queryByTestId } = render(<ReaderRoute />, { wrapper: createWrapper() });

    expect(queryByTestId('section-listen-s-1')).toBeNull();
    expect(queryByTestId('section-audio-bar')).toBeNull();
  });

  it('offers no section audio for a codal-class type outside the narrated set', () => {
    // `statute` is in the reader's CODAL_DOCUMENT_TYPES (digest-UI gate) but
    // NOT in SECTION_NARRATED_DOCUMENT_TYPES. Conflating the two sets would
    // offer Listen on sections that have no rendition.
    mockUseDocument.mockReturnValue({
      data: baseDoc({ documentType: 'statute' }),
      isLoading: false,
      error: null,
    });
    mockUseDocumentSections.mockReturnValue({
      data: sectionsFor(2),
      isLoading: false,
    });

    const { queryByTestId } = render(<ReaderRoute />, { wrapper: createWrapper() });

    expect(queryByTestId('section-listen-s-1')).toBeNull();
    expect(queryByTestId('section-audio-bar')).toBeNull();
  });

  it('requests NO audio on render, and exactly one section after a press', () => {
    const { getByTestId } = renderCodal();

    // The first not-ready GET enqueues paid TTS synthesis. Rendering a
    // document must never do that — only an explicit tap may.
    expect(mockUseAudioRendition).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('section-listen-s-2'));

    expect(requestedIds()).toEqual(['s-2']);
  });

  it('mounts exactly one player for a many-section document', async () => {
    // The Civil Code has 2,533 sections; one bar each is a memory problem even
    // if none of them fetched.
    mockUseAudioRendition.mockReturnValue({
      data: READY_RENDITION,
      isLoading: false,
      isError: false,
      error: null,
      isTakingTooLong: false,
      refetch: jest.fn(),
    });
    const { getByTestId, getAllByTestId } = renderCodal(40);

    fireEvent.press(getByTestId('section-listen-s-7'));

    await waitFor(() => expect(getAllByTestId('audio-player')).toHaveLength(1));
    expect(requestedIds()).toEqual(['s-7']);
  });

  it('switches the single player to another section without stacking players', async () => {
    mockUseAudioRendition.mockReturnValue({
      data: READY_RENDITION,
      isLoading: false,
      isError: false,
      error: null,
      isTakingTooLong: false,
      refetch: jest.fn(),
    });
    const { getByTestId, getAllByTestId } = renderCodal(5);

    fireEvent.press(getByTestId('section-listen-s-1'));
    await waitFor(() => expect(getAllByTestId('audio-player')).toHaveLength(1));

    fireEvent.press(getByTestId('section-listen-s-4'));

    await waitFor(() => expect(requestedIds()).toEqual(['s-1', 's-4']));
    expect(getAllByTestId('audio-player')).toHaveLength(1);
  });

  it('starts at the first section from "Play whole document"', () => {
    const { getByTestId } = renderCodal();

    fireEvent.press(getByTestId('play-whole-document'));

    expect(requestedIds()).toEqual(['s-1']);
    // Chaining is on, so the reader is offered a way back out of it.
    expect(getByTestId('section-audio-stop-chain')).toBeTruthy();
  });
});
