import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * Per-section audio in the document reader.
 *
 * The load-time behaviour is the point of most of these: the Civil Code has
 * 2,533 sections, so the page must issue ZERO audio requests on render and
 * mount exactly ONE player no matter how long the document is.
 */

const apiMocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: apiMocks.get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiClientError: class ApiClientError extends Error {
    constructor(
      message: string,
      public statusCode: number,
      public body?: unknown,
    ) {
      super(message);
      this.name = 'ApiClientError';
    }
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/reader/doc-1',
  useParams: () => ({ id: 'doc-1' }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({
    user: { id: 'user-1', email: 't@t.com', fullName: 'T' },
    accessToken: 'token',
    isAuthenticated: true,
  }),
}));

const docMocks = vi.hoisted(() => ({
  useDocument: vi.fn(),
  useDocumentSections: vi.fn(),
}));
vi.mock('@/features/documents/hooks/use-document', () => docMocks);

vi.mock('@/features/bookmarks/hooks/use-bookmarks', () => ({
  useBookmarks: () => ({ data: { data: [] } }),
  useCreateBookmark: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/workspace/hooks/use-annotations', () => ({
  useAnnotations: () => ({ data: { data: [] } }),
  useCreateAnnotation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAnnotation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/digests/hooks/use-digests', () => ({
  useDigests: () => ({ data: { data: [] } }),
  useGenerateDigest: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useCanUseBookmarksAnnotations', () => ({
  useCanUseBookmarksAnnotations: () => ({ locked: false }),
}));

// The ONE hook that talks to the audio endpoint. Mocked so 202/ready/402 are
// deterministic — and so "was it called at all" answers "did a player mount
// and fetch".
const audioMocks = vi.hoisted(() => ({
  useAudioRendition: vi.fn(),
  useReadAlongSegments: vi.fn(() => null),
}));
vi.mock('@/features/audio/hooks/use-audio-rendition', () => ({
  useAudioRendition: audioMocks.useAudioRendition,
}));
vi.mock('@/features/audio/hooks/use-readalong-segments', () => ({
  useReadAlongSegments: audioMocks.useReadAlongSegments,
}));

import ReaderPage from './page';
import { ApiClientError } from '@/lib/api-client';

const READY = {
  status: 'ready' as const,
  audioUrl: 'https://signed/a.mp3',
  marksUrl: null,
  readalongUrl: 'https://signed/a.readalong.json',
  durationMs: 65_000,
  language: 'en',
  voiceId: 'af_heart',
};

function setAudio(value: Record<string, unknown>) {
  audioMocks.useAudioRendition.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isTakingTooLong: false,
    refetch: vi.fn(),
    ...value,
  });
}

function section(n: number) {
  return {
    id: `sec-${n}`,
    sectionType: 'article',
    sectionLabel: `Article ${n}`,
    plainText: `Body of article ${n}.`,
    pageStart: null,
    pageEnd: null,
    ordering: n,
  };
}

function setDocumentSections(
  documentType: string,
  sections: ReturnType<typeof section>[],
) {
  docMocks.useDocument.mockReturnValue({
    data: {
      id: 'doc-1',
      title: 'Civil Code of the Philippines',
      documentType,
      court: null,
      grNo: null,
      ponente: null,
      decisionDate: null,
      isOfficial: true,
      citationText: null,
    },
    isLoading: false,
    error: null,
  });
  docMocks.useDocumentSections.mockReturnValue({ data: sections, isLoading: false });
}

function setDocument(documentType: string, sectionCount: number) {
  setDocumentSections(
    documentType,
    Array.from({ length: sectionCount }, (_, i) => section(i + 1)),
  );
}

function renderReader() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const view = (children: ReactNode) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(view(<ReaderPage />));
}

/** Audio endpoint calls made through apiClient (the chain's warm-up). */
const audioRequests = () =>
  apiMocks.get.mock.calls.filter((call) =>
    String(call[0]).startsWith('/audio/'),
  );

/**
 * Distinct contentIds the rendition hook was called with. React re-renders the
 * player on every state change, so raw CALL COUNT says nothing about how many
 * players exist — the number of distinct ids does.
 */
