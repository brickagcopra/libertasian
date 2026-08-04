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
import { useDigestCount } from './use-digest-count';
import { useSearchDigests } from './use-search-digests';

const mockedPost = vi.mocked(apiClient.post);

const searchResponse = (total: number) => ({
  success: true,
  data: [],
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

describe('useDigestCount', () => {
  beforeEach(() => {
    mockedPost.mockReset();
  });

  it('returns undefined when not enabled', () => {
    const { result } = renderHook(() => useDigestCount('estafa', false), {
      wrapper: createWrapper(),
    });

    expect(result.current.data).toBeUndefined();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('returns undefined for an empty query', () => {
    const { result } = renderHook(() => useDigestCount('', true), {
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

    await waitFor(() => expect(result.current.data).toBe(3_359));
  });

  it('returns 0 when the corpus has no match', async () => {
    mockedPost.mockResolvedValue(searchResponse(0));

    const { result } = renderHook(() => useDigestCount('estafa', true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBe(0));
  });

  it('falls back to meta.total when counts is absent', async () => {
    mockedPost.mockResolvedValue({ success: true, data: [], meta: { total: 4 } });

    const { result } = renderHook(() => useDigestCount('estafa', true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toBe(4));
  });

  // One request, not two: the count shares the list's query key, so the badge
  // can never disagree with the list it labels.
  it('shares the list request rather than issuing a second round-trip', async () => {
    mockedPost.mockResolvedValue(searchResponse(7));

    const { result } = renderHook(
      () => ({
        list: useSearchDigests('estafa', true),
        count: useDigestCount('estafa', true),
      }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.count.data).toBe(7));

    expect(result.current.list.data?.count).toBe(7);
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });
});
