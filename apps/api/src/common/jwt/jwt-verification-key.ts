import * as fs from 'fs';
import type { ConfigService } from '@nestjs/config';

export interface JwtVerification {
  /** PEM public key (RS256) or the shared secret (HS256 dev fallback). */
  key: string;
  algorithms: ('RS256' | 'HS256')[];
}

/**
 * Resolve the key used to VERIFY access tokens.
 *
 * Extracted so `JwtStrategy` and `AppThrottlerGuard` cannot drift apart. That
 * matters more than it looks: if the guard resolved a different key from the
 * strategy, verification there would fail silently and every request would
 * fall back to IP keying — which is precisely the bug this helper exists to
 * keep fixed.
 *
 * Precedence matches the documented order:
 *   1. JWT_PUBLIC_KEY_PATH — file path to a PEM public key
 *   2. JWT_PUBLIC_KEY      — base64-encoded PEM public key
 *   3. JWT_SECRET          — symmetric HMAC, development only
 */
export function resolveJwtVerification(config: ConfigService): JwtVerification {
  const publicKeyPath = config.get<string>('JWT_PUBLIC_KEY_PATH', '');
  const publicKeyEnv = config.get<string>('JWT_PUBLIC_KEY', '');
  const jwtSecret = config.get<string>(
    'JWT_SECRET',
    'dev-secret-change-in-production',
  );

  if (publicKeyPath && fs.existsSync(publicKeyPath)) {
    return {
      key: fs.readFileSync(publicKeyPath, 'utf8'),
      algorithms: ['RS256'],
    };
  }

  if (publicKeyEnv) {
    return {
      key: Buffer.from(publicKeyEnv, 'base64').toString('utf8'),
      algorithms: ['RS256'],
    };
  }

  return { key: jwtSecret, algorithms: ['HS256'] };
}
