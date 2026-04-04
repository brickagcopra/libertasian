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

const mockedPost = vi.mocked(apiClient.post);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('useDigestCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns undefined when not enabled', () => {
    const { result } = renderHook(
      () => useDigestCount(null, false),
      { wrapper: createWrapper() },
    );

    expect(result.current.data).toBeUndefined();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('returns undefined when documentIds is empty', () => {
    const { result } = renderHook(
      () => useDigestCount([], true),
      { wrapper: createWrapper() },
    );

    expect(result.current.data).toBeUndefined();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('fetches count for valid document IDs', async () => {
    mockedPost.mockResolvedValue({ success: true, data: { count: 3 } });

    const { result } = renderHook(
      () => useDigestCount(['doc-1', 'doc-2'], true),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toBe(3);
    });

    expect(mockedPost).toHaveBeenCalledWith('/digests/by-documents/count', {
      legalDocumentIds: ['doc-1', 'doc-2'],
    });
  });

  it('returns 0 when API returns zero count', async () => {
    mockedPost.mockResolvedValue({ success: true, data: { count: 0 } });

    const { result } = renderHook(
      () => useDigestCount(['doc-1'], true),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toBe(0);
    });
  });
});
