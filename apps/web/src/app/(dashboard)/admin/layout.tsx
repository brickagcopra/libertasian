'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { canAccessAdminArea } from '@/components/layout/admin-nav';
import { useMyPermissions } from '@/features/settings/hooks/use-rbac';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Admit anyone who can see at least one admin surface.
 *
 * This used to redirect everyone without `isPlatformAdmin` to /search. That is
 * a single all-or-nothing flag derived from holding ANY `admin:*` code, so the
 * `reviewer` role — which holds `digests:review` and no `admin:*` at all —
 * could not open the review queue it exists to work. The fix is NOT to grant
 * reviewer an `admin:*` code: subscription.guard.ts treats
 * `isPlatformAdmin === true` as a complete subscription bypass, so that would
 * silently hand out unlimited paid access.
 *
 * Instead the gate is the nav: canAccessAdminArea is computed from the same
 * per-entry permission list the sidebar renders, so "the sidebar shows you
 * something" and "you may enter" are one answer and cannot drift.
 *
 * This hides; it does not protect. Every admin endpoint behind this layout
 * keeps its own server-side guard, and that guard is the real control (P3).
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const isAuthReady = useAuthStore((s) => s.isAuthReady);
  const { data: me, isLoading, isError } = useMyPermissions();

  // Wait for the permission fetch before deciding — redirecting on a pending
  // query bounces legitimate staff to /search on every hard refresh. An
  // ERRORED query is decided on, not waited on, or a failing request leaves
  // the page blank forever.
  const resolved = isAuthReady && !isLoading;
  const allowed = canAccessAdminArea(me?.platformPermissions);

  useEffect(() => {
    if (resolved && !allowed) router.replace('/search');
  }, [resolved, allowed, router]);

  // Fail closed: render nothing until access is confirmed.
  if (!resolved || isError || !allowed) return null;

  return <>{children}</>;
}
