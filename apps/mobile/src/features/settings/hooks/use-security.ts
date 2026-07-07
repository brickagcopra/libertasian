import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { ChangePasswordRequest, MfaEnrollResult } from '../types';

/**
 * Change the account password. The API revokes ALL refresh tokens on success,
 * so callers must sign the user out and route to login afterwards.
 *
 * 401 here means "current password is incorrect" — `skipSignOutOn401` keeps
 * the api client from nuking the local session on that domain-level 401.
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: (data: ChangePasswordRequest) =>
      apiClient.post<{ message?: string }>('/auth/change-password', data, {
        skipSignOutOn401: true,
      }),
  });
}

/** Start MFA enrollment. Returns the TOTP secret + otpauth:// URL. 400 if already enabled. */
export function useEnrollMfa() {
  return useMutation({
    mutationFn: () => apiClient.post<MfaEnrollResult>('/auth/mfa/enroll'),
  });
}

/**
 * Confirm enrollment with a 6-digit TOTP code. 401 means "invalid code"
 * (domain answer, not an expired session).
 */
export function useConfirmMfa() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (code: string) =>
      apiClient.post('/auth/mfa/verify', { code }, { skipSignOutOn401: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

/**
 * Disable MFA. Password is required by the API; 401 means "invalid password"
 * (domain answer, not an expired session).
 */
export function useDisableMfa() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (password: string) =>
      apiClient.post('/auth/mfa/disable', { password }, { skipSignOutOn401: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
