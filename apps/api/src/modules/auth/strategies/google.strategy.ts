import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';

export interface GoogleProfile {
  googleId: string;
  email: string;
  fullName: string;
}

/**
 * Google OAuth2 Strategy.
 *
 * Only registered when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
 * Returns a normalized GoogleProfile from the OAuth callback.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    const clientID = config.get<string>('GOOGLE_CLIENT_ID', '');
    const clientSecret = config.get<string>('GOOGLE_CLIENT_SECRET', '');
    const callbackURL = config.get<string>(
      'GOOGLE_CALLBACK_URL',
      'http://localhost:3001/api/v1/auth/google/callback',
    );

    super({
      clientID: clientID || 'placeholder-not-configured',
      clientSecret: clientSecret || 'placeholder-not-configured',
      callbackURL,
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      done(new Error('No email found in Google profile'), undefined);
      return;
    }

    const googleProfile: GoogleProfile = {
      googleId: profile.id,
      email,
      fullName: profile.displayName || email.split('@')[0] || 'User',
    };

    done(null, googleProfile);
  }
}
