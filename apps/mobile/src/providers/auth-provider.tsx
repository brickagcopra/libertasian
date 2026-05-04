import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { authStorage } from '../storage/auth-storage';
import { apiClient } from '../lib/api-client';
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

  const signOut = useCallback(async () => {
    try {
      const refreshToken = await authStorage.getRefreshToken();
      if (refreshToken) {
        await apiClient.post('/auth/logout', { refreshToken }).catch(() => {
          // Ignore logout API errors — clear local state regardless
        });
      }
    } finally {
      await authStorage.clearTokens();
      setUser(null);
    }
  }, []);

  const signIn = useCallback(
    async (accessToken: string, refreshToken: string, authUser: AuthUser) => {
      await authStorage.setAccessToken(accessToken);
      await authStorage.setRefreshToken(refreshToken);
      setUser(authUser);
    },
    [],
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
