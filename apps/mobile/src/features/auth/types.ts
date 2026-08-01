export type OrganizationRole = 'owner' | 'admin' | 'editor' | 'member' | 'reviewer' | 'student';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  onboardingCompletedAt: string | null;
  userRole: string | null;
  organizationRole: OrganizationRole | null;
  organizationId: string | null;
  createdAt: string;
  /**
   * Whether the account has a password set. False for social-only (Google/
   * Apple) accounts, which prove ownership by echoing their email instead.
   */
  hasPassword?: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
  mfaCode?: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  fullName: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: AuthUser;
  tokens: AuthTokens;
  mfaRequired: boolean;
}

export interface RegisterResponse {
  user: AuthUser;
  verifyEmail: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  onboardingCompletedAt: string | null;
  userRole: string | null;
  organizationRole: OrganizationRole | null;
  organizationId: string | null;
  createdAt: string;
  /**
   * Whether the account has a password set. False for social-only (Google/
   * Apple) accounts, which prove ownership by echoing their email instead.
   */
  hasPassword?: boolean;
}
