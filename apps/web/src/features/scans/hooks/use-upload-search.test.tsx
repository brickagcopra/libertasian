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
import { useUploadSearch } from './use-upload-search';

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

describe('useUploadSearch', () => {
  beforeEach(() => mockPost.mockReset());

  it('searches uploads via POST with query', async () => {
    const searchResult = {
      total: 2,
      page: 1,
      limit: 10,
      timedOut: false,
      items: [
        { id: 'i1', score: 0.95, source: { upload_id: 'u1', organization_id: 'o1', user_id: 'usr1', upload_type: 'scan', privacy_level: 'private', created_at: '2026-01-01' } },
      ],
    };
    mockPost.mockResolvedValueOnce({ success: true, data: searchResult });

    const { result } = renderHook(
      () => useUploadSearch({ query: 'contract' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/uploads/search', { query: 'contract' });
    expect(result.current.data).toEqual(searchResult);
  });

  it('passes optional filters', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { total: 0, page: 1, limit: 10, timedOut: false, items: [] } });

    renderHook(
      () => useUploadSearch({ query: 'test', documentType: 'supreme_court', dateFrom: '2025-01-01', dateTo: '2025-12-31', page: 2, limit: 5 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/uploads/search', {
        query: 'test',
        documentType: 'supreme_court',
        dateFrom: '2025-01-01',
        dateTo: '2025-12-31',
        page: 2,
        limit: 5,
      }),
    );
  });

  it('is disabled when params is null', () => {
    const { result } = renderHook(
      () => useUploadSearch(null),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('is disabled when query is empty', () => {
    const { result } = renderHook(
      () => useUploadSearch({ query: '' }),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('handles error state', async () => {
    mockPost.mockRejectedValueOnce(new Error('Search failed'));

    const { result } = renderHook(
      () => useUploadSearch({ query: 'test' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
