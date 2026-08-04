import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../lib/api-client', () => ({
  apiClient: {
    post: jest.fn(),
  },
}));

import { apiClient } from '../../../lib/api-client';
import { useSearchDigests, useDigestCount } from './use-search-digests';

const mockedPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

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
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

describe('useSearchDigests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not fetch for an empty query', () => {
    const { result } = renderHook(() => useSearchDigests('', false), {
      wrapper: createWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('does not fetch for a whitespace-only query', () => {
    renderHook(() => useSearchDigests('   ', true), { wrapper: createWrapper() });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  // The whole point of the change: the tab searches the digest corpus by TEXT
  // rather than looking up digests attached to whatever documents the full-text
  // tab happened to return.
  it('POSTs /search with scope=digests, not /digests/by-documents', async () => {
    mockedPost.mockResolvedValue(searchResponse());

    const { result } = renderHook(() => useSearchDigests('estafa', true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(mockedPost).toHaveBeenCalledWith('/search', {
      query: 'estafa',
      scope: 'digests',
      limit: 20,
    });
  });

  it('maps index hits onto the card shape', async () => {
    mockedPost.mockResolvedValue(searchResponse());

    const { result } = renderHook(() => useSearchDigests('estafa', true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

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

  it('trims the query before sending it', async () => {
    mockedPost.mockResolvedValue(searchResponse());

    renderHook(() => useSearchDigests('  estafa  ', true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalled();
    });
    expect(mockedPost).toHaveBeenCalledWith(
      '/search',
      expect.objectContaining({ query: 'estafa' }),
    );
  });
});

describe('useDigestCount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not fetch for an empty query', () => {
    const { result } = renderHook(() => useDigestCount('', false), {
      wrapper: createWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('reads the count off meta.counts.digests', async () => {
    mockedPost.mockResolvedValue(searchResponse(3_359));

    const { result } = renderHook(() => useDigestCount('estafa', true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe(3_359);
    });
  });

  // One request, not two: the count shares the list's query key, so the badge
  // can never disagree with the list it labels.
  it('shares the list request rather than issuing a second round-trip', async () => {
    mockedPost.mockResolvedValue(searchResponse(7));
    const wrapper = createWrapper();

    const { result } = renderHook(
      () => ({
        list: useSearchDigests('estafa', true),
        count: useDigestCount('estafa', true),
      }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.count.data).toBe(7);
    });

    expect(result.current.list.data?.data).toHaveLength(1);
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it('falls back to meta.total when counts is absent', async () => {
    mockedPost.mockResolvedValue({
      success: true,
      data: [],
      meta: { total: 4 },
    });

    const { result } = renderHook(() => useDigestCount('estafa', true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe(4);
    });
  });
});