const renditionTargets = (): string[] => [
  ...new Set(
    audioMocks.useAudioRendition.mock.calls.map(
      (call) => (call[0] as { contentId: string }).contentId,
    ),
  ),
];

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: vi.fn(),
  });
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.get.mockResolvedValue({ success: true, data: READY });
  audioMocks.useReadAlongSegments.mockReturnValue(null);
  setAudio({ data: READY });
});

describe('reader — no fan-out on load', () => {
  it('issues no audio request when the page renders', () => {
    setDocument('codal', 3);

    renderReader();

    // Rendered by both the TOC and the body — hence getAllByText.
    expect(screen.getAllByText('Article 1').length).toBeGreaterThan(0);
    // Nothing fetched, and no player mounted to fetch with.
    expect(audioRequests()).toHaveLength(0);
    expect(audioMocks.useAudioRendition).not.toHaveBeenCalled();
    expect(screen.queryByTestId('audio-player')).not.toBeInTheDocument();
  });

  it('mounts exactly ONE player for a 2,533-section document', () => {
    // The real Civil Code section count. 2,533 mounted players is a DOM and
    // memory problem even if none of them fetch.
    setDocument('codal', 2533);

    renderReader();
    expect(audioMocks.useAudioRendition).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('section-listen-sec-1200'));

    expect(screen.getAllByTestId('audio-player')).toHaveLength(1);
    // One player, therefore one target — however many times React re-rendered.
    expect(renditionTargets()).toEqual(['sec-1200']);
    expect(audioMocks.useAudioRendition).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'legal_document_section',
        contentId: 'sec-1200',
        enabled: true,
      }),
    );
  });

  it('fires one fetch per explicit play click, for the clicked section', () => {
    setDocument('codal', 5);
    renderReader();

    fireEvent.click(screen.getByTestId('section-listen-sec-2'));
    expect(audioMocks.useAudioRendition).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: 'sec-2' }),
    );

    audioMocks.useAudioRendition.mockClear();
    fireEvent.click(screen.getByTestId('section-listen-sec-4'));
    expect(audioMocks.useAudioRendition).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: 'sec-4' }),
    );
    expect(screen.getAllByTestId('audio-player')).toHaveLength(1);
  });
});

describe('reader — pending and paywall states', () => {
  it('shows the preparing state on a 202 and a player once ready', async () => {
    setDocument('codal', 2);
    // The backfill is still running: a section with no rendition yet 202s.
    setAudio({ data: { ...READY, status: 'pending', audioUrl: null } });
    const { rerender } = renderReader();

    fireEvent.click(screen.getByTestId('section-listen-sec-1'));
    expect(screen.getByTestId('audio-pending')).toBeInTheDocument();
    expect(screen.queryByTestId('audio-player')).not.toBeInTheDocument();

    setAudio({ data: READY });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    rerender(
      <QueryClientProvider client={qc}>
        <ReaderPage />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('audio-player')).toBeInTheDocument(),
    );
  });

  it('shows a terminal notice for an unavailable section, never "preparing"', () => {
    setDocument('codal', 2);
    // PR #341: content that can never be narrated answers 200 `unavailable`
    // with no enqueue. `useAudioRendition` only polls while `pending`, so
    // falling through to the preparing state would spin forever.
    setAudio({
      data: {
        ...READY,
        status: 'unavailable',
        audioUrl: null,
        readalongUrl: null,
        durationMs: null,
        failureReason: 'output_too_large',
      },
    });
    renderReader();

    fireEvent.click(screen.getByTestId('section-listen-sec-1'));

    const notice = screen.getByTestId('audio-unavailable');
    expect(notice).toHaveTextContent(/Narration isn.t available for this section/);
    expect(notice).toHaveAttribute('data-failure-reason', 'output_too_large');

    expect(screen.queryByTestId('audio-pending')).not.toBeInTheDocument();
    expect(screen.queryByTestId('audio-player')).not.toBeInTheDocument();
    // Re-requesting cannot change the outcome — no retry affordance at all.
    expect(
      screen.queryByRole('button', { name: /retry/i }),
    ).not.toBeInTheDocument();
  });

  it('renders the paywall affordance on a 402 instead of crashing', () => {
    setDocument('codal', 2);
    setAudio({
      isError: true,
      error: new ApiClientError('Payment required', 402),
    });
    renderReader();

    fireEvent.click(screen.getByTestId('section-listen-sec-1'));

    // Same affordance the Pro-gated bar answers already use.
    expect(screen.getByTestId('audio-paywall')).toBeInTheDocument();
    expect(screen.getByText('See plans')).toBeInTheDocument();
    expect(screen.queryByTestId('audio-player')).not.toBeInTheDocument();
  });
});

