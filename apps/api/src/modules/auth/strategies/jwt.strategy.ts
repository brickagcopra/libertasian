import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptionsWithoutRequest } from 'passport-jwt';
import * as fs from 'fs';
import type { JwtPayload } from '@libertasian/types';

/**
 * JWT Strategy — supports RS256 (production) with symmetric HMAC fallback (dev).
 *
 * Key resolution order:
 * 1. JWT_PUBLIC_KEY_PATH — file path to PEM public key
 * 2. JWT_PUBLIC_KEY — base64-encoded PEM public key
 * 3. JWT_SECRET — symmetric HMAC secret (dev fallback)
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    const publicKeyPath = config.get<string>('JWT_PUBLIC_KEY_PATH', '');
    const publicKeyEnv = config.get<string>('JWT_PUBLIC_KEY', '');
    const jwtSecret = config.get<string>('JWT_SECRET', 'dev-secret-change-in-production');

    let secretOrKey: string;
    let algorithms: ('RS256' | 'HS256')[];

    // RS256 via file path
    if (publicKeyPath && fs.existsSync(publicKeyPath)) {
      secretOrKey = fs.readFileSync(publicKeyPath, 'utf8');
      algorithms = ['RS256'];
    }
    // RS256 via base64-encoded env var
    else if (publicKeyEnv) {
      secretOrKey = Buffer.from(publicKeyEnv, 'base64').toString('utf8');
      algorithms = ['RS256'];
    }
    // Fallback: symmetric HMAC (development only)
    else {
      secretOrKey = jwtSecret;
      algorithms = ['HS256'];
    }

    const opts: StrategyOptionsWithoutRequest = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey,
      algorithms,
    };

    super(opts);
  }

  validate(payload: JwtPayload): JwtPayload {
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Invalid token payload');
    }
    return payload;
  }
}
