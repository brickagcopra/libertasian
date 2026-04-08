'use client';

import { useEffect } from 'react';

import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Wires the apiClient singleton to the Zustand auth store so that
 * every request automatically includes the Bearer token and
 * 401 responses trigger logout.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    apiClient.configure({
      getAccessToken: () => useAuthStore.getState().accessToken,
      onUnauthorized: () => {
        useAuthStore.getState().logout();
        // Don't redirect if already on login/auth pages to prevent loops
        if (!window.location.pathname.startsWith('/login') &&
            !window.location.pathname.startsWith('/register')) {
          window.location.href = '/login';
        }
      },
    });
  }, [logout]);

  return <>{children}</>;
}
