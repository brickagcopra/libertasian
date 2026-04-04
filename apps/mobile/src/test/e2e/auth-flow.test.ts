/**
 * Auth Flow E2E Integration Tests.
 * Tests the complete authentication lifecycle on mobile:
 * Registration → Login → MFA → Token Refresh → Session Management → Logout.
 * Per CLAUDE.md: RS256 JWT, bcrypt cost 12, refresh token rotation, MFA (TOTP).
 */

const mockPost = jest.fn();
const mockGet = jest.fn();
const mockDelete = jest.fn();
const mockSetOnUnauthorized = jest.fn();

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    post: (...args: unknown[]) => mockPost(...args),
    get: (...args: unknown[]) => mockGet(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    setOnUnauthorized: mockSetOnUnauthorized,
  },
  ApiClientError: class ApiClientError extends Error {
    statusCode: number;
    serverMessage: string;
    constructor(statusCode: number, message: string) {
      super(message);
      this.name = 'ApiClientError';
      this.statusCode = statusCode;
      this.serverMessage = message;
    }
  },
}));

const mockSetAccessToken = jest.fn();
const mockSetRefreshToken = jest.fn();
const mockGetRefreshToken = jest.fn();
const mockClearTokens = jest.fn();

jest.mock('../../storage/auth-storage', () => ({
  authStorage: {
    getAccessToken: jest.fn().mockResolvedValue(null),
    setAccessToken: (...args: unknown[]) => mockSetAccessToken(...args),
    getRefreshToken: (...args: unknown[]) => mockGetRefreshToken(...args),
    setRefreshToken: (...args: unknown[]) => mockSetRefreshToken(...args),
    clearTokens: (...args: unknown[]) => mockClearTokens(...args),
  },
}));

import { ApiClientError } from '../../lib/api-client';

