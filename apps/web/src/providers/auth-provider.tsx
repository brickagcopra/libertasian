'use client';

import { useEffect } from 'react';

import { apiClient } from '@/lib/api-client';
import { useAuthStore, type User } from '@/stores/auth-store';

/**
 * Proactively refresh the in-memory access token shortly before its 15-min
 * TTL (JWT_ACCESS_TTL=900). Firing at ~13 min keeps a valid token in memory
 * so navigation after idle browsing doesn't hit a 401 → /login bounce.
 */
const PROACTIVE_REFRESH_INTERVAL_MS = 13 * 60 * 1000;

/**
 * Wires the apiClient singleton to the Zustand auth store so that
 * every request automatically includes the Bearer token, 401 responses
 * trigger a silent refresh via httpOnly cookie, and hard failures trigger logout.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const logout = useAuthStore((s) => s.logout);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

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
    // AuthGate blocks dashboard children until isAuthReady is set, preventing
    // layout-level query hooks from firing unauthenticated 401s on reload.
    let cancelled = false;
    const bootstrap = async () => {
      const state = useAuthStore.getState();
      if (state.isAuthenticated && !state.accessToken) {
        try {
          const token = await apiClient.refresh();
          if (!token && !cancelled) {
            // Cookie expired or invalid — clear local state
            useAuthStore.getState().logout();
          } else if (token && !cancelled && !useAuthStore.getState().user) {
            // Refresh succeeded but persisted user slice is empty (e.g. Google-OAuth-only
            // user whose callback ran before this field was populated). Hydrate it now.
            try {
              const res = await apiClient.get<{ success: boolean; data: User }>('/users/me');
              if (!cancelled) {
                useAuthStore.getState().setUser(res.data);
              }
            } catch {
              // Leave isAuthReady to flip true; downstream guards handle the missing user.
            }
          }
        } catch {
          // Network error — don't force logout, they might be offline
        }
      }
      if (!cancelled) {
        useAuthStore.getState().setAuthReady(true);
      }
    };
    bootstrap();
    return () => { cancelled = true; };
  }, [logout]);

  // Proactive silent-refresh timer. Uses the SAME single-flight refresh path
  // as the 401 interceptor (apiClient.refresh). Cleared on unmount, on logout,
  // and whenever isAuthenticated becomes false.
  useEffect(() => {
    if (!isAuthenticated) return;
    const id = setInterval(() => {
      const run = () =>
        apiClient.refresh().catch(() => {
          // Intentional no-op: a failed proactive refresh is benign (e.g. an
          // offline tab). Genuine expiry is handled by the reactive 401 →
          // onUnauthorized flow in api-client; we don't surface it or force logout.
        });
      // Serialize across tabs: only one tab proactively refreshes per tick. A
      // tab that can't acquire the lock skips — its reactive 401 path still
      // covers genuine expiry. This avoids two tabs presenting the same refresh
      // token concurrently, which the API treats as reuse and revokes the whole
      // session family. Older browsers without the API just run it.
      if (typeof navigator !== 'undefined' && navigator.locks?.request) {
        void navigator.locks.request(
          'libertasian-proactive-refresh',
          { ifAvailable: true },
          (lock) => {
            if (!lock) return; // another tab holds it → skip this tick
            return run();
          },
        );
      } else {
        void run();
      }
    }, PROACTIVE_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isAuthenticated]);

  return <>{children}</>;
}
