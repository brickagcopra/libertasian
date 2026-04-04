import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the api client
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import { useSearch, useSuggestions } from './use-search';

const mockPost = vi.mocked(apiClient.post);
const mockGet = vi.mocked(apiClient.get);

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

describe('useSearch', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockReset();
  });

  it('does not fetch when filters is null', () => {
    const { result } = renderHook(() => useSearch(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('does not fetch when query is empty', () => {
    const { result } = renderHook(
      () => useSearch({ query: '' }),
      { wrapper: createWrapper() },
    );

    expect(result.current.isFetching).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('fetches search results when query is provided', async () => {
    const mockResponse = {
      success: true,
      data: [{ document_id: '1', title: 'Test Case' }],
      meta: { total: 1 },
    };
    mockPost.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(
      () => useSearch({ query: 'test query' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockPost).toHaveBeenCalledWith('/search', { query: 'test query' });
    expect(result.current.data).toEqual(mockResponse);
  });

  it('passes filter parameters in request body', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: [], meta: { total: 0 } });

    const filters = {
      query: 'contract law',
      documentType: 'decision',
      court: 'Supreme Court',
      page: 2,
      limit: 20,
    };

    const { result } = renderHook(
      () => useSearch(filters),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockPost).toHaveBeenCalledWith('/search', {
      query: 'contract law',
      documentType: 'decision',
      court: 'Supreme Court',
      page: 2,
      limit: 20,
    });
  });
});

describe('useSuggestions', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('does not fetch when prefix is too short', () => {
    const { result } = renderHook(
      () => useSuggestions('a'),
      { wrapper: createWrapper() },
    );

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('fetches suggestions when prefix is 2+ characters', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: ['contract', 'constitutional law'],
    });

    const { result } = renderHook(
      () => useSuggestions('co'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith('/search/suggestions', {
      params: { q: 'co' },
    });
    expect(result.current.data).toEqual(['contract', 'constitutional law']);
  });
});
