import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { PaymentMethodDetail, InvoiceDetail } from '../types';

/**
 * Billing hooks the mobile app still needs — all of them READ-ONLY.
 *
 * The checkout, checkout-preview, coupon-validation and promotion-eligibility
 * hooks were removed: Apple Guideline 3.1.1 and Google Play's Payments policy
 * forbid selling digital content outside the store, and nothing in the app
 * may price, sell, or link to an external purchase. `useCancelSubscription`
 * went with the subscription screen for App Review 2.1(b): managing a
 * subscription in-app implies one is sold in-app. The API endpoints
 * themselves are untouched — the web app still uses them.
 */

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
export type { PaymentMethodDetail, InvoiceDetail };
