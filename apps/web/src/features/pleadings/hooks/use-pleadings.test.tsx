import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import {
  usePleadings,
  usePleading,
  usePleadingTemplates,
  usePleadingTemplate,
  useGeneratePleading,
  useDeletePleading,
} from './use-pleadings';
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

describe('use-pleadings hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('usePleadings', () => {
    it('should fetch pleadings with default params', async () => {
      const mockResponse = {
        success: true,
        data: [],
        meta: { hasNext: false, cursor: null },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => usePleadings(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/pleadings', {
        params: { limit: '20' },
      });
    });

    it('should pass all filter params when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ success: true, data: [] });

      const { result } = renderHook(
        () =>
          usePleadings({
            status: 'completed',
            templateId: 'tmpl-1',
            category: 'motion',
            matterId: 'matter-1',
            cursor: 'cursor-1',
            limit: 15,
          }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/pleadings', {
        params: {
          limit: '15',
          status: 'completed',
          templateId: 'tmpl-1',
          category: 'motion',
          matterId: 'matter-1',
          cursor: 'cursor-1',
        },
      });
    });

    it('should handle API errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => usePleadings(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe('usePleading', () => {
    it('should fetch a single pleading when id is provided', async () => {
      const mockResponse = {
        success: true,
        data: { id: 'pl-1', status: 'completed' },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => usePleading('pl-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/pleadings/pl-1');
      expect(result.current.data).toEqual(mockResponse.data);
    });

    it('should be disabled when id is null', () => {
      const { result } = renderHook(() => usePleading(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe('idle');
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });

  describe('usePleadingTemplates', () => {
    it('should fetch templates without category filter', async () => {
      const mockResponse = { success: true, data: [] };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => usePleadingTemplates(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/pleadings/templates', { params: {} });
    });

    it('should pass category param when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ success: true, data: [] });

      const { result } = renderHook(() => usePleadingTemplates('motion'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/pleadings/templates', {
        params: { category: 'motion' },
      });
    });
  });

  describe('usePleadingTemplate', () => {
    it('should fetch a single template when id is provided', async () => {
      const mockResponse = {
        success: true,
        data: { id: 'tmpl-1', name: 'Motion to Dismiss' },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => usePleadingTemplate('tmpl-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/pleadings/templates/tmpl-1');
      expect(result.current.data).toEqual(mockResponse.data);
    });

    it('should be disabled when id is null', () => {
      const { result } = renderHook(() => usePleadingTemplate(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe('idle');
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });

  describe('useGeneratePleading', () => {
    it('should call POST to generate pleading', async () => {
      const mockResponse = { success: true, data: { id: 'pl-1' } };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useGeneratePleading(), {
        wrapper: createWrapper(),
      });

      const input = { templateId: 'tmpl-1', matterId: 'matter-1' };

      await act(async () => {
        await result.current.mutateAsync(input as never);
      });

      expect(apiClient.post).toHaveBeenCalledWith('/pleadings/generate', input);
    });

    it('should handle mutation errors', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Forbidden'));

      const { result } = renderHook(() => useGeneratePleading(), {
        wrapper: createWrapper(),
      });

      await expect(
        act(async () => {
          await result.current.mutateAsync({ templateId: 'tmpl-1' } as never);
        }),
      ).rejects.toThrow('Forbidden');
    });
  });

  describe('useDeletePleading', () => {
    it('should call DELETE on the pleading endpoint', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ success: true });

      const { result } = renderHook(() => useDeletePleading(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync('pl-1');
      });

      expect(apiClient.delete).toHaveBeenCalledWith('/pleadings/pl-1');
    });
  });
});
