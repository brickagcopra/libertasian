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

  it('does not fetch when documentIds is null', () => {
    const { result } = renderHook(() => useSearchDigests(null, true), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('does not fetch when documentIds is empty', () => {
    const { result } = renderHook(() => useSearchDigests([], true), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('does not fetch when enabled is false', () => {
    const { result } = renderHook(
      () => useSearchDigests(['doc-1', 'doc-2'], false),
      { wrapper: createWrapper() },
    );

    expect(result.current.isFetching).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('fetches digests for provided document IDs', async () => {
    const mockResponse = {
      success: true,
      data: [
        {
          id: 'digest-1',
          title: 'Test Digest',
          digestType: 'case_digest',
          reviewStatus: 'approved',
          visibility: 'public_editorial',
          createdAt: '2026-01-01T00:00:00Z',
          legalDocument: {
            id: 'doc-1',
            title: 'People v. Santos',
            court: 'Supreme Court',
          },
        },
      ],
    };
    mockPost.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(
      () => useSearchDigests(['doc-1', 'doc-2'], true),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockPost).toHaveBeenCalledWith('/digests/by-documents', {
      legalDocumentIds: ['doc-1', 'doc-2'],
    });
    expect(result.current.data).toEqual(mockResponse);
  });

  it('handles API error', async () => {
    mockPost.mockRejectedValueOnce(new Error('Server error'));

    const { result } = renderHook(
      () => useSearchDigests(['doc-1'], true),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });

  it('uses documentIds in queryKey for cache isolation', async () => {
    mockPost.mockResolvedValue({ success: true, data: [] });

    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useSearchDigests(ids, true),
      {
        wrapper: createWrapper(),
        initialProps: { ids: ['doc-1'] },
      },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ ids: ['doc-2', 'doc-3'] });

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));

    expect(mockPost).toHaveBeenCalledWith('/digests/by-documents', {
      legalDocumentIds: ['doc-1'],
    });
    expect(mockPost).toHaveBeenCalledWith('/digests/by-documents', {
      legalDocumentIds: ['doc-2', 'doc-3'],
    });
  });
});
