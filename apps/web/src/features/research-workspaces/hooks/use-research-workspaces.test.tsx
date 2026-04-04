import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import {
  useResearchWorkspaces,
  useResearchWorkspace,
  useCreateResearchWorkspace,
  useUpdateResearchWorkspace,
  useDeleteResearchWorkspace,
  useResearchQueries,
  useAskResearchQuery,
} from './use-research-workspaces';
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

describe('use-research-workspaces hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useResearchWorkspaces', () => {
    it('should fetch workspaces with default params', async () => {
      const mockResponse = {
        success: true,
        data: [],
        meta: { hasNext: false, cursor: null },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useResearchWorkspaces(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/research-workspaces', {
        params: { limit: '20' },
      });
    });

    it('should pass cursor param when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ success: true, data: [] });

      const { result } = renderHook(
        () => useResearchWorkspaces({ cursor: 'cursor-1', limit: 10 }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/research-workspaces', {
        params: { limit: '10', cursor: 'cursor-1' },
      });
    });

    it('should handle API errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useResearchWorkspaces(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe('useResearchWorkspace', () => {
    it('should fetch a single workspace when id is provided', async () => {
      const mockResponse = {
        success: true,
        data: { id: 'ws-1', name: 'Research 1' },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useResearchWorkspace('ws-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/research-workspaces/ws-1');
      expect(result.current.data).toEqual(mockResponse.data);
    });

    it('should be disabled when id is null', () => {
      const { result } = renderHook(() => useResearchWorkspace(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe('idle');
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });

  describe('useCreateResearchWorkspace', () => {
    it('should call POST to create workspace', async () => {
      const mockResponse = { success: true, data: { id: 'ws-1' } };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useCreateResearchWorkspace(), {
        wrapper: createWrapper(),
      });

      const input = { name: 'New Research', description: 'Research desc' };

      await act(async () => {
        await result.current.mutateAsync(input as never);
      });

      expect(apiClient.post).toHaveBeenCalledWith('/research-workspaces', input);
    });

    it('should handle mutation errors', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Validation error'));

      const { result } = renderHook(() => useCreateResearchWorkspace(), {
        wrapper: createWrapper(),
      });

      await expect(
        act(async () => {
          await result.current.mutateAsync({ name: '' } as never);
        }),
      ).rejects.toThrow('Validation error');
    });
  });

  describe('useUpdateResearchWorkspace', () => {
    it('should call PATCH to update workspace', async () => {
      const mockResponse = { success: true, data: { id: 'ws-1' } };
      vi.mocked(apiClient.patch).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useUpdateResearchWorkspace('ws-1'), {
        wrapper: createWrapper(),
      });

      const input = { name: 'Updated Research' };

      await act(async () => {
        await result.current.mutateAsync(input as never);
      });

      expect(apiClient.patch).toHaveBeenCalledWith('/research-workspaces/ws-1', input);
    });
  });

  describe('useDeleteResearchWorkspace', () => {
    it('should call DELETE on the workspace endpoint', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ success: true });

      const { result } = renderHook(() => useDeleteResearchWorkspace(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync('ws-1');
      });

      expect(apiClient.delete).toHaveBeenCalledWith('/research-workspaces/ws-1');
    });
  });

  describe('useResearchQueries', () => {
    it('should fetch queries for a workspace', async () => {
      const mockResponse = {
        success: true,
        data: [{ id: 'q-1', queryText: 'test query', responseJson: { answer: 'test' } }],
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useResearchQueries('ws-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/research-workspaces/ws-1/queries');
      expect(result.current.data).toEqual(mockResponse.data);
    });

    it('should be disabled when workspaceId is null', () => {
      const { result } = renderHook(() => useResearchQueries(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe('idle');
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });

  describe('useAskResearchQuery', () => {
    it('should call POST to ask a research query', async () => {
      const mockResponse = { success: true, data: { id: 'q-1' } };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useAskResearchQuery('ws-1'), {
        wrapper: createWrapper(),
      });

      const input = { queryText: 'What is the ruling on...' };

      await act(async () => {
        await result.current.mutateAsync(input as never);
      });

      expect(apiClient.post).toHaveBeenCalledWith('/research-workspaces/ws-1/queries', input);
    });

    it('should handle mutation errors', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Rate limited'));

      const { result } = renderHook(() => useAskResearchQuery('ws-1'), {
        wrapper: createWrapper(),
      });

      await expect(
        act(async () => {
          await result.current.mutateAsync({ queryText: 'test' } as never);
        }),
      ).rejects.toThrow('Rate limited');
    });
  });
});
