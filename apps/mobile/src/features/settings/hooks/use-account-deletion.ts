import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { DeleteAccountRequest, DeleteAccountResult } from '../types';

/**
 * Request deletion of the signed-in account.
 *
 * The API deactivates immediately, revokes every refresh-token family and
 * emails a single-use restore link valid for the full 30-day window. It
 * answers 401 for a wrong password or a mismatched email echo — a domain
 * answer, not an expired session — so `skipSignOutOn401` keeps the client from
 * tearing down local auth on it.
 *
 * A 409 means the caller is the sole owner of an org other people still work
 * in; the server message names them and is the actionable text to show.
 */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: (data: DeleteAccountRequest) =>
      apiClient.delete<DeleteAccountResult>('/users/me', data, {
        skipSignOutOn401: true,
      }),
  });
}
