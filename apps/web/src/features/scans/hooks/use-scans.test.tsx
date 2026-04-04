import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useScans, useScanDetail, useOcrResults, useGenerateDigestFromScan, useDeleteScan } from './use-scans';
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

describe('useScans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useScans', () => {
    it('should fetch scans with default params', async () => {
      const mockResponse = {
        success: true,
        data: [],
        meta: { hasNext: false, cursor: null },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useScans(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/uploads', {
        params: { limit: '20', uploadType: 'camera_scan' },
      });
      expect(result.current.data).toEqual(mockResponse);
    });

    it('should pass processingStatus and cursor when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ success: true, data: [] });

      const { result } = renderHook(
        () => useScans({ processingStatus: 'completed' as const, cursor: 'abc', limit: 10 }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/uploads', {
        params: {
          limit: '10',
          uploadType: 'camera_scan',
          processingStatus: 'completed',
          cursor: 'abc',
        },
      });
    });

    it('should handle API errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useScans(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeInstanceOf(Error);
    });
  });

  describe('useScanDetail', () => {
    it('should fetch scan detail when scanId is provided', async () => {
      const mockResponse = {
        success: true,
        data: { id: 'scan-1', processingStatus: 'completed' },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useScanDetail('scan-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/uploads/scan-1');
    });

    it('should be disabled when scanId is null', () => {
      const { result } = renderHook(() => useScanDetail(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe('idle');
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    it('should handle API errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Not found'));

      const { result } = renderHook(() => useScanDetail('scan-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe('useOcrResults', () => {
    it('should fetch OCR results when scanId is provided and enabled', async () => {
      const mockResponse = { success: true, data: { text: 'OCR text' } };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useOcrResults('scan-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/uploads/scan-1/ocr');
    });

    it('should be disabled when scanId is null', () => {
      const { result } = renderHook(() => useOcrResults(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe('idle');
    });

    it('should be disabled when enabled is false', () => {
      const { result } = renderHook(() => useOcrResults('scan-1', false), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe('idle');
    });
  });

  describe('useGenerateDigestFromScan', () => {
    it('should call POST to generate digest', async () => {
      const mockResponse = { success: true, data: { id: 'digest-1' } };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useGenerateDigestFromScan(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({ uploadId: 'scan-1', digestType: 'full' });
      });

      expect(apiClient.post).toHaveBeenCalledWith('/uploads/scan-1/generate-digest', {
        digestType: 'full',
      });
    });

    it('should handle mutation errors', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Forbidden'));

      const { result } = renderHook(() => useGenerateDigestFromScan(), {
        wrapper: createWrapper(),
      });

      await expect(
        act(async () => {
          await result.current.mutateAsync({ uploadId: 'scan-1' });
        }),
      ).rejects.toThrow('Forbidden');
    });
  });

  describe('useDeleteScan', () => {
    it('should call DELETE on the scan endpoint', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ success: true });

      const { result } = renderHook(() => useDeleteScan(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync('scan-1');
      });

      expect(apiClient.delete).toHaveBeenCalledWith('/uploads/scan-1');
    });

    it('should handle deletion errors', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(new Error('Not found'));

      const { result } = renderHook(() => useDeleteScan(), {
        wrapper: createWrapper(),
      });

      await expect(
        act(async () => {
          await result.current.mutateAsync('scan-1');
        }),
      ).rejects.toThrow('Not found');
    });
  });
});
