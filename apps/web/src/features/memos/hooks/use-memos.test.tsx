import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useMemos, useMemo, useGenerateMemo, useDeleteMemo } from './use-memos';
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

describe('use-memos hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useMemos', () => {
    it('should fetch memos with default params', async () => {
      const mockResponse = {
        success: true,
        data: [],
        meta: { hasNext: false, cursor: null },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useMemos(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/memos', {
        params: { limit: '20' },
      });
    });

    it('should pass filter params when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ success: true, data: [] });

      const { result } = renderHook(
        () =>
          useMemos({
            memoType: 'research',
            status: 'completed',
            matterId: 'matter-1',
            cursor: 'cursor-1',
            limit: 10,
          }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/memos', {
        params: {
          limit: '10',
          memoType: 'research',
          status: 'completed',
          matterId: 'matter-1',
          cursor: 'cursor-1',
        },
      });
    });

    it('should handle API errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Server error'));

      const { result } = renderHook(() => useMemos(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe('useMemo', () => {
    it('should fetch a single memo when id is provided', async () => {
      const mockResponse = {
        success: true,
        data: { id: 'memo-1', status: 'completed' },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useMemo('memo-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/memos/memo-1');
      expect(result.current.data).toEqual(mockResponse.data);
    });

    it('should be disabled when id is null', () => {
      const { result } = renderHook(() => useMemo(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe('idle');
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });

  describe('useGenerateMemo', () => {
    it('should call POST to generate memo', async () => {
      const mockResponse = { success: true, data: { id: 'memo-1' } };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useGenerateMemo(), {
        wrapper: createWrapper(),
      });

      const input = { topic: 'Contract dispute', memoType: 'research' };

      await act(async () => {
        await result.current.mutateAsync(input as never);
      });

      expect(apiClient.post).toHaveBeenCalledWith('/memos/generate', input);
    });

    it('should handle mutation errors', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Rate limited'));

      const { result } = renderHook(() => useGenerateMemo(), {
        wrapper: createWrapper(),
      });

      await expect(
        act(async () => {
          await result.current.mutateAsync({ topic: 'Test' } as never);
        }),
      ).rejects.toThrow('Rate limited');
    });
  });

  describe('useDeleteMemo', () => {
    it('should call DELETE on the memo endpoint', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ success: true });

      const { result } = renderHook(() => useDeleteMemo(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync('memo-1');
      });

      expect(apiClient.delete).toHaveBeenCalledWith('/memos/memo-1');
    });
  });
});