describe('reader — read-along in place', () => {
  const SEGMENTS = [
    {
      id: 'seg-1',
      kind: 'sentence' as const,
      sectionKey: 'sec-1',
      text: 'Body of article 1.',
      timeMs: 0,
      paragraphIndex: 0,
    },
    {
      id: 'seg-2',
      kind: 'sentence' as const,
      sectionKey: 'sec-1',
      text: 'Second sentence.',
      timeMs: 900,
      paragraphIndex: 0,
    },
  ];

  it('highlights inside the existing section body, with no transcript panel', () => {
    setDocument('codal', 2);
    audioMocks.useReadAlongSegments.mockReturnValue(SEGMENTS);
    renderReader();

    fireEvent.click(screen.getByTestId('section-listen-sec-1'));

    // The spans live INSIDE the section block already on the page.
    const body = screen.getByTestId('section-read-along-sec-1');
    expect(body).toBeInTheDocument();
    expect(
      screen.getByText('Second sentence.').closest('#section-sec-1'),
    ).not.toBeNull();

    // PR #243 removed the transcript panel deliberately; it must not come back.
    expect(screen.queryByTestId('read-along-body')).not.toBeInTheDocument();
  });

  it('leaves other sections as plain text', () => {
    setDocument('codal', 2);
    audioMocks.useReadAlongSegments.mockReturnValue(SEGMENTS);
    renderReader();

    fireEvent.click(screen.getByTestId('section-listen-sec-1'));

    // Only the narrating section is span-wrapped.
    expect(
      screen.queryByTestId('section-read-along-sec-2'),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Body of article 2\./)).toBeInTheDocument();
  });
});

describe('reader — which documents get the controls', () => {
  it('shows them for a statutory document', () => {
    setDocument('rules_of_court', 2);
    renderReader();

    expect(screen.getByTestId('section-audio-bar')).toBeInTheDocument();
    expect(screen.getByTestId('play-whole-document')).toBeInTheDocument();
    expect(screen.getByTestId('section-listen-sec-1')).toBeInTheDocument();
  });

  it('offers no Listen button for a section with empty text', () => {
    // Prod has 2 sections (of 4,857) with empty plain_text, correctly excluded
    // from the backfill. The button's click is what enqueues synthesis, so on
    // one of these it would queue a job with nothing to say.
    setDocumentSections('codal', [
      { ...section(1), plainText: '' },
      section(2),
    ]);
    renderReader();

    expect(screen.queryByTestId('section-listen-sec-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('section-listen-sec-2')).toBeInTheDocument();

    // Same guard on the other entry point: the chain skips it too, so
    // "play whole document" starts at the first section that has text.
    fireEvent.click(screen.getByTestId('play-whole-document'));
    expect(audioMocks.useAudioRendition).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: 'sec-2' }),
    );
  });

  it('hides them for a decision, which is narrated whole', () => {
    setDocument('decision', 2);
    renderReader();

    expect(screen.queryByTestId('section-audio-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('section-listen-sec-1')).not.toBeInTheDocument();
    expect(audioMocks.useAudioRendition).not.toHaveBeenCalled();
  });
});

describe('reader — play whole document', () => {
  it('starts at the first section in `ordering` order', () => {
    setDocument('codal', 3);
    renderReader();

    fireEvent.click(screen.getByTestId('play-whole-document'));

    expect(audioMocks.useAudioRendition).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: 'sec-1' }),
    );
    expect(screen.getAllByTestId('audio-player')).toHaveLength(1);
  });

  it('exposes the continue toggle, defaulted ON only by that button', () => {
    setDocument('codal', 3);
    renderReader();

    // A per-section play does NOT turn chaining on.
    fireEvent.click(screen.getByTestId('section-listen-sec-2'));
    expect(
      (screen.getByTestId('audio-continue-checkbox') as HTMLInputElement).checked,
    ).toBe(false);
  });
});
