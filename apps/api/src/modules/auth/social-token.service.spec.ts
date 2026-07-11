import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

// Mock provider SDKs — unit tests never hit Google/Apple endpoints.
const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn(() => ({ verifyIdToken: mockVerifyIdToken })),
}));

const mockJwtVerify = jest.fn();
const mockCreateRemoteJWKSet = jest.fn((_url: URL) => 'mock-jwks-getter');
jest.mock('jose', () => ({
  createRemoteJWKSet: (url: URL) => mockCreateRemoteJWKSet(url),
  jwtVerify: (token: string, jwks: unknown, opts: unknown) => mockJwtVerify(token, jwks, opts),
}));

import { SocialTokenService } from './social-token.service';

describe('SocialTokenService', () => {
  let service: SocialTokenService;
  let configValues: Record<string, string>;

  async function buildService(): Promise<SocialTokenService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialTokenService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def?: unknown) =>
              key in configValues ? configValues[key] : def,
            ),
          },
        },
      ],
    }).compile();
    return module.get(SocialTokenService);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    configValues = {
      GOOGLE_CLIENT_ID: 'web-client-id',
      GOOGLE_IOS_CLIENT_ID: 'ios-client-id',
      GOOGLE_ANDROID_CLIENT_ID: 'android-client-id',
      APPLE_BUNDLE_ID: 'com.libertasian.app',
    };
    service = await buildService();
  });

  describe('googleConfigured', () => {
    it('is true when any Google client ID is set', () => {
      expect(service.googleConfigured).toBe(true);
    });

    it('is false when no Google client IDs are set', async () => {
      configValues = { APPLE_BUNDLE_ID: 'com.libertasian.app' };
      const unconfigured = await buildService();
      expect(unconfigured.googleConfigured).toBe(false);
    });
  });

  describe('verifyGoogleIdToken', () => {
    function ticketWith(payload: Record<string, unknown> | undefined) {
      mockVerifyIdToken.mockResolvedValue({ getPayload: () => payload });
    }

    it('returns a normalized profile for a valid token', async () => {
      ticketWith({
        sub: 'google-sub-1',
        email: 'juan@example.com',
        email_verified: true,
        name: 'Juan Dela Cruz',
      });

      const profile = await service.verifyGoogleIdToken('valid-token');

      expect(profile).toEqual({
        googleId: 'google-sub-1',
        email: 'juan@example.com',
        fullName: 'Juan Dela Cruz',
      });
      // Audience allowlist includes all three configured client IDs
      expect(mockVerifyIdToken).toHaveBeenCalledWith({
        idToken: 'valid-token',
        audience: ['web-client-id', 'ios-client-id', 'android-client-id'],
      });
    });

    it('falls back to the email local-part when name is missing', async () => {
      ticketWith({ sub: 's', email: 'juan@example.com', email_verified: true });

      const profile = await service.verifyGoogleIdToken('t');

      expect(profile.fullName).toBe('juan');
    });

    it('rejects with a generic 401 when email_verified is not true (account-takeover guard)', async () => {
      ticketWith({
        sub: 'google-sub-1',
        email: 'victim@example.com',
        email_verified: false,
        name: 'Attacker',
      });

      await expect(service.verifyGoogleIdToken('t')).rejects.toThrow(
        new UnauthorizedException('Invalid Google credential'),
      );
    });

    it('rejects with a generic 401 when the SDK rejects the token (expired / bad signature)', async () => {
      mockVerifyIdToken.mockRejectedValue(new Error('Token used too late, 1234 < 5678'));

      await expect(service.verifyGoogleIdToken('expired')).rejects.toThrow(
        new UnauthorizedException('Invalid Google credential'),
      );
    });

    it('rejects with a generic 401 on wrong audience', async () => {
      mockVerifyIdToken.mockRejectedValue(
        new Error('Wrong recipient, payload audience != requiredAudience'),
      );

      await expect(service.verifyGoogleIdToken('wrong-aud')).rejects.toThrow(
        new UnauthorizedException('Invalid Google credential'),
      );
    });

    it('rejects with a generic 401 when sub or email claims are missing', async () => {
      ticketWith({ email_verified: true });

      await expect(service.verifyGoogleIdToken('t')).rejects.toThrow(
        new UnauthorizedException('Invalid Google credential'),
      );
    });
  });

  describe('verifyAppleIdentityToken', () => {
    it('returns appleId + email for a valid token, verifying iss and aud', async () => {
      mockJwtVerify.mockResolvedValue({
        payload: { sub: 'apple-sub-1', email: 'relay@privaterelay.appleid.com' },
      });

      const profile = await service.verifyAppleIdentityToken('valid-token');

      expect(profile).toEqual({
        appleId: 'apple-sub-1',
        email: 'relay@privaterelay.appleid.com',
      });
      expect(mockCreateRemoteJWKSet).toHaveBeenCalledWith(
        new URL('https://appleid.apple.com/auth/keys'),
      );
      expect(mockJwtVerify).toHaveBeenCalledWith('valid-token', 'mock-jwks-getter', {
        issuer: 'https://appleid.apple.com',
        audience: 'com.libertasian.app',
      });
    });

    it('returns null email when the claim is absent', async () => {
      mockJwtVerify.mockResolvedValue({ payload: { sub: 'apple-sub-1' } });

      const profile = await service.verifyAppleIdentityToken('t');

      expect(profile).toEqual({ appleId: 'apple-sub-1', email: null });
    });

    it('caches the remote JWKS across calls', async () => {
      mockJwtVerify.mockResolvedValue({ payload: { sub: 's' } });

      await service.verifyAppleIdentityToken('t1');
      await service.verifyAppleIdentityToken('t2');

      expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['expired', '"exp" claim timestamp check failed'],
      ['wrong audience', 'unexpected "aud" claim value'],
      ['wrong issuer', 'unexpected "iss" claim value'],
      ['bad signature', 'signature verification failed'],
    ])('rejects with a generic 401 on %s', async (_label, message) => {
      mockJwtVerify.mockRejectedValue(new Error(message));

      await expect(service.verifyAppleIdentityToken('bad')).rejects.toThrow(
        new UnauthorizedException('Invalid Apple credential'),
      );
    });

    it('rejects with a generic 401 when sub is missing', async () => {
      mockJwtVerify.mockResolvedValue({ payload: { email: 'a@b.com' } });

      await expect(service.verifyAppleIdentityToken('t')).rejects.toThrow(
        new UnauthorizedException('Invalid Apple credential'),
      );
    });
  });
});
