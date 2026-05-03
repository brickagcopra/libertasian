import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  RegisterResponse,
  UserProfile,
} from '../types';

export function useLogin() {
  return useMutation({
    mutationFn: (data: LoginRequest) =>
      apiClient.post<AuthResponse>('/auth/login', data, { skipAuth: true }),
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: (data: RegisterRequest) =>
      apiClient.post<RegisterResponse>('/auth/register', data, { skipAuth: true }),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (refreshToken: string) =>
      apiClient.post('/auth/logout', { refreshToken }),
    onSettled: () => {
      queryClient.clear();
    },
  });
}

export function useProfile(enabled = true) {
  return useQuery({
    queryKey: ['profile'],
    queryFn: () => apiClient.get<UserProfile>('/users/me'),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (data: { email: string }) =>
      apiClient.post('/auth/forgot-password', data, { skipAuth: true }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (data: { token: string; newPassword: string }) =>
      apiClient.post('/auth/reset-password', data, { skipAuth: true }),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { fullName?: string; phone?: string }) =>
      apiClient.patch<UserProfile>('/users/me', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
