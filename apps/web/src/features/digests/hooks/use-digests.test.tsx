import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the api client
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import {
  useDigests,
  useDigestSubjects,
  useInfiniteDigests,
  useDigest,
  useGenerateDigest,
  useSearchDigests,
} from './use-digests';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

// ─── useDigests ──────────────────────────────────────────────────────

describe('useDigests', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('fetches digests with default params', async () => {
    const mockResponse = {
      success: true,
      data: [{ id: 'dig-1', title: 'Test Digest' }],
      meta: { hasNext: false, cursor: null },
    };
    mockGet.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useDigests(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith('/digests', {
      params: { limit: '20' },
    });
    expect(result.current.data).toEqual(mockResponse);
  });

  it('passes digestType filter', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { hasNext: false, cursor: null },
    });

    const { result } = renderHook(
      () => useDigests({ digestType: 'case_digest' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith('/digests', {
      params: { limit: '20', digestType: 'case_digest' },
    });
  });

  it('passes reviewStatus filter', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { hasNext: false, cursor: null },
    });

    const { result } = renderHook(
      () => useDigests({ reviewStatus: 'approved' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith('/digests', {
      params: { limit: '20', reviewStatus: 'approved' },
    });
  });

  it('passes legalDocumentId filter', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { hasNext: false, cursor: null },
    });

    const { result } = renderHook(
      () => useDigests({ legalDocumentId: 'doc-1' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith('/digests', {
      params: { limit: '20', legalDocumentId: 'doc-1' },
    });
  });

  it('passes cursor for pagination', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { hasNext: false, cursor: null },
    });

    const { result } = renderHook(
      () => useDigests({ cursor: 'cursor-abc' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith('/digests', {
      params: { limit: '20', cursor: 'cursor-abc' },
    });
  });

  it('combines multiple filters', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { hasNext: false, cursor: null },
    });

    const { result } = renderHook(
      () =>
        useDigests({
          digestType: 'case_digest',
          reviewStatus: 'needs_human_review',
          legalDocumentId: 'doc-2',
          cursor: 'cur-1',
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith('/digests', {
      params: {
        limit: '20',
        digestType: 'case_digest',
        reviewStatus: 'needs_human_review',
        legalDocumentId: 'doc-2',
        cursor: 'cur-1',
      },
    });
  });
});

// ─── useInfiniteDigests ──────────────────────────────────────────────

describe('useInfiniteDigests', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('fetches the first page with default params', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [{ id: 'dig-1', title: 'Page 1' }],
      meta: { hasNext: false, nextCursor: null },
    });

    const { result } = renderHook(() => useInfiniteDigests(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith('/digests', {
      params: { limit: '20' },
    });
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.data?.pages[0]?.data).toEqual([
      { id: 'dig-1', title: 'Page 1' },
    ]);
  });

  it('exposes hasNextPage and loads page 2, flattening both pages', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [{ id: 'dig-1', title: 'Page 1' }],
      meta: { hasNext: true, nextCursor: 'cursor-page-2' },
    });

    const { result } = renderHook(
      () => useInfiniteDigests({ reviewStatus: 'approved' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.hasNextPage).toBe(true);
    expect(mockGet).toHaveBeenCalledWith('/digests', {
      params: { limit: '20', reviewStatus: 'approved' },
    });

    mockGet.mockResolvedValueOnce({
      success: true,
      data: [{ id: 'dig-2', title: 'Page 2' }],
      meta: { hasNext: false, nextCursor: null },
    });

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(false);
    });

    // Page 2 request carries the cursor from page 1's meta.
    expect(mockGet).toHaveBeenLastCalledWith('/digests', {
      params: { limit: '20', reviewStatus: 'approved', cursor: 'cursor-page-2' },
    });

    const allDigests = result.current.data?.pages.flatMap((p) => p.data) ?? [];
    expect(allDigests).toEqual([
      { id: 'dig-1', title: 'Page 1' },
      { id: 'dig-2', title: 'Page 2' },
    ]);
  });
});

// ─── useDigest ───────────────────────────────────────────────────────

