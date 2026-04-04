import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    download: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import {
  useExportFlashcardSet,
  useExportReviewerPack,
} from './use-study-export';

const mockDownload = vi.mocked(apiClient.download);

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

describe('useExportFlashcardSet', () => {
  beforeEach(() => mockDownload.mockReset());

  it('exports flashcard set as PDF', async () => {
    mockDownload.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useExportFlashcardSet(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ id: 'fs1', format: 'pdf' as const });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDownload).toHaveBeenCalledWith(
      '/study/flashcard-sets/fs1/export',
      { params: { format: 'pdf' } },
    );
  });

  it('exports flashcard set as DOCX', async () => {
    mockDownload.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useExportFlashcardSet(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ id: 'fs2', format: 'docx' as const });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDownload).toHaveBeenCalledWith(
      '/study/flashcard-sets/fs2/export',
      { params: { format: 'docx' } },
    );
  });

  it('handles export error', async () => {
    mockDownload.mockRejectedValueOnce(new Error('Export failed'));

    const { result } = renderHook(() => useExportFlashcardSet(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ id: 'fs1', format: 'pdf' as const });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Export failed');
  });
});

describe('useExportReviewerPack', () => {
  beforeEach(() => mockDownload.mockReset());

  it('exports reviewer pack as PDF', async () => {
    mockDownload.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useExportReviewerPack(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ id: 'rp1', format: 'pdf' as const });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDownload).toHaveBeenCalledWith(
      '/study/reviewer-packs/rp1/export',
      { params: { format: 'pdf' } },
    );
  });

  it('exports reviewer pack as DOCX', async () => {
    mockDownload.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useExportReviewerPack(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ id: 'rp2', format: 'docx' as const });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDownload).toHaveBeenCalledWith(
      '/study/reviewer-packs/rp2/export',
      { params: { format: 'docx' } },
    );
  });

  it('handles export error', async () => {
    mockDownload.mockRejectedValueOnce(new Error('Not found'));

    const { result } = renderHook(() => useExportReviewerPack(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ id: 'rp1', format: 'pdf' as const });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
