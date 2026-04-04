import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useAttachToMatter } from './use-attach-to-matter';
import { apiClient } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
  },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useAttachToMatter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call POST with correct endpoint and body', async () => {
    const mockResponse = { success: true, data: { id: 'attachment-1' } };
    vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useAttachToMatter(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        uploadId: 'upload-1',
        matterId: 'matter-1',
        title: 'Test Document',
        role: 'exhibit',
      });
    });

    expect(apiClient.post).toHaveBeenCalledWith('/uploads/upload-1/attach-to-matter', {
      matterId: 'matter-1',
      title: 'Test Document',
      role: 'exhibit',
    });
  });

  it('should send only required fields when optional fields are omitted', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ success: true, data: {} });

    const { result } = renderHook(() => useAttachToMatter(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        uploadId: 'upload-1',
        matterId: 'matter-1',
      });
    });

    expect(apiClient.post).toHaveBeenCalledWith('/uploads/upload-1/attach-to-matter', {
      matterId: 'matter-1',
    });
  });

  it('should handle mutation errors', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('Bad request'));

    const { result } = renderHook(() => useAttachToMatter(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          uploadId: 'upload-1',
          matterId: 'matter-1',
        });
      }),
    ).rejects.toThrow('Bad request');
  });
});
