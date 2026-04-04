import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useUpdatePrivacy } from './use-update-privacy';
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

describe('useUpdatePrivacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call PATCH with correct endpoint and body for private', async () => {
    const mockResponse = {
      success: true,
      data: { id: 'upload-1', privacyLevel: 'private' },
    };
    vi.mocked(apiClient.patch).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useUpdatePrivacy(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        uploadId: 'upload-1',
        privacyLevel: 'private',
      });
    });

    expect(apiClient.patch).toHaveBeenCalledWith('/uploads/upload-1/privacy', {
      privacyLevel: 'private',
    });
  });

  it('should call PATCH with editorial_candidate privacy level', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({
      success: true,
      data: { id: 'upload-1', privacyLevel: 'editorial_candidate' },
    });

    const { result } = renderHook(() => useUpdatePrivacy(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        uploadId: 'upload-1',
        privacyLevel: 'editorial_candidate',
      });
    });

    expect(apiClient.patch).toHaveBeenCalledWith('/uploads/upload-1/privacy', {
      privacyLevel: 'editorial_candidate',
    });
  });

  it('should handle mutation errors', async () => {
    vi.mocked(apiClient.patch).mockRejectedValue(new Error('Forbidden'));

    const { result } = renderHook(() => useUpdatePrivacy(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          uploadId: 'upload-1',
          privacyLevel: 'private',
        });
      }),
    ).rejects.toThrow('Forbidden');
  });
});
