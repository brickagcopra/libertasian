import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    uploadMultipart: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import {
  useUploadFeedMedia,
  useFeedMediaStatus,
  useDeleteFeedMedia,
} from './use-feed-media';

const mockUpload = vi.mocked(apiClient.uploadMultipart);
const mockGet = vi.mocked(apiClient.get);
const mockDelete = vi.mocked(apiClient.delete);

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

describe('useUploadFeedMedia', () => {
  beforeEach(() => mockUpload.mockReset());

  it('uploads file via multipart', async () => {
    mockUpload.mockResolvedValueOnce({
      success: true,
      data: { mediaId: 'media-1', processingStatus: 'processing' },
    });

    const { result } = renderHook(() => useUploadFeedMedia(), {
      wrapper: createWrapper(),
    });

    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });

    await act(async () => {
      result.current.mutate({ file });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpload).toHaveBeenCalledWith(
      '/feed/media/upload',
      expect.any(FormData),
      expect.any(Object),
    );
  });
});

describe('useFeedMediaStatus', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches media status when mediaId provided', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: { processingStatus: 'ready' },
    });

    const { result } = renderHook(() => useFeedMediaStatus('media-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/feed/media/media-1/status');
  });

  it('does not fetch when mediaId is null', () => {
    renderHook(() => useFeedMediaStatus(null), {
      wrapper: createWrapper(),
    });
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('useDeleteFeedMedia', () => {
  beforeEach(() => mockDelete.mockReset());

  it('deletes media by ID', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useDeleteFeedMedia(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('media-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/feed/media/media-1');
  });
});
