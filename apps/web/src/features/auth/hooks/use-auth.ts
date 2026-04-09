'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { apiClient, ApiClientError } from '@/lib/api-client';
import { ROUTES } from '@/lib/constants';
import { useAuthStore } from '@/stores/auth-store';

interface AuthUser {
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

interface LoginResponse {
  success: boolean;
  data: {
    tokens: { accessToken: string };
    user: AuthUser;
    mfaRequired: boolean;
  };
}

interface RegisterResponse {
  success: boolean;
  data: {
    user: AuthUser;
    verifyEmail: string;
  };
}

interface RefreshResponse {
  success: boolean;
  data: {
    accessToken: string;
  };
}

export function useLogin() {
  const { setAccessToken, setUser } = useAuthStore();

  return useMutation({
    mutationFn: async (data: { email: string; password: string; mfaCode?: string }) => {
      const res = await apiClient.post<LoginResponse>('/auth/login', data);
      return res.data;
    },
    onSuccess: (data) => {
      if (!data.mfaRequired) {
        setAccessToken(data.tokens.accessToken);
        setUser(data.user);
      }
    },
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: async (data: { email: string; password: string; fullName: string }) => {
      const res = await apiClient.post<RegisterResponse>('/auth/register', data);
      return res.data;
    },
  });
}

export function useLogout() {
  const { logout } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      try {
        // Server reads refresh token from httpOnly cookie
        await apiClient.post('/auth/logout');
      } catch {
        // Logout locally even if server call fails
      }
    },
    onSettled: () => {
      logout();
      queryClient.clear();
      window.location.href = ROUTES.LOGIN;
    },
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: async (data: { email: string }) => {
      const res = await apiClient.post<{ success: boolean }>('/auth/forgot-password', data);
      return res;
    },
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: async (data: { token: string; newPassword: string }) => {
      const res = await apiClient.post<{ success: boolean }>('/auth/reset-password', data);
      return res;
    },
  });
}

export function useVerifyEmail() {
  return useMutation({
    mutationFn: async (data: { email: string; code: string }) => {
      const res = await apiClient.post<{ success: boolean }>('/auth/verify-email', data);
      return res;
    },
  });
}

export function useResendVerification() {
  return useMutation({
    mutationFn: async (data: { email: string }) => {
      const res = await apiClient.post<{ success: boolean }>('/auth/resend-verification', data);
      return res;
    },
  });
}

export function useRefreshToken() {
  const { setAccessToken, logout } = useAuthStore();

  return useCallback(async () => {
    try {
      // Refresh token is sent automatically via httpOnly cookie
      const res = await apiClient.post<RefreshResponse>('/auth/refresh');
      setAccessToken(res.data.accessToken);
      return true;
    } catch (error) {
      if (error instanceof ApiClientError && error.statusCode === 401) {
        logout();
      }
      return false;
    }
  }, [setAccessToken, logout]);
}
