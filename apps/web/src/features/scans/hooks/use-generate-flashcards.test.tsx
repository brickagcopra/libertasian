import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useGenerateFlashcardsFromScan } from './use-generate-flashcards';
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

describe('useGenerateFlashcardsFromScan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call POST with correct endpoint and body', async () => {
    const mockResponse = { success: true, data: { id: 'flashcards-1' } };
    vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useGenerateFlashcardsFromScan(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        uploadId: 'upload-1',
        flashcardSetId: 'set-1',
        cardType: 'definition',
        count: 10,
        barSubject: 'Civil Law',
      });
    });

    expect(apiClient.post).toHaveBeenCalledWith('/uploads/upload-1/generate-flashcards', {
      flashcardSetId: 'set-1',
      cardType: 'definition',
      count: 10,
      barSubject: 'Civil Law',
    });
  });

  it('should send only required fields when optional fields are omitted', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ success: true, data: {} });

    const { result } = renderHook(() => useGenerateFlashcardsFromScan(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        uploadId: 'upload-1',
        flashcardSetId: 'set-1',
      });
    });

    expect(apiClient.post).toHaveBeenCalledWith('/uploads/upload-1/generate-flashcards', {
      flashcardSetId: 'set-1',
    });
  });

  it('should handle mutation errors', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('Subscription required'));

    const { result } = renderHook(() => useGenerateFlashcardsFromScan(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          uploadId: 'upload-1',
          flashcardSetId: 'set-1',
        });
      }),
    ).rejects.toThrow('Subscription required');
  });
});
