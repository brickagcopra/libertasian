'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const SESSION_COOKIE = 'libertasian-session';

/** Set a lightweight cookie so Edge middleware can gate protected routes. */
function setSessionCookie() {
  document.cookie = `${SESSION_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
}

/** Clear the session cookie on logout. */
function clearSessionCookie() {
  document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  organizationId: string;
  mfaEnabled: boolean;
  emailVerified: boolean;
  onboardingCompletedAt: string | null;
  userRole: string | null;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  isAuthenticated: boolean;

  setTokens: (accessToken: string, refreshToken: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,

      setTokens: (accessToken: string, refreshToken: string) => {
        setSessionCookie();
        set({ accessToken, refreshToken, isAuthenticated: true });
      },

      setUser: (user: User) => set({ user }),

      logout: () => {
        clearSessionCookie();
        set({
          accessToken: null,
          refreshToken: null,
          user: null,
          isAuthenticated: false,
        });
      },
    }),
    {
      name: 'libertasian-auth',
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrate: (_state) => {
        return (rehydratedState) => {
          // Sync cookie with rehydrated auth state
          if (rehydratedState?.isAuthenticated) {
            setSessionCookie();
          } else {
            clearSessionCookie();
          }
        };
      },
    },
  ),
);
