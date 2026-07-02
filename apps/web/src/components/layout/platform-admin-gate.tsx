'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useAuthStore } from '@/stores/auth-store';

/** Renders children only for platform admins; redirects everyone else.
 *  Fail-closed until auth is confirmed. Same signal as the /admin guard. */
export function PlatformAdminGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isAuthReady = useAuthStore((s) => s.isAuthReady);
  const isAdmin = user?.isPlatformAdmin === true;

  useEffect(() => {
    if (isAuthReady && !isAdmin) router.replace('/search');
  }, [isAuthReady, isAdmin, router]);

  if (!isAuthReady || !isAdmin) return null;

  return <>{children}</>;
}
