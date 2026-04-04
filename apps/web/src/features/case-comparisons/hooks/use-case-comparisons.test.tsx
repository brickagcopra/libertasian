import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import {
  useComparisons,
  useComparison,
  useGenerateComparison,
  useDeleteComparison,
} from './use-case-comparisons';
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

describe('use-case-comparisons hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useComparisons', () => {
    it('should fetch comparisons with default params', async () => {
      const mockResponse = {
        success: true,
        data: [],
        meta: { hasNext: false, cursor: null },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useComparisons(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/case-comparisons', {
        params: { limit: '20' },
      });
    });

    it('should pass filter params when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ success: true, data: [] });

      const { result } = renderHook(
        () =>
          useComparisons({
            comparisonType: 'doctrinal',
            status: 'completed',
            matterId: 'matter-1',
            cursor: 'abc',
            limit: 10,
          }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/case-comparisons', {
        params: {
          limit: '10',
          comparisonType: 'doctrinal',
          status: 'completed',
          matterId: 'matter-1',
          cursor: 'abc',
        },
      });
    });

    it('should handle API errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useComparisons(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe('useComparison', () => {
    it('should fetch a single comparison when id is provided', async () => {
      const mockResponse = {
        success: true,
        data: { id: 'comp-1', status: 'completed' },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useComparison('comp-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/case-comparisons/comp-1');
      expect(result.current.data).toEqual(mockResponse.data);
    });

    it('should be disabled when id is null', () => {
      const { result } = renderHook(() => useComparison(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe('idle');
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });

  describe('useGenerateComparison', () => {
    it('should call POST to generate comparison', async () => {
      const mockResponse = { success: true, data: { id: 'comp-1' } };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useGenerateComparison(), {
        wrapper: createWrapper(),
      });

      const input = {
        documentIds: ['doc-1', 'doc-2'],
        comparisonType: 'doctrinal',
      };

      await act(async () => {
        await result.current.mutateAsync(input as never);
      });

      expect(apiClient.post).toHaveBeenCalledWith('/case-comparisons/generate', input);
    });

    it('should handle mutation errors', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Limit exceeded'));

      const { result } = renderHook(() => useGenerateComparison(), {
        wrapper: createWrapper(),
      });

      await expect(
        act(async () => {
          await result.current.mutateAsync({ documentIds: ['doc-1'] } as never);
        }),
      ).rejects.toThrow('Limit exceeded');
    });
  });

  describe('useDeleteComparison', () => {
    it('should call DELETE on the comparison endpoint', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ success: true });

      const { result } = renderHook(() => useDeleteComparison(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync('comp-1');
      });

      expect(apiClient.delete).toHaveBeenCalledWith('/case-comparisons/comp-1');
    });
  });
});
