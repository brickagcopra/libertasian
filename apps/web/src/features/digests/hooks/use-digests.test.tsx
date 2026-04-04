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
import { useDigests, useDigest, useGenerateDigest } from './use-digests';

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

// ─── useDigest ───────────────────────────────────────────────────────

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