describe('useInfiniteDigests — subject filter', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('passes subjectCode through to the API', async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: [],
      meta: { hasNext: false },
    });

    const { result } = renderHook(
      () => useInfiniteDigests({ subjectCode: 'political_law' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/digests', {
      params: { limit: '20', subjectCode: 'political_law' },
    });
  });
});

// ─── useSearchDigests ────────────────────────────────────────────────

describe('useSearchDigests', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('pages on the search envelope\'s own hasMore/cursor fields', async () => {
    // The search envelope is NOT the list envelope: it carries hasMore /
    // cursor at the top level, not meta.hasNext / meta.nextCursor. Paging
    // off the wrong pair silently stops after one page.
    mockGet
      .mockResolvedValueOnce({
        success: true,
        data: {
          results: [{ id: 's1' }],
          hasMore: true,
          cursor: 'cursor-1',
          matchedDocuments: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          results: [{ id: 's2' }],
          hasMore: false,
          cursor: null,
          matchedDocuments: [],
        },
      });

    const { result } = renderHook(() => useSearchDigests('estafa'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() =>
      expect(
        result.current.data?.pages.flatMap((p) => p.results).map((r) => r.id),
      ).toEqual(['s1', 's2']),
    );
    expect(mockGet).toHaveBeenLastCalledWith('/digests/search', {
      params: { limit: '20', q: 'estafa', cursor: 'cursor-1' },
    });
    expect(result.current.hasNextPage).toBe(false);
  });

  it('does not page when hasMore is false even if a cursor is present', async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: {
        results: [{ id: 's1' }],
        hasMore: false,
        cursor: 'stale-cursor',
        matchedDocuments: [],
      },
    });

    const { result } = renderHook(() => useSearchDigests('estafa'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });

  it('passes subjectCode through', async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: { results: [], hasMore: false, cursor: null, matchedDocuments: [] },
    });

    const { result } = renderHook(
      () => useSearchDigests('estafa', true, { subjectCode: 'civil_law' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/digests/search', {
      params: { limit: '20', q: 'estafa', subjectCode: 'civil_law' },
    });
  });

  it('stays idle for an empty query', () => {
    const { result } = renderHook(() => useSearchDigests('   '), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('useDigestSubjects', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('reads the summary endpoint and unwraps the envelope', async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: [
        {
          code: 'political_law',
          name: 'Political Law',
          taxonomyVersion: 'study_8',
          count: 42,
        },
      ],
    });

    const { result } = renderHook(() => useDigestSubjects(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/digests/subjects/summary', {
      params: { taxonomyVersion: 'study_8' },
    });
    expect(result.current.data?.[0]?.count).toBe(42);
  });
});

describe('useDigest', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('fetches a single digest by ID', async () => {
    const mockDigest = { id: 'dig-1', title: 'Civil Case Digest' };
    mockGet.mockResolvedValueOnce({
      success: true,
      data: mockDigest,
    });

    const { result } = renderHook(() => useDigest('dig-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith('/digests/dig-1');
    expect(result.current.data).toEqual(mockDigest);
  });

  it('does not fetch when ID is empty', () => {
    const { result } = renderHook(() => useDigest(''), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });
});

// ─── useGenerateDigest ───────────────────────────────────────────────

describe('useGenerateDigest', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it('calls POST /digests/generate with legalDocumentId', async () => {
    const mockResponse = {
      success: true,
      data: { id: 'dig-new', title: 'Generated Digest' },
    };
    mockPost.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useGenerateDigest(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ legalDocumentId: 'doc-1' });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockPost).toHaveBeenCalledWith('/digests/generate', {
      legalDocumentId: 'doc-1',
    });
  });

  it('passes optional digestType', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: { id: 'dig-new' },
    });

    const { result } = renderHook(() => useGenerateDigest(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        legalDocumentId: 'doc-1',
        digestType: 'case_digest',
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockPost).toHaveBeenCalledWith('/digests/generate', {
      legalDocumentId: 'doc-1',
      digestType: 'case_digest',
    });
  });

  it('reports error on mutation failure', async () => {
    mockPost.mockRejectedValueOnce(new Error('Server error'));

    const { result } = renderHook(() => useGenerateDigest(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ legalDocumentId: 'doc-1' });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeInstanceOf(Error);
  });
});
