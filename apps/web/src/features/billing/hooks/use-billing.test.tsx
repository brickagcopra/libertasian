import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import {
  useCreateCheckout,
  useCancelSubscription,
  usePaymentMethods,
  useSetDefaultPaymentMethod,
  useDeletePaymentMethod,
  useInvoices,
  useInvoice,
} from './use-billing';
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

describe('use-billing hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useCreateCheckout', () => {
    it('should call POST to create checkout session', async () => {
      const mockResponse = {
        success: true,
        data: { checkoutUrl: 'https://pay.example.com/checkout/123' },
      };
      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useCreateCheckout(), {
        wrapper: createWrapper(),
      });

      const input = { planId: 'pro', billingInterval: 'monthly' };

      await act(async () => {
        const data = await result.current.mutateAsync(input as never);
        expect(data).toEqual(mockResponse.data);
      });

      expect(apiClient.post).toHaveBeenCalledWith('/billing/checkout', input);
    });

    it('should handle mutation errors', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Payment failed'));

      const { result } = renderHook(() => useCreateCheckout(), {
        wrapper: createWrapper(),
      });

      await expect(
        act(async () => {
          await result.current.mutateAsync({ planId: 'pro' } as never);
        }),
      ).rejects.toThrow('Payment failed');
    });
  });

  describe('useCancelSubscription', () => {
    it('should call POST to cancel subscription with default params', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(undefined);

      const { result } = renderHook(() => useCancelSubscription(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync(undefined);
      });

      expect(apiClient.post).toHaveBeenCalledWith('/billing/cancel', {
        cancelAtPeriodEnd: true,
      });
    });

    it('should call POST with custom cancellation params', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(undefined);

      const { result } = renderHook(() => useCancelSubscription(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({ cancelAtPeriodEnd: false } as never);
      });

      expect(apiClient.post).toHaveBeenCalledWith('/billing/cancel', {
        cancelAtPeriodEnd: false,
      });
    });
  });

  describe('usePaymentMethods', () => {
    it('should fetch payment methods', async () => {
      const mockResponse = {
        success: true,
        data: [{ id: 'pm-1', type: 'card', last4: '4242' }],
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => usePaymentMethods(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/billing/payment-methods');
      expect(result.current.data).toEqual(mockResponse.data);
    });

    it('should handle API errors', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Unauthorized'));

      const { result } = renderHook(() => usePaymentMethods(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe('useSetDefaultPaymentMethod', () => {
    it('should call PATCH to set default payment method', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue(undefined);

      const { result } = renderHook(() => useSetDefaultPaymentMethod(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync('pm-1');
      });

      expect(apiClient.patch).toHaveBeenCalledWith('/billing/payment-methods/pm-1/default');
    });
  });

  describe('useDeletePaymentMethod', () => {
    it('should call DELETE on the payment method endpoint', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue(undefined);

      const { result } = renderHook(() => useDeletePaymentMethod(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync('pm-1');
      });

      expect(apiClient.delete).toHaveBeenCalledWith('/billing/payment-methods/pm-1');
    });
  });

  describe('useInvoices', () => {
    it('should fetch invoices with default params', async () => {
      const mockResponse = {
        success: true,
        data: [],
        meta: { hasNext: false, cursor: null },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useInvoices(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/billing/invoices', {
        params: { limit: '20' },
      });
    });

    it('should pass cursor param when provided', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ success: true, data: [] });

      const { result } = renderHook(() => useInvoices('cursor-1', 10), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiClient.get).toHaveBeenCalledWith('/billing/invoices', {
        params: { limit: '10', cursor: 'cursor-1' },
      });
    });
  });

  describe('useInvoice', () => {
    it('should fetch a single invoice when id is provided', async () => {
      const mockResponse = {
        success: true,
        data: { id: 'inv-1', amount: 1000, status: 'paid' },
      };
      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useInvoice('inv-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiClient.get).toHaveBeenCalledWith('/billing/invoices/inv-1');
      expect(result.current.data).toEqual(mockResponse.data);
    });

    it('should be disabled when invoiceId is empty string', () => {
      const { result } = renderHook(() => useInvoice(''), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe('idle');
      expect(apiClient.get).not.toHaveBeenCalled();
    });
  });
});
