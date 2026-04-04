'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  CheckoutResponse,
  CreateCheckoutInput,
  CancelSubscriptionInput,
  PaymentMethodListResponse,
  PaymentMethodDetail,
  InvoiceListResponse,
  InvoiceDetail,
  InvoiceDetailResponse,
  CheckoutPreviewInput,
  CheckoutPreviewResponse,
  ValidateCouponInput,
  ValidateCouponResponse,
  EligiblePromotionsInput,
  EligiblePromotionsResponse,
} from '../types';

// ─── Checkout Preview ─────────────────────────────────────

export function useCheckoutPreview() {
  return useMutation({
    mutationFn: async (input: CheckoutPreviewInput) => {
      const res = await apiClient.post<CheckoutPreviewResponse>(
        '/billing/checkout/preview',
        input,
      );
      return res.data;
    },
  });
}

// ─── Coupon Validation ────────────────────────────────────

export function useValidateCoupon() {
  return useMutation({
    mutationFn: async (input: ValidateCouponInput) => {
      const res = await apiClient.post<ValidateCouponResponse>(
        '/coupons/validate',
        input,
      );
      return res.data;
    },
  });
}

// ─── Eligible Promotions ──────────────────────────────────

export function useEligiblePromotions() {
  return useMutation({
    mutationFn: async (input: EligiblePromotionsInput) => {
      const res = await apiClient.post<EligiblePromotionsResponse>(
        '/promotions/eligible',
        input,
      );
      return res.data;
    },
  });
}

// ─── Checkout ──────────────────────────────────────────────

export function useCreateCheckout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateCheckoutInput) => {
      const res = await apiClient.post<CheckoutResponse>('/billing/checkout', input);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing'] });
    },
  });
}

// ─── Cancel Subscription ───────────────────────────────────

export function useCancelSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input?: CancelSubscriptionInput) => {
      await apiClient.post('/billing/cancel', input ?? { cancelAtPeriodEnd: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing'] });
    },
  });
}

// ─── Payment Methods ───────────────────────────────────────

export function usePaymentMethods() {
  return useQuery({
    queryKey: ['billing', 'payment-methods'],
    queryFn: async () => {
      const res = await apiClient.get<PaymentMethodListResponse>('/billing/payment-methods');
      return res.data;
    },
  });
}

export function useSetDefaultPaymentMethod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (paymentMethodId: string) => {
      await apiClient.patch<{ success: boolean; data: PaymentMethodDetail }>(
        `/billing/payment-methods/${paymentMethodId}/default`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'payment-methods'] });
    },
  });
}

export function useDeletePaymentMethod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (paymentMethodId: string) => {
      await apiClient.delete(`/billing/payment-methods/${paymentMethodId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'payment-methods'] });
    },
  });
}

// ─── Invoices ──────────────────────────────────────────────

export function useInvoices(cursor?: string, limit = 20) {
  return useQuery({
    queryKey: ['billing', 'invoices', { cursor, limit }],
    queryFn: async () => {
      const params: Record<string, string> = { limit: String(limit) };
      if (cursor) params['cursor'] = cursor;
      const res = await apiClient.get<InvoiceListResponse>('/billing/invoices', { params });
      return res;
    },
  });
}

export function useInvoice(invoiceId: string) {
  return useQuery({
    queryKey: ['billing', 'invoices', invoiceId],
    queryFn: async () => {
      const res = await apiClient.get<InvoiceDetailResponse>(`/billing/invoices/${invoiceId}`);
      return res.data;
    },
    enabled: !!invoiceId,
  });
}

// Re-export types for convenience
export type { PaymentMethodDetail, InvoiceDetail, CheckoutPreviewInput, ValidateCouponInput, EligiblePromotionsInput };
