import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Reader pinpoint: `?section=<id>&highlight=<quote>` (Deep Research's
 * "Open in reader") marks the first normalised match in that section and
 * scrolls to it.
 */

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => nav.params,
  usePathname: () => '/reader/doc-1',
  useParams: () => ({ id: 'doc-1' }),
}));
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiClientError: class ApiClientError extends Error {},
}));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({ user: { id: 'u' }, accessToken: 't', isAuthenticated: true }),
}));
const docMocks = vi.hoisted(() => ({ useDocument: vi.fn(), useDocumentSections: vi.fn() }));
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

import ReaderPage from './page';

const scrollIntoView = vi.fn();
beforeAll(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});

function section(id: string, plainText: string) {
  return { id, sectionType: 'ruling', sectionLabel: id, plainText, pageStart: null, pageEnd: null, ordering: 1 };
}

beforeEach(() => {
  scrollIntoView.mockClear();
  docMocks.useDocument.mockReturnValue({
    data: { id: 'doc-1', title: 'People v. Cruz', documentType: 'decision', court: 'supreme_court', isOfficial: true },
    isLoading: false,
    error: null,
  });
  docMocks.useDocumentSections.mockReturnValue({
    data: [
      section('sec-a', 'The facts are simple. The arrest was unlawful.'),
      section('sec-b', 'We rule that the arrest was  unlawful and\nthe evidence is inadmissible.'),
    ],
    isLoading: false,
  });
});

function renderReader() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReaderPage />
    </QueryClientProvider>,
  );
}

describe('reader ?highlight=', () => {
  it('marks the normalised match inside the named section and scrolls to it', () => {
    nav.params = new URLSearchParams({ section: 'sec-b', highlight: 'The arrest was unlawful and the evidence' });
    renderReader();
    const mark = screen.getByTestId('reader-pinpoint');
    expect(mark.tagName).toBe('MARK');
    expect(mark.textContent).toBe('the arrest was unlawful and the evidence');
    expect(mark.closest('#section-sec-b')).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('without a section, uses the first section containing the quote', () => {
    nav.params = new URLSearchParams({ highlight: 'arrest was unlawful' });
    renderReader();
    expect(screen.getByTestId('reader-pinpoint').closest('#section-sec-a')).not.toBeNull();
  });

  it('renders no mark when there is nothing to highlight', () => {
    nav.params = new URLSearchParams();
    renderReader();
    expect(screen.queryByTestId('reader-pinpoint')).not.toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
