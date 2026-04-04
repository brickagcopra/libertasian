import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
    download: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import {
  useCreateExport,
  useExport,
  useExports,
  useDownloadExport,
} from './use-exports';

const mockPost = vi.mocked(apiClient.post);
const mockGet = vi.mocked(apiClient.get);
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

describe('useCreateExport', () => {
  beforeEach(() => mockPost.mockReset());

  it('posts to /exports and returns job detail', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'job-1',
        contentType: 'digest',
        contentId: 'd-1',
        format: 'pdf',
        status: 'pending',
      },
    });

    const { result } = renderHook(() => useCreateExport(), {
      wrapper: createWrapper(),
    });

    let job: unknown;
    await act(async () => {
      job = await result.current.mutateAsync({
        contentType: 'digest',
        contentId: 'd-1',
        format: 'pdf',
      });
    });

    expect(mockPost).toHaveBeenCalledWith('/exports', {
      contentType: 'digest',
      contentId: 'd-1',
      format: 'pdf',
    });
    expect((job as { id: string }).id).toBe('job-1');
  });
});

describe('useExport', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches export detail by ID', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'job-1',
        status: 'completed',
        filename: 'digest.pdf',
        fileSizeBytes: 1024,
      },
    });

    const { result } = renderHook(() => useExport('job-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/exports/job-1');
  });

  it('does not fetch when id is null', () => {
    renderHook(() => useExport(null), {
      wrapper: createWrapper(),
    });
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('useExports', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches export list', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [],
      nextCursor: null,
    });

    const { result } = renderHook(() => useExports(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/exports', { params: {} });
  });

  it('passes contentType and limit params', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [],
      nextCursor: null,
    });

    const { result } = renderHook(
      () => useExports({ contentType: 'digest', limit: 10 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/exports', {
      params: { contentType: 'digest', limit: '10' },
    });
  });
});

describe('useDownloadExport', () => {
  beforeEach(() => mockDownload.mockReset());

  it('downloads export by ID', async () => {
    mockDownload.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useDownloadExport(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync('job-1');
    });

    expect(mockDownload).toHaveBeenCalledWith('/exports/job-1/download');
  });
});
