import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import { useCodals } from './use-codals';

const mockGet = vi.mocked(apiClient.get);

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

describe('useCodals', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches codals for a given subject', async () => {
    const response = {
      success: true,
      data: [
        { id: 'doc1', title: 'Civil Code Article 1', citation: 'Art. 1' },
      ],
      meta: { hasNext: false, nextCursor: null, total: 1 },
    };
    mockGet.mockResolvedValueOnce(response);

    const { result } = renderHook(() => useCodals('civil_law'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/study/codals/civil_law', {
      params: { limit: '20' },
    });
    expect(result.current.data?.data).toHaveLength(1);
  });

  it('passes cursor, documentType, and search params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [], meta: {} });

    const { result } = renderHook(
      () =>
        useCodals('criminal_law', {
          cursor: 'abc123',
          documentType: 'statute',
          search: 'murder',
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/study/codals/criminal_law', {
      params: {
        limit: '20',
        cursor: 'abc123',
        documentType: 'statute',
        search: 'murder',
      },
    });
  });

  it('omits undefined optional params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [], meta: {} });

    const { result } = renderHook(() => useCodals('remedial_law'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const callParams = mockGet.mock.calls[0]?.[1] as { params: Record<string, string> };
    expect(callParams.params).toEqual({ limit: '20' });
    expect(callParams.params).not.toHaveProperty('cursor');
    expect(callParams.params).not.toHaveProperty('documentType');
    expect(callParams.params).not.toHaveProperty('search');
  });

  it('is disabled when subject is empty', () => {
    const { result } = renderHook(() => useCodals(''), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('encodes special characters in subject', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [], meta: {} });

    const { result } = renderHook(
      () => useCodals('political law & public international law'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith(
      '/study/codals/political%20law%20%26%20public%20international%20law',
      { params: { limit: '20' } },
    );
  });
});
