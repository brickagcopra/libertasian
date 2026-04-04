import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import {
  useContradictions,
  useContradiction,
  useGenerateContradiction,
  useDeleteContradiction,
} from './use-contradictions';
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

describe('use-contradictions hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useContradictions', () => {
    it('should fetch contradictions with default params', async () => {
      const mockResponse = {
        success: true,
        data: [],
        meta: { hasNext: false, cursor: null },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useContradictions(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/contradictions', {
        params: { limit: '20' },
      });
    });

    it('should pass filter params when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ success: true, data: [] });

      const { result } = renderHook(
        () =>
          useContradictions({
            status: 'completed',
            scope: 'intra-case',
            cursor: 'cursor-1',
            limit: 15,
          }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/contradictions', {
        params: {
          limit: '15',
          status: 'completed',
          scope: 'intra-case',
          cursor: 'cursor-1',
        },
      });
    });

    it('should handle API errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Server error'));

      const { result } = renderHook(() => useContradictions(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe('useContradiction', () => {
    it('should fetch a single contradiction when id is provided', async () => {
      const mockResponse = {
        success: true,
        data: { id: 'contra-1', status: 'completed' },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useContradiction('contra-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/contradictions/contra-1');
      expect(result.current.data).toEqual(mockResponse.data);
    });

    it('should be disabled when id is null', () => {
      const { result } = renderHook(() => useContradiction(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe('idle');
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });

  describe('useGenerateContradiction', () => {
    it('should call POST to generate contradiction report', async () => {
      const mockResponse = { success: true, data: { id: 'contra-1' } };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useGenerateContradiction(), {
        wrapper: createWrapper(),
      });

      const input = { documentIds: ['doc-1', 'doc-2'], scope: 'inter-case' };

      await act(async () => {
        await result.current.mutateAsync(input as never);
      });

      expect(apiClient.post).toHaveBeenCalledWith('/contradictions/generate', input);
    });

    it('should handle mutation errors', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Quota exceeded'));

      const { result } = renderHook(() => useGenerateContradiction(), {
        wrapper: createWrapper(),
      });

      await expect(
        act(async () => {
          await result.current.mutateAsync({ documentIds: ['doc-1'] } as never);
        }),
      ).rejects.toThrow('Quota exceeded');
    });
  });

  describe('useDeleteContradiction', () => {
    it('should call DELETE on the contradiction endpoint', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ success: true });

      const { result } = renderHook(() => useDeleteContradiction(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync('contra-1');
      });

      expect(apiClient.delete).toHaveBeenCalledWith('/contradictions/contra-1');
    });
  });
});
