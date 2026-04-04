import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import {
  useApiKeys,
  useApiKey,
  useCreateApiKey,
  useUpdateApiKey,
  useDeleteApiKey,
} from './use-api-keys';
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

describe('use-api-keys hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useApiKeys', () => {
    it('should fetch API keys with default params', async () => {
      const mockResponse = {
        success: true,
        data: [],
        meta: { hasNext: false, cursor: null },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useApiKeys(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/api-keys', {
        params: { limit: '20' },
      });
    });

    it('should pass cursor param when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ success: true, data: [] });

      const { result } = renderHook(
        () => useApiKeys({ cursor: 'cursor-1', limit: 10 }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/api-keys', {
        params: { limit: '10', cursor: 'cursor-1' },
      });
    });

    it('should handle API errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Unauthorized'));

      const { result } = renderHook(() => useApiKeys(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe('useApiKey', () => {
    it('should fetch a single API key when id is provided', async () => {
      const mockResponse = {
        success: true,
        data: { id: 'key-1', name: 'My API Key' },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useApiKey('key-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/api-keys/key-1');
      expect(result.current.data).toEqual(mockResponse.data);
    });

    it('should be disabled when id is null', () => {
      const { result } = renderHook(() => useApiKey(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe('idle');
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });

  describe('useCreateApiKey', () => {
    it('should call POST to create API key', async () => {
      const mockResponse = {
        success: true,
        data: { id: 'key-1', plainTextKey: 'lbt_xxxx' },
      };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useCreateApiKey(), {
        wrapper: createWrapper(),
      });

      const input = { name: 'New Key', scopes: ['read'] };

      await act(async () => {
        await result.current.mutateAsync(input as never);
      });

      expect(apiClient.post).toHaveBeenCalledWith('/api-keys', input);
    });

    it('should handle mutation errors', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Limit reached'));

      const { result } = renderHook(() => useCreateApiKey(), {
        wrapper: createWrapper(),
      });

      await expect(
        act(async () => {
          await result.current.mutateAsync({ name: 'Key' } as never);
        }),
      ).rejects.toThrow('Limit reached');
    });
  });

  describe('useUpdateApiKey', () => {
    it('should call PATCH to update API key', async () => {
      const mockResponse = {
        success: true,
        data: { id: 'key-1', name: 'Updated Key' },
      };
      vi.mocked(apiClient.patch).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useUpdateApiKey(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          id: 'key-1',
          data: { name: 'Updated Key' } as never,
        });
      });

      expect(apiClient.patch).toHaveBeenCalledWith('/api-keys/key-1', { name: 'Updated Key' });
    });
  });

  describe('useDeleteApiKey', () => {
    it('should call DELETE on the API key endpoint', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ success: true });

      const { result } = renderHook(() => useDeleteApiKey(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync('key-1');
      });

      expect(apiClient.delete).toHaveBeenCalledWith('/api-keys/key-1');
    });
  });
});
