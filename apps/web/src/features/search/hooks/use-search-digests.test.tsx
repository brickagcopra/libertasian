import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import { useSearchDigests } from './use-search-digests';

const mockPost = vi.mocked(apiClient.post);

/** A `/search` response with `scope: 'digests'`, as the API returns it. */
const searchResponse = (total = 2) => ({
  success: true,
  data: [
    {
      id: 'dig-1',
      score: 4.1,
      kind: 'digest',
      source: {
        digest_id: 'dig-1',
        title: 'Digest: PEOPLE v. SANTOS',
        legal_document_id: 'doc-1',
        digest_type: 'case_digest',
        summary: 'Accused was convicted of estafa.',
        visibility: 'public_editorial',
        review_status: 'needs_human_review',
        confidence_score: 0.83,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    },
  ],
  meta: { total, counts: { documents: 0, derivatives: 0, digests: total } },
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('useSearchDigests', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it('does not fetch for an empty query', () => {
    const { result } = renderHook(() => useSearchDigests('', true), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('does not fetch for a whitespace-only query', () => {
    renderHook(() => useSearchDigests('   ', true), { wrapper: createWrapper() });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('does not fetch when enabled is false', () => {
    renderHook(() => useSearchDigests('estafa', false), {
      wrapper: createWrapper(),
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  // The whole point of the change: the tab searches the digest corpus by TEXT
  // rather than looking up digests attached to whatever documents the full-text
  // tab happened to return.
  it('POSTs /search with scope=digests, not /digests/by-documents', async () => {
    mockPost.mockResolvedValue(searchResponse());

    const { result } = renderHook(() => useSearchDigests('estafa', true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(mockPost).toHaveBeenCalledWith('/search', {
      query: 'estafa',
      scope: 'digests',
      limit: 20,
    });
  });

  it('maps index hits onto the card shape', async () => {
    mockPost.mockResolvedValue(searchResponse());

    const { result } = renderHook(() => useSearchDigests('estafa', true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data?.data[0]).toEqual({
      id: 'dig-1',
      title: 'Digest: PEOPLE v. SANTOS',
      summary: 'Accused was convicted of estafa.',
      digestType: 'case_digest',
      confidenceScore: 0.83,
      reviewStatus: 'needs_human_review',
      visibility: 'public_editorial',
      createdAt: '2026-01-01T00:00:00.000Z',
      // The index carries legal_document_id but no denormalised case caption,
      // so the source line is simply not rendered.
      legalDocument: null,
    });
  });

  it('exposes the corpus count alongside the items', async () => {
    mockPost.mockResolvedValue(searchResponse(3_359));

    const { result } = renderHook(() => useSearchDigests('estafa', true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.count).toBe(3_359);
  });

  it('uses the trimmed query in the queryKey for cache isolation', async () => {
    mockPost.mockResolvedValue(searchResponse());
    const wrapper = createWrapper();

    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useSearchDigests(q, true),
      { wrapper, initialProps: { q: 'estafa' } },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());

    rerender({ q: 'negligence' });
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));

    expect(mockPost).toHaveBeenLastCalledWith(
      '/search',
      expect.objectContaining({ query: 'negligence' }),
    );
  });

  it('handles API error', async () => {
    mockPost.mockRejectedValue(new Error('search failed'));

    const { result } = renderHook(() => useSearchDigests('estafa', true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});