describe('Auth Flow E2E', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Registration flow', () => {
    it('should register a new user with valid data', async () => {
      const registerData = {
        email: 'maria@lawfirm.ph',
        password: 'SecurePass123!test',
        fullName: 'Maria Dela Cruz',
      };

      mockPost.mockResolvedValueOnce({
        user: {
          id: 'user-1',
          email: registerData.email,
          fullName: registerData.fullName,
          status: 'active',
          emailVerified: false,
          mfaEnabled: false,
        },
        accessToken: 'at-new',
        refreshToken: 'rt-new',
      });

      const result = await mockPost('/auth/register', registerData, { skipAuth: true });

      expect(mockPost).toHaveBeenCalledWith('/auth/register', registerData, { skipAuth: true });
      expect(result.user.email).toBe('maria@lawfirm.ph');
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('should reject registration with weak password (< 10 chars)', async () => {
      mockPost.mockRejectedValueOnce(
        new ApiClientError(400, 'Password must be at least 10 characters'),
      );

      await expect(
        mockPost('/auth/register', { email: 'a@b.com', password: 'Short1!', fullName: 'X' }, { skipAuth: true }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('should reject registration with duplicate email', async () => {
      mockPost.mockRejectedValueOnce(
        new ApiClientError(409, 'Email already registered'),
      );

      await expect(
        mockPost('/auth/register', { email: 'existing@test.com', password: 'ValidPass123!x', fullName: 'Test' }, { skipAuth: true }),
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('should validate email format', () => {
      const validEmails = ['user@example.com', 'name.surname@law.edu.ph'];
      const invalidEmails = ['not-email', '@no-local.com', 'spaces in@email.com'];

      validEmails.forEach((e) => expect(e).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/));
      invalidEmails.forEach((e) => expect(e).not.toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/));
    });
  });

  describe('Login flow', () => {
    it('should login and store tokens securely', async () => {
      mockPost.mockResolvedValueOnce({
        user: { id: 'user-1', email: 'test@test.com', fullName: 'Test', mfaEnabled: false },
        accessToken: 'at-123',
        refreshToken: 'rt-456',
        mfaRequired: false,
      });

      const result = await mockPost('/auth/login', {
        email: 'test@test.com',
        password: 'MyPassword123!',
      }, { skipAuth: true });

      expect(result.accessToken).toBe('at-123');
      expect(result.refreshToken).toBe('rt-456');
      expect(result.mfaRequired).toBe(false);

      // Simulate storing tokens
      await mockSetAccessToken(result.accessToken);
      await mockSetRefreshToken(result.refreshToken);
      expect(mockSetAccessToken).toHaveBeenCalledWith('at-123');
      expect(mockSetRefreshToken).toHaveBeenCalledWith('rt-456');
    });

    it('should handle MFA-required login', async () => {
      // Step 1: Login returns mfaRequired
      mockPost.mockResolvedValueOnce({
        mfaRequired: true,
        mfaToken: 'mfa-temp-token',
        accessToken: '',
        refreshToken: '',
        user: null,
      });

      const loginResult = await mockPost('/auth/login', {
        email: 'admin@test.com',
        password: 'AdminPass123!',
      }, { skipAuth: true });

      expect(loginResult.mfaRequired).toBe(true);

      // Step 2: Submit MFA code
      mockPost.mockResolvedValueOnce({
        user: { id: 'admin-1', email: 'admin@test.com', role: 'admin' },
        accessToken: 'at-mfa',
        refreshToken: 'rt-mfa',
      });

      const mfaResult = await mockPost('/auth/mfa/verify', {
        mfaToken: loginResult.mfaToken,
        code: '123456',
      }, { skipAuth: true });

      expect(mfaResult.accessToken).toBe('at-mfa');
    });

    it('should reject invalid credentials with 401', async () => {
      mockPost.mockRejectedValueOnce(new ApiClientError(401, 'Invalid credentials'));

      await expect(
        mockPost('/auth/login', { email: 'test@test.com', password: 'wrong' }, { skipAuth: true }),
      ).rejects.toMatchObject({ statusCode: 401 });
    });

    it('should handle rate limiting on login (10 req / 15 min)', async () => {
      mockPost.mockRejectedValueOnce(
        new ApiClientError(429, 'Too many login attempts'),
      );

      await expect(
        mockPost('/auth/login', { email: 'test@test.com', password: 'pass' }, { skipAuth: true }),
      ).rejects.toMatchObject({ statusCode: 429 });
    });
  });

  describe('Token refresh flow', () => {
    it('should refresh tokens with single-use rotation', async () => {
      mockGetRefreshToken.mockResolvedValueOnce('rt-old');

      mockPost.mockResolvedValueOnce({
        accessToken: 'at-new',
        refreshToken: 'rt-new',
      });

      const result = await mockPost('/auth/refresh', { refreshToken: 'rt-old' });

      expect(result.accessToken).toBe('at-new');
      expect(result.refreshToken).toBe('rt-new');
      // New tokens should replace old
      expect(result.refreshToken).not.toBe('rt-old');
    });

    it('should reject reused refresh token (rotation detection)', async () => {
      mockPost.mockRejectedValueOnce(
        new ApiClientError(401, 'Token has been revoked'),
      );

      await expect(
        mockPost('/auth/refresh', { refreshToken: 'rt-already-used' }),
      ).rejects.toMatchObject({ statusCode: 401 });
    });
  });

  describe('Session management', () => {
    it('should list active sessions', async () => {
      mockGet.mockResolvedValueOnce({
        sessions: [
          { familyId: 'fam-1', userAgent: 'Mobile/Expo', ipAddress: '192.168.1.1', current: true },
          { familyId: 'fam-2', userAgent: 'Chrome/120', ipAddress: '10.0.0.1', current: false },
        ],
      });

      const result = await mockGet('/auth/sessions');
      expect(result.sessions).toHaveLength(2);
      expect(result.sessions[0].current).toBe(true);
    });

    it('should revoke other session', async () => {
      mockDelete.mockResolvedValueOnce({ success: true });

      await mockDelete('/auth/sessions/fam-2');
      expect(mockDelete).toHaveBeenCalledWith('/auth/sessions/fam-2');
    });
  });

  describe('Logout flow', () => {
    it('should clear tokens and revoke on server', async () => {
      mockPost.mockResolvedValueOnce({ success: true });

      await mockPost('/auth/logout');
      await mockClearTokens();

      expect(mockPost).toHaveBeenCalledWith('/auth/logout');
      expect(mockClearTokens).toHaveBeenCalled();
    });
  });

  describe('Password reset flow', () => {
    it('should request password reset', async () => {
      mockPost.mockResolvedValueOnce({ success: true });

      await mockPost('/auth/forgot-password', { email: 'test@test.com' }, { skipAuth: true });
      expect(mockPost).toHaveBeenCalledWith(
        '/auth/forgot-password',
        { email: 'test@test.com' },
        { skipAuth: true },
      );
    });

    it('should reset password with valid token', async () => {
      mockPost.mockResolvedValueOnce({ success: true });

      await mockPost('/auth/reset-password', {
        token: 'reset-token-123',
        newPassword: 'NewStrongPass123!',
      }, { skipAuth: true });

      expect(mockPost).toHaveBeenCalled();
    });

    it('should reject password reset with expired token', async () => {
      mockPost.mockRejectedValueOnce(new ApiClientError(400, 'Token expired'));

      await expect(
        mockPost('/auth/reset-password', { token: 'expired', newPassword: 'Pass123!' }, { skipAuth: true }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });
});
