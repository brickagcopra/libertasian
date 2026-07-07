import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import {
  useDigestTextSearch,
  normalizeDigestTextSearchResponse,
} from './use-digest-text-search';
import type { DigestTextSearchResult } from '../types';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn() },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const payload: DigestTextSearchResult = {
  results: [
    {
      id: 'd1',
      title: 'People v. Reyes - Digest',
    } as DigestTextSearchResult['results'][number],
  ],
  hasMore: false,
  cursor: null,
  matchedDocuments: [
    { id: 'ld1', title: 'People v. Reyes', grNo: 'G.R. No. 123456', citationText: null },
  ],
};

beforeEach(() => jest.clearAllMocks());

describe('useDigestTextSearch', () => {
  it('calls /digests/search with q and limit params', async () => {
    mockGet.mockResolvedValueOnce(payload);
    const { result } = renderHook(() => useDigestTextSearch('estafa', true), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/digests/search', {
      params: { q: 'estafa', limit: '30' },
    });
  });

  it('returns payload as-is when apiClient already unwrapped the envelope', async () => {
    // Plain { success, data } envelope → unwrapEnvelope strips it, hook
    // receives the bare payload with `results` at the top level.
    mockGet.mockResolvedValueOnce(payload);
    const { result } = renderHook(() => useDigestTextSearch('estafa', true), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(payload);
    expect(result.current.data?.results[0]?.id).toBe('d1');
  });

  it('normalizes the full envelope when a sibling meta key blocks unwrapping', async () => {
    // Preview-mode responses include a sibling `meta` key, so unwrapEnvelope
    // returns the WHOLE envelope untouched. The hook must reach into .data.
    mockGet.mockResolvedValueOnce({
      success: true,
      data: payload,
      meta: { previewMode: true, lockedCount: 4 },
    });
    const { result } = renderHook(() => useDigestTextSearch('estafa', true), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(payload);
    expect(result.current.data?.results[0]?.id).toBe('d1');
    expect(result.current.data?.matchedDocuments).toHaveLength(1);
  });

  it('is idle when q is empty', () => {
    const { result } = renderHook(() => useDigestTextSearch('', true), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('is idle when disabled', () => {
    const { result } = renderHook(() => useDigestTextSearch('estafa', false), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('does not retry on failure', async () => {
    mockGet.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useDigestTextSearch('estafa', true), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});

describe('normalizeDigestTextSearchResponse', () => {
  it('passes through the unwrapped shape', () => {
    expect(normalizeDigestTextSearchResponse(payload)).toBe(payload);
  });

  it('extracts .data from the un-unwrapped envelope shape', () => {
    expect(
      normalizeDigestTextSearchResponse({
        success: true,
        data: payload,
        meta: { previewMode: true },
      }),
    ).toBe(payload);
  });
});
