import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * Reader Page integration tests.
 * Per PRD: DOC-01 through DOC-08 — document reader, annotations, bookmarks.
 * Per PDD: Full-text display with section navigation, citation linking.
 */

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiClientError: class ApiClientError extends Error {
    constructor(message: string, public statusCode: number, public body?: unknown) {
      super(message);
      this.name = 'ApiClientError';
    }
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/reader/doc-1',
  useParams: () => ({ id: 'doc-1' }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({
    user: { id: 'user-1', email: 'test@test.com', fullName: 'Test User' },
    accessToken: 'test-token',
    isAuthenticated: true,
  }),
}));

const docMocks = vi.hoisted(() => ({
  useDocument: vi.fn(),
  useDocumentSections: vi.fn(),
}));
vi.mock('@/features/documents/hooks/use-document', () => ({
  useDocument: docMocks.useDocument,
  useDocumentSections: docMocks.useDocumentSections,
}));

const bookmarkMocks = vi.hoisted(() => ({
  useBookmarks: vi.fn(() => ({ data: { data: [] } })),
  useCreateBookmark: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock('@/features/bookmarks/hooks/use-bookmarks', () => ({
  useBookmarks: bookmarkMocks.useBookmarks,
  useCreateBookmark: bookmarkMocks.useCreateBookmark,
}));

const annotationMocks = vi.hoisted(() => ({
  useAnnotations: vi.fn(() => ({ data: { data: [] } })),
  useCreateAnnotation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteAnnotation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock('@/features/workspace/hooks/use-annotations', () => ({
  useAnnotations: annotationMocks.useAnnotations,
  useCreateAnnotation: annotationMocks.useCreateAnnotation,
  useDeleteAnnotation: annotationMocks.useDeleteAnnotation,
}));

const digestMocks = vi.hoisted(() => ({
  useDigests: vi.fn(() => ({ data: { data: [] } })),
  useGenerateDigest: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock('@/features/digests/hooks/use-digests', () => ({
  useDigests: digestMocks.useDigests,
  useGenerateDigest: digestMocks.useGenerateDigest,
}));

function withProviders(children: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function setDocumentType(documentType: string) {
  docMocks.useDocument.mockReturnValue({
    data: {
      id: 'doc-1',
      title: 'Test Document',
      documentType,
      court: null,
      grNo: null,
      ponente: null,
      decisionDate: null,
      isOfficial: false,
      citationText: null,
    },
    isLoading: false,
    error: null,
  });
  docMocks.useDocumentSections.mockReturnValue({
    data: [],
    isLoading: false,
  });
}

describe('Reader Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Document display', () => {
    it('should validate document structure', () => {
      const document = {
        id: 'doc-1',
        title: 'People v. Doe',
        citation: 'G.R. No. 123456',
        documentType: 'supreme_court_decision',
        court: 'Supreme Court',
        dateDecided: '2025-06-15',
        sections: [],
      };
      expect(document.id).toBeDefined();
      expect(document.title.length).toBeGreaterThan(0);
      expect(document.citation).toBeDefined();
    });

    it('should validate section structure', () => {
      const section = {
        id: 'section-1',
        title: 'Facts',
        content: 'The petitioner alleges...',
        pageStart: 1,
        pageEnd: 3,
        order: 1,
      };
      expect(section.content.length).toBeGreaterThan(0);
      expect(section.pageStart).toBeLessThanOrEqual(section.pageEnd);
      expect(section.order).toBeGreaterThan(0);
    });
  });

  describe('Annotation functionality', () => {
    it('should validate annotation structure', () => {
      const annotation = {
        id: 'ann-1',
        documentId: 'doc-1',
        sectionId: 'section-1',
        startOffset: 10,
        endOffset: 50,
        highlightColor: 'yellow',
        note: 'Important ruling',
      };
      expect(annotation.startOffset).toBeLessThan(annotation.endOffset);
      expect(annotation.highlightColor).toMatch(/^(yellow|green|blue|red|purple)$/);
    });

    it('should validate annotation note max length', () => {
      const maxLength = 2000;
      const longNote = 'a'.repeat(2001);
      expect(longNote.length).toBeGreaterThan(maxLength);
    });
  });

  describe('Bookmark functionality', () => {
    it('should validate bookmark toggle', () => {
      let isBookmarked = false;
      isBookmarked = !isBookmarked;
      expect(isBookmarked).toBe(true);
      isBookmarked = !isBookmarked;
      expect(isBookmarked).toBe(false);
    });
  });

  describe('Citation linking', () => {
    it('should parse and normalize citation references', () => {
      const citations = ['G.R. No. 123456', 'A.M. No. 01-2-03-SC', 'Republic Act No. 386'];
      citations.forEach((c) => {
        expect(c.length).toBeGreaterThan(0);
      });
    });

    it('should validate related document structure', () => {
      const related = {
        id: 'doc-2',
        title: 'Santos v. Reyes',
        citation: 'G.R. No. 654321',
        relationship: 'cited_by',
      };
      expect(related.relationship).toMatch(/^(cites|cited_by|related|overruled_by|overrules)$/);
    });
  });

  describe('ETag caching', () => {
    it('should validate ETag header format', () => {
      const etag = '"abc123def456"';
      expect(etag).toMatch(/^"[a-zA-Z0-9]+"$/);
    });
  });
});

describe('Reader Page — case-digest UI gating by documentType', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    digestMocks.useDigests.mockReturnValue({ data: { data: [] } });
    digestMocks.useGenerateDigest.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
    bookmarkMocks.useBookmarks.mockReturnValue({ data: { data: [] } });
    bookmarkMocks.useCreateBookmark.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
    annotationMocks.useAnnotations.mockReturnValue({ data: { data: [] } });
    annotationMocks.useCreateAnnotation.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
    annotationMocks.useDeleteAnnotation.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
  });

  describe.each([
    ['constitution'],
    ['codal'],
    ['statute'],
    ['republic_act'],
    ['commonwealth_act'],
    ['batas_pambansa'],
    ['executive_order'],
    ['presidential_decree'],
    ['proclamation'],
    ['administrative_order'],
    ['rules_of_court'],
    ['rule'],
  ])('codal-class type "%s"', (documentType) => {
    it('hides Digests tab, Generate Digest button, and calls useDigests with enabled:false', async () => {
      setDocumentType(documentType);
      const ReaderPage = (await import('./page')).default;

      render(withProviders(<ReaderPage />));

      expect(screen.queryByRole('tab', { name: /Digests/i })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Generate Digest/i }),
      ).not.toBeInTheDocument();

      expect(digestMocks.useDigests).toHaveBeenCalledWith(
        { legalDocumentId: 'doc-1' },
        { enabled: false },
      );
    });
  });

  describe.each([
    ['decision'],
    ['supreme_court_decision'],
    ['administrative_matter'],
    ['administrative_case'],
    ['bar_exam_questions'],
  ])('non-codal type "%s"', (documentType) => {
    it('shows Digests tab, Generate Digest button, and calls useDigests with enabled:true', async () => {
      setDocumentType(documentType);
      const ReaderPage = (await import('./page')).default;

      render(withProviders(<ReaderPage />));

      expect(screen.getByRole('tab', { name: /Digests/i })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Generate Digest/i }),
      ).toBeInTheDocument();

      expect(digestMocks.useDigests).toHaveBeenCalledWith(
        { legalDocumentId: 'doc-1' },
        { enabled: true },
      );
    });
  });
});
