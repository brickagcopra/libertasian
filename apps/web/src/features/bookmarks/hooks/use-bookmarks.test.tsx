import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the api client
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import { useBookmarks, useCreateBookmark, useDeleteBookmark } from './use-bookmarks';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockDelete = vi.mocked(apiClient.delete);

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

// ─── useBookmarks ────────────────────────────────────────────────────

describe('useBookmarks', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('fetches bookmarks with default params', async () => {
    const mockResponse = {
      success: true,
      data: [
        {
          id: 'bm-1',
          userId: 'user-1',
          legalDocumentId: 'doc-1',
          note: null,
          createdAt: '2026-01-01',
        },
      ],
      meta: { hasNext: false, cursor: null },
    };
    mockGet.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useBookmarks(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith('/bookmarks', {
      params: { limit: '20' },
    });
    expect(result.current.data).toEqual(mockResponse);
  });

  it('passes cursor for pagination', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { hasNext: false, cursor: null },
    });

    const { result } = renderHook(() => useBookmarks('cursor-abc'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith('/bookmarks', {
      params: { limit: '20', cursor: 'cursor-abc' },
    });
  });

  it('does not include cursor when undefined', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { hasNext: false, cursor: null },
    });

    const { result } = renderHook(() => useBookmarks(undefined), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith('/bookmarks', {
      params: { limit: '20' },
    });
  });
});

// ─── useCreateBookmark ───────────────────────────────────────────────

describe('useCreateBookmark', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it('calls POST /bookmarks with legalDocumentId', async () => {
    const mockResponse = {
      success: true,
      data: {
        id: 'bm-new',
        userId: 'user-1',
        legalDocumentId: 'doc-1',
        note: null,
        createdAt: '2026-01-15',
      },
    };
    mockPost.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useCreateBookmark(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ legalDocumentId: 'doc-1' });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockPost).toHaveBeenCalledWith('/bookmarks', {
      legalDocumentId: 'doc-1',
    });
  });

  it('includes optional note', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: { id: 'bm-new' },
    });

    const { result } = renderHook(() => useCreateBookmark(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        legalDocumentId: 'doc-1',
        note: 'Important precedent',
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockPost).toHaveBeenCalledWith('/bookmarks', {
      legalDocumentId: 'doc-1',
      note: 'Important precedent',
    });
  });

  it('reports error on mutation failure', async () => {
    mockPost.mockRejectedValueOnce(new Error('Conflict'));

    const { result } = renderHook(() => useCreateBookmark(), {
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

// ─── useDeleteBookmark ───────────────────────────────────────────────

describe('useDeleteBookmark', () => {
  beforeEach(() => {
    mockDelete.mockReset();
  });

  it('calls DELETE /bookmarks/:id', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useDeleteBookmark(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('bm-1');
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockDelete).toHaveBeenCalledWith('/bookmarks/bm-1');
  });

  it('reports error on deletion failure', async () => {
    mockDelete.mockRejectedValueOnce(new Error('Not Found'));

    const { result } = renderHook(() => useDeleteBookmark(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('bm-nonexistent');
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeInstanceOf(Error);
  });
});
