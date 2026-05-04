import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  CreateCheckoutInput,
  CancelSubscriptionInput,
  PaymentMethodDetail,
  InvoiceDetail,
  CheckoutPreviewInput,
  CheckoutPreviewData,
  ValidateCouponInput,
  CouponValidationResult,
  EligiblePromotionsInput,
  PromotionEligibilityResult,
} from '../types';

interface CheckoutData {
  checkoutUrl: string;
  checkoutSessionId: string;
  paymentId: string;
}

// ─── Checkout Preview ─────────────────────────────────────

export function useCheckoutPreview() {
  return useMutation({
    mutationFn: (input: CheckoutPreviewInput) =>
      apiClient.post<CheckoutPreviewData>('/billing/checkout/preview', input),
  });
}

// ─── Coupon Validation ────────────────────────────────────

export function useValidateCoupon() {
  return useMutation({
    mutationFn: (input: ValidateCouponInput) =>
      apiClient.post<CouponValidationResult>('/coupons/validate', input),
  });
}

// ─── Eligible Promotions ──────────────────────────────────

export function useEligiblePromotions() {
  return useMutation({
    mutationFn: (input: EligiblePromotionsInput) =>
      apiClient.post<PromotionEligibilityResult[]>('/promotions/eligible', input),
  });
}

// ─── Checkout ──────────────────────────────────────────────

export function useCreateCheckout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateCheckoutInput) =>
      apiClient.post<CheckoutData>('/billing/checkout', input),
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
    queryFn: () => apiClient.get<PaymentMethodDetail[]>('/billing/payment-methods'),
  });
}

export function useSetDefaultPaymentMethod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (paymentMethodId: string) =>
      apiClient.patch<PaymentMethodDetail>(
        `/billing/payment-methods/${paymentMethodId}/default`,
      ),
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
    queryFn: () => {
      const params: Record<string, string> = { limit: String(limit) };
      if (cursor) params['cursor'] = cursor;
      return apiClient.get<InvoiceDetail[]>('/billing/invoices', { params });
    },
  });
}

export function useInvoice(invoiceId: string) {
  return useQuery({
    queryKey: ['billing', 'invoices', invoiceId],
    queryFn: () => apiClient.get<InvoiceDetail>(`/billing/invoices/${invoiceId}`),
    enabled: !!invoiceId,
  });
}

// Re-export types for convenience
export type {
  PaymentMethodDetail,
  InvoiceDetail,
  CheckoutPreviewInput,
  ValidateCouponInput,
  EligiblePromotionsInput,
};
