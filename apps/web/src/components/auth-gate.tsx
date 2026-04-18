'use client';

import { ReactNode } from 'react';

import { useAuthStore } from '@/stores/auth-store';

interface AuthGateProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Blocks children from rendering until the auth bootstrap has completed
 * (i.e. the proactive silent refresh on page reload). This prevents
 * layout-level query hooks from firing before a valid access token exists,
 * eliminating the 401 console noise on reload.
 */
export function AuthGate({ children, fallback = null }: AuthGateProps) {
  const isAuthReady = useAuthStore((s) => s.isAuthReady);

  if (!isAuthReady) return <>{fallback}</>;
  return <>{children}</>;
}
