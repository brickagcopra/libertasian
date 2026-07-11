import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

import type { GoogleProfile } from './strategies/google.strategy';

export interface AppleProfile {
  appleId: string;
  /** Apple omits the email claim in rare edge cases (e.g. revoked authorization) */
  email: string | null;
}

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';

/**
 * Verifies provider-issued ID tokens for the mobile token-exchange endpoints
 * (POST /auth/google/mobile and /auth/apple/mobile). Mobile apps obtain the
 * token via the native provider SDK and exchange it here for our JWT pair —
 * there is no redirect/callback leg like the web OAuth flow.
 *
 * All verification failures throw a GENERIC 401. Token contents are never
 * echoed back to the client; the specific rejection reason is only logged.
 */
@Injectable()
export class SocialTokenService {
  private readonly logger = new Logger(SocialTokenService.name);
  private readonly googleClient = new OAuth2Client();
  private readonly googleAudiences: string[];
  private readonly appleAudience: string;
  /** Remote JWKS is cached by jose across calls (keys refetch on rotation) */
  private appleJwks: JWTVerifyGetKey | null = null;

  constructor(config: ConfigService) {
    // Accept ID tokens minted for any of our Google OAuth clients: the web
    // client ID plus the platform-specific iOS/Android client IDs.
    this.googleAudiences = [
      config.get<string>('GOOGLE_CLIENT_ID', ''),
      config.get<string>('GOOGLE_IOS_CLIENT_ID', ''),
      config.get<string>('GOOGLE_ANDROID_CLIENT_ID', ''),
    ].filter(Boolean);
    this.appleAudience = config.get<string>('APPLE_BUNDLE_ID', 'com.libertasian.app');
  }

  /** Whether any Google audience is configured — gates the 503 in the controller */
  get googleConfigured(): boolean {
    return this.googleAudiences.length > 0;
  }

  async verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.googleAudiences,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email) {
        throw new Error('missing sub or email claim');
      }
      // Unverified emails must never drive find-by-email account linking —
      // that would let an attacker take over an account by registering the
      // victim's address with Google and signing in before verification.
      if (payload.email_verified !== true) {
        throw new Error('email not verified');
      }
      return {
        googleId: payload.sub,
        email: payload.email,
        fullName: payload.name || payload.email.split('@')[0] || 'User',
      };
    } catch (err) {
      this.logger.warn(
        `Google ID token rejected: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new UnauthorizedException('Invalid Google credential');
    }
  }

  async verifyAppleIdentityToken(identityToken: string): Promise<AppleProfile> {
    try {
      this.appleJwks ??= createRemoteJWKSet(new URL(APPLE_JWKS_URL));
      const { payload } = await jwtVerify(identityToken, this.appleJwks, {
        issuer: APPLE_ISSUER,
        audience: this.appleAudience,
      });
      if (!payload.sub) {
        throw new Error('missing sub claim');
      }
      return {
        appleId: payload.sub,
        email: typeof payload['email'] === 'string' ? payload['email'] : null,
      };
    } catch (err) {
      this.logger.warn(
        `Apple identity token rejected: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new UnauthorizedException('Invalid Apple credential');
    }
  }
}
