'use client';

import { useEffect } from 'react';

import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Wires the apiClient singleton to the Zustand auth store so that
 * every request automatically includes the Bearer token, 401 responses
 * trigger a silent refresh via httpOnly cookie, and hard failures trigger logout.
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
      refreshAccessToken: async () => {
        try {
          // Call refresh endpoint — httpOnly cookie is sent automatically
          const res = await fetch(
            `${process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001/api/v1'}/auth/refresh`,
            {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
            },
          );
          if (!res.ok) return null;
          const body = (await res.json()) as { success: boolean; data: { accessToken: string } };
          if (body.success && body.data.accessToken) {
            useAuthStore.getState().setAccessToken(body.data.accessToken);
            return body.data.accessToken;
          }
          return null;
        } catch {
          return null;
        }
      },
    });

    // On mount, if we have a persisted session but no accessToken (page reload),
    // try a silent refresh to restore the access token from the httpOnly cookie.
    // Uses apiClient.refresh() which shares the same single-flight guard as the
    // 401 interceptor, preventing duplicate /auth/refresh calls on page load.
    const state = useAuthStore.getState();
    if (state.isAuthenticated && !state.accessToken) {
      apiClient.refresh().then((token) => {
        if (!token) {
          // Cookie expired or invalid — clear local state
          useAuthStore.getState().logout();
        }
      }).catch(() => {
        // Network error — don't force logout, they might be offline
      });
    }
  }, [logout]);

  return <>{children}</>;
}
