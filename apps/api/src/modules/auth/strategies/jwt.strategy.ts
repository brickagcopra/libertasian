import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptionsWithoutRequest } from 'passport-jwt';
import type { JwtPayload } from '@libertasian/types';

import { resolveJwtVerification } from '../../../common/jwt/jwt-verification-key';
import { PermissionsService } from '../../rbac/permissions.service';

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
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    config: ConfigService,
    private readonly permissions: PermissionsService,
  ) {
    // Shared with AppThrottlerGuard: if these two ever resolved different
    // keys, the guard's verification would fail silently and rate limiting
    // would fall back to IP keying across the whole API.
    const { key: secretOrKey, algorithms } = resolveJwtVerification(config);

    const opts: StrategyOptionsWithoutRequest = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey,
      algorithms,
    };

    super(opts);
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Invalid token payload');
    }

    // Resolve platform-admin status from DB-backed effective permissions
    // (not from a JWT claim) so revoking an `admin:*` role takes effect on
    // the next request rather than requiring token refresh. Hot path is
    // served from the RBAC cache, so cost is one cache lookup per request.
    let isPlatformAdmin = false;
    let memberId: string | undefined;
    if (payload.organizationId) {
      try {
        const resolved = await this.permissions.resolveMemberId(
          payload.sub,
          payload.organizationId,
        );
        if (resolved) {
          memberId = resolved;
          const perms = await this.permissions.getEffectivePermissions(resolved);
          isPlatformAdmin = perms.some((p) => p.startsWith('admin:'));
        }
      } catch (err) {
        // Never deny the request because RBAC resolution failed; treat as
        // non-admin and let downstream guards/services handle authz.
        this.logger.warn(
          `Failed to resolve platform-admin status for user ${payload.sub}: ${(err as Error).message}`,
        );
      }
    }

    return { ...payload, isPlatformAdmin, memberId };
  }
}
