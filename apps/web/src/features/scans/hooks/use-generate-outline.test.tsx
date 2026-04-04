import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useGenerateOutlineFromScan } from './use-generate-outline';
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

describe('useGenerateOutlineFromScan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call POST with correct endpoint and body', async () => {
    const mockResponse = { success: true, data: { id: 'outline-1' } };
    vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useGenerateOutlineFromScan(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        uploadId: 'upload-1',
        outlineType: 'detailed',
      });
    });

    expect(apiClient.post).toHaveBeenCalledWith('/uploads/upload-1/generate-outline', {
      outlineType: 'detailed',
    });
  });

  it('should send only uploadId when outlineType is omitted', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ success: true, data: {} });

    const { result } = renderHook(() => useGenerateOutlineFromScan(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        uploadId: 'upload-1',
      });
    });

    expect(apiClient.post).toHaveBeenCalledWith('/uploads/upload-1/generate-outline', {});
  });

  it('should handle mutation errors', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('Server error'));

    const { result } = renderHook(() => useGenerateOutlineFromScan(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ uploadId: 'upload-1' });
      }),
    ).rejects.toThrow('Server error');
  });
});
