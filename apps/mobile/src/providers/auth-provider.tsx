import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authStorage } from '../storage/auth-storage';
import { clearAccountScopedStorage } from '../storage/mmkv';
import { apiClient } from '../lib/api-client';
import { unregisterPushToken } from '../lib/push-notifications';
import type { AuthUser } from '../features/auth/types';

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: (accessToken: string, refreshToken: string, user: AuthUser) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: AuthUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // AuthProvider is mounted inside QueryClientProvider in `app/_layout.tsx`,
  // so this always resolves. Any test that renders AuthProvider must supply a
  // QueryClientProvider too.
  const queryClient = useQueryClient();

  const signOut = useCallback(async () => {
    try {
      // Unregister the device push token BEFORE clearing auth storage — the
      // DELETE needs a valid Bearer token. Best-effort (never throws).
      await unregisterPushToken();

      const refreshToken = await authStorage.getRefreshToken();
      if (refreshToken) {
        await apiClient.post('/auth/logout', { refreshToken }).catch(() => {
          // Ignore logout API errors — clear local state regardless
        });
      }
    } finally {
      // Order matters. Tokens and per-account device state go first, then the
      // user, then the React Query cache. Clearing the cache before
      // `setUser(null)` would make still-mounted queries refetch with no token
      // and 401 on the way out.
      await authStorage.clearTokens();
      clearAccountScopedStorage();
      setUser(null);
      queryClient.clear();
    }
  }, [queryClient]);

  const signIn = useCallback(
    async (accessToken: string, refreshToken: string, authUser: AuthUser) => {
      // Clear FIRST, before the new session exists. A sign-in that follows a
      // sign-out on the same launch would otherwise answer `['profile']` from
      // the previous account's cached `/users/me` (it is fresh for 5 minutes),
      // and `app/settings/index.tsx` prefers that cached profile over the
      // context user. Clearing afterwards would instead throw away anything the
      // new session had already fetched.
      clearAccountScopedStorage();
      queryClient.clear();
      await authStorage.setAccessToken(accessToken);
      await authStorage.setRefreshToken(refreshToken);
      setUser(authUser);
    },
    [queryClient],
  );

  // Wire the API client's 401 handler to trigger sign out
  useEffect(() => {
    apiClient.setOnUnauthorized(() => {
      authStorage.clearTokens().then(() => setUser(null));
    });
  }, []);

  // Check for existing auth on mount
  useEffect(() => {
    async function checkAuth() {
      try {
        const accessToken = await authStorage.getAccessToken();
        if (!accessToken) {
          setIsLoading(false);
          return;
        }

        // Validate token by fetching profile
        const profile = await apiClient.get<AuthUser>('/users/me');
        setUser(profile);
      } catch {
        // Token invalid or expired — clear stored tokens
        await authStorage.clearTokens();
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    }

    checkAuth();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      signIn,
      signOut,
      setUser,
    }),
    [user, isLoading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
