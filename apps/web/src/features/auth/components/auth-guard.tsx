'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ROUTES } from '@/lib/constants';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Wraps dashboard routes. Redirects to login if not authenticated.
 * Redirects to onboarding if onboarding is not completed.
 * Shows nothing during the hydration check to avoid flash of content.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Wait for Zustand persist to hydrate from localStorage
    const unsub = useAuthStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
    // If already hydrated (fast path)
    if (useAuthStore.persist.hasHydrated()) {
      setHydrated(true);
    }
    return () => { unsub(); };
  }, []);

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.replace(ROUTES.LOGIN);
    }
  }, [hydrated, isAuthenticated, router]);

  useEffect(() => {
    if (hydrated && isAuthenticated && user && !user.onboardingCompletedAt) {
      if (pathname !== ROUTES.ONBOARDING) {
        router.replace(ROUTES.ONBOARDING);
      }
    }
  }, [hydrated, isAuthenticated, user, pathname, router]);

  if (!hydrated || !isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-800" />
      </div>
    );
  }

  return <>{children}</>;
}
