import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import {
  useHearingPreps,
  useHearingPrep,
  useGenerateHearingPrep,
  useDeleteHearingPrep,
} from './use-hearing-prep';
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

describe('use-hearing-prep hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useHearingPreps', () => {
    it('should fetch hearing preps with default params', async () => {
      const mockResponse = {
        success: true,
        data: [],
        meta: { hasNext: false, cursor: null },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useHearingPreps(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/hearing-prep', {
        params: { limit: '20' },
      });
    });

    it('should pass filter params when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ success: true, data: [] });

      const { result } = renderHook(
        () =>
          useHearingPreps({
            status: 'completed',
            matterId: 'matter-1',
            cursor: 'cursor-1',
            limit: 10,
          }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/hearing-prep', {
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

      const { result } = renderHook(() => useHearingPreps(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe('useHearingPrep', () => {
    it('should fetch a single hearing prep when id is provided', async () => {
      const mockResponse = {
        success: true,
        data: { id: 'hp-1', status: 'completed' },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useHearingPrep('hp-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/hearing-prep/hp-1');
      expect(result.current.data).toEqual(mockResponse.data);
    });

    it('should be disabled when id is null', () => {
      const { result } = renderHook(() => useHearingPrep(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe('idle');
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });

  describe('useGenerateHearingPrep', () => {
    it('should call POST to generate hearing prep', async () => {
      const mockResponse = { success: true, data: { id: 'hp-1' } };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useGenerateHearingPrep(), {
        wrapper: createWrapper(),
      });

      const input = { matterId: 'matter-1', hearingDate: '2026-04-01' };

      await act(async () => {
        await result.current.mutateAsync(input as never);
      });

      expect(apiClient.post).toHaveBeenCalledWith('/hearing-prep/generate', input);
    });

    it('should handle mutation errors', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Unauthorized'));

      const { result } = renderHook(() => useGenerateHearingPrep(), {
        wrapper: createWrapper(),
      });

      await expect(
        act(async () => {
          await result.current.mutateAsync({ matterId: 'matter-1' } as never);
        }),
      ).rejects.toThrow('Unauthorized');
    });
  });

  describe('useDeleteHearingPrep', () => {
    it('should call DELETE on the hearing prep endpoint', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ success: true });

      const { result } = renderHook(() => useDeleteHearingPrep(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync('hp-1');
      });

      expect(apiClient.delete).toHaveBeenCalledWith('/hearing-prep/hp-1');
    });
  });
});
