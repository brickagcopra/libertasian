'use client';

import { useSubscription } from '@/features/billing/hooks/use-subscription';
import { useAuthStore } from '@/stores/auth-store';

/**
 * The reason a user can or cannot access a paid feature.
 *
 * - `admin`   — Platform admin (any `admin:*` permission). Always bypasses
 *               the paywall. Returned BEFORE the subscription query resolves
 *               so the UI can render content immediately without flashing
 *               an upsell.
 * - `paid`    — Org has an active or trialing non-free subscription.
 * - `free`    — Org is on the free plan or has a non-active subscription.
 * - `loading` — Subscription query is still in flight (non-admin caller).
 */
export type CanAccessReason = 'admin' | 'paid' | 'free' | 'loading';

export interface CanAccessResult {
  canAccess: boolean;
  reason: CanAccessReason;
}

/**
 * Single source of truth for paywall gating on the web frontend.
 *
 * Every paywall surface — bar-exams answers, the upgrade banner, derivative
 * gated notices, usage-page upgrade CTAs, sidebar tier locks — must consult
 * this hook rather than computing access from `subscription.planCode` alone.
 *
 * Platform admins (resolved server-side from RBAC `admin:*` permissions and
 * exposed via /users/me, /auth/login, /auth/register) bypass the paywall
 * unconditionally — they are never on a paying subscription themselves, but
 * the API already grants them full corpus reads (PR #160). Without this
 * hook the frontend would still render upsells they cannot dismiss.
 *
 * Fail-closed: when `user.isPlatformAdmin` is absent (older cached state),
 * undefined is falsy and the hook falls through to the subscription check.
 */
export function useCanAccessPaidFeature(): CanAccessResult {
  const user = useAuthStore((s) => s.user);
  const { data: sub, isLoading } = useSubscription();

  if (user?.isPlatformAdmin) {
    return { canAccess: true, reason: 'admin' };
  }

  if (isLoading) {
    return { canAccess: false, reason: 'loading' };
  }

  const paid =
    !!sub &&
    sub.planCode !== 'free' &&
    (sub.status === 'active' || sub.status === 'trialing');

  return { canAccess: paid, reason: paid ? 'paid' : 'free' };
}
