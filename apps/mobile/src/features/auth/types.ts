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
}
