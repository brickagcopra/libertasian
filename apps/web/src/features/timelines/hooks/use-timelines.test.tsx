import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import {
  useTimelines,
  useTimeline,
  useGenerateTimeline,
  useDeleteTimeline,
} from './use-timelines';
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

describe('use-timelines hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useTimelines', () => {
    it('should fetch timelines with default params', async () => {
      const mockResponse = {
        success: true,
        data: [],
        meta: { hasNext: false, cursor: null },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useTimelines(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/timelines', {
        params: { limit: '20' },
      });
    });

    it('should pass filter params when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ success: true, data: [] });

      const { result } = renderHook(
        () =>
          useTimelines({
            status: 'completed',
            matterId: 'matter-1',
            cursor: 'cursor-1',
            limit: 10,
          }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/timelines', {
        params: {
          limit: '10',
          status: 'completed',
          matterId: 'matter-1',
          cursor: 'cursor-1',
        },
      });
    });

    it('should handle API errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useTimelines(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe('useTimeline', () => {
    it('should fetch a single timeline when id is provided', async () => {
      const mockResponse = {
        success: true,
        data: { id: 'tl-1', status: 'completed' },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useTimeline('tl-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/timelines/tl-1');
      expect(result.current.data).toEqual(mockResponse.data);
    });

    it('should be disabled when id is null', () => {
      const { result } = renderHook(() => useTimeline(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe('idle');
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });

  describe('useGenerateTimeline', () => {
    it('should call POST to generate timeline', async () => {
      const mockResponse = { success: true, data: { id: 'tl-1' } };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useGenerateTimeline(), {
        wrapper: createWrapper(),
      });

      const input = { matterId: 'matter-1', documentIds: ['doc-1', 'doc-2'] };

      await act(async () => {
        await result.current.mutateAsync(input as never);
      });

      expect(apiClient.post).toHaveBeenCalledWith('/timelines/generate', input);
    });

    it('should handle mutation errors', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Insufficient quota'));

      const { result } = renderHook(() => useGenerateTimeline(), {
        wrapper: createWrapper(),
      });

      await expect(
        act(async () => {
          await result.current.mutateAsync({ matterId: 'matter-1' } as never);
        }),
      ).rejects.toThrow('Insufficient quota');
    });
  });

  describe('useDeleteTimeline', () => {
    it('should call DELETE on the timeline endpoint', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ success: true });

      const { result } = renderHook(() => useDeleteTimeline(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync('tl-1');
      });

      expect(apiClient.delete).toHaveBeenCalledWith('/timelines/tl-1');
    });
  });
});
