export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface MfaEnrollResult {
  secret: string;
  otpauthUrl: string;
}

/**
 * Body for `DELETE /users/me`. Exactly one credential is required and which
 * one depends on the account: password accounts send `password`, social-only
 * accounts (Google/Apple, `hasPassword: false`) echo their `email` — there is
 * no hash on those rows to compare against.
 */
export interface DeleteAccountRequest {
  confirm: 'DELETE';
  password?: string;
  email?: string;
}

export interface DeleteAccountResult {
  status: 'pending_deletion';
  deletionRequestedAt: string;
  /** When the account and its private content are permanently purged. */
  scheduledPurgeAt: string;
  restoreWindowDays: number;
}
