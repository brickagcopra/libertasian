import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { SubscriptionDetail } from '../types';

/**
 * Tier ordering for the client-side entitlement gate. Module-private and NOT
 * exported: these codes are gate inputs, never display strings. Exporting
 * them is how "Pro" reached the UI and drew App Review 2.1(b) — the app names
 * no purchasable tier anywhere a user can see.
 */
export type { SubscriptionDetail };

export const subscriptionKeys = {
  all: ['billing'] as const,
  subscription: ['billing', 'subscription'] as const,
};

export function useSubscription(enabled = true) {
  return useQuery({
    queryKey: subscriptionKeys.subscription,
    // apiClient strips the { success, data } envelope at the transport
    // layer, so the resolved value IS the SubscriptionDetail. The previous
    // `select: (res) => res.data` drilled one level too deep and made
    // `data` resolve to undefined for every consumer.
    queryFn: () => apiClient.get<SubscriptionDetail>('/billing/subscription'),
    enabled,
    staleTime: 5 * 60 * 1000,
    // A 404 (no active subscription) is deterministic — retrying only delays
    // an answer the caller already has.
    retry: false,
  });
}

// meetsMinimumTier() and useCanGenerateDigest() lived here. Both compared the
// org's planCode against a required tier and both are gone: the server is the
// only authority on what an account can reach, and a client-side copy of that
// decision is what kept screens locked after the API stopped locking them.
