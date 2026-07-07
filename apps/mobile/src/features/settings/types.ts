export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface MfaEnrollResult {
  secret: string;
  otpauthUrl: string;
}
