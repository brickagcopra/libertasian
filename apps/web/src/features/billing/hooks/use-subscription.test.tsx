import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useSubscription, meetsMinimumTier } from './use-subscription';
import { apiClient, ApiClientError } from '@/lib/api-client';

vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return {
    ...actual,
    apiClient: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      download: vi.fn(),
    },
  };
});

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

describe('use-subscription hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useSubscription', () => {
    it('should fetch subscription data', async () => {
      const mockResponse = {
        success: true,
        data: {
          id: 'sub-1',
          plan: 'pro',
          status: 'active',
          currentPeriodEnd: '2026-04-22T00:00:00Z',
        },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/billing/subscription');
      expect(result.current.data).toEqual(mockResponse.data);
    });

    it('should handle API errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Unauthorized'));

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
    });

    it('should return null on 404 (no subscription)', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        new ApiClientError('Not found', 404),
      );

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBeNull();
    });

    it('should throw on non-404 errors (e.g. 500)', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(
        new ApiClientError('Internal server error', 500),
      );

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.data).toBeUndefined();
    });
  });

  describe('meetsMinimumTier', () => {
    it('should return true when current plan meets minimum tier', () => {
      expect(meetsMinimumTier('pro', 'free')).toBe(true);
      expect(meetsMinimumTier('pro', 'edu')).toBe(true);
      expect(meetsMinimumTier('pro', 'pro')).toBe(true);
    });

    it('should return false when current plan is below minimum tier', () => {
      expect(meetsMinimumTier('free', 'pro')).toBe(false);
      expect(meetsMinimumTier('edu', 'team')).toBe(false);
    });

    it('should return false when currentPlan is undefined', () => {
      expect(meetsMinimumTier(undefined, 'free')).toBe(false);
    });

    it('should return false for unknown plan names', () => {
      expect(meetsMinimumTier('unknown', 'pro')).toBe(false);
      expect(meetsMinimumTier('pro', 'unknown')).toBe(false);
    });

    it('should handle enterprise tier correctly', () => {
      expect(meetsMinimumTier('enterprise', 'free')).toBe(true);
      expect(meetsMinimumTier('enterprise', 'enterprise')).toBe(true);
      expect(meetsMinimumTier('team', 'enterprise')).toBe(false);
    });
  });
});
