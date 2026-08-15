import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';

import {
  resolveJwtVerification,
  type JwtVerification,
} from '../jwt/jwt-verification-key';

/**
 * Custom ThrottlerGuard that tracks by userId when authenticated,
 * falling back to IP address for unauthenticated requests.
 *
 * Per CLAUDE.md rate limiting specs:
 * - Auth routes: coarse per-IP backstop (override via @Throttle)
 * - General API: 300 req / min per user (default)
 * - Admin endpoints: 100 req / min per user (override via @Throttle)
 * - Search/AI: plan-based quotas (handled at service level)
 *
 * Rate limit responses return 429 with Retry-After header (built into ThrottlerGuard).
 * Exemptions via @SkipThrottle() decorator (e.g., health check).
 *
 * ── Why this guard verifies the token itself ────────────────────────────────
 *
 * This class is bound as an APP_GUARD, and Nest runs global guards BEFORE
 * route-level ones. `JwtAuthGuard` is route-level everywhere, so `req.user` is
 * still undefined when `getTracker` runs — the `user?.sub` branch was dead
 * code and EVERY route silently fell back to IP keying. Per CLAUDE.md, our
 * users sit behind CGNAT and office NAT, so an entire firm shares one egress
 * IP: a "300 req/min per user" limit was in fact 300 req/min for the whole
 * firm.
 *
 * The fix cannot be to reorder the global guards — that would run
 * authentication before the abuse backstop. Instead the tracker verifies the
 * Bearer token itself and keys on the verified `sub`.
 *
 * The signature check is NOT optional. Keying on an unverified `sub` (e.g.
 * base64-decoding the payload) would let anyone mint a token with a random
 * `sub` per request and get an unlimited budget, making the limiter free to
 * bypass. Any failure — missing header, bad signature, expired, wrong
 * algorithm — falls back to IP, which is the safe direction: the caller gets
 * the shared bucket rather than a private one.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(AppThrottlerGuard.name);
  private verification?: JwtVerification;

  constructor(
    options: ThrottlerModuleOptions,
    storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {
    super(options, storageService, reflector);
  }

  protected override async getTracker(
    req: Record<string, unknown>,
  ): Promise<string> {
    // Set on the rare paths where something already authenticated the request.
    const user = req['user'] as { sub?: string } | undefined;
    if (user?.sub) return user.sub;

    const sub = this.subjectFromBearer(req);
    if (sub) return sub;

    return (req['ip'] as string) ?? 'unknown';
  }

  /** Verified `sub` from the Authorization header, or undefined. */
  private subjectFromBearer(req: Record<string, unknown>): string | undefined {
    const headers = req['headers'] as Record<string, unknown> | undefined;
    const raw = headers?.['authorization'];
    if (typeof raw !== 'string') return undefined;

    const [scheme, token] = raw.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return undefined;

    try {
      // Resolved once and memoised: reading the PEM off disk per request would
      // put a filesystem hit on every API call.
      this.verification ??= resolveJwtVerification(this.config);

      const payload = this.jwtService.verify<{ sub?: string }>(token, {
        secret: this.verification.key,
        algorithms: this.verification.algorithms,
      });
      return payload?.sub;
    } catch {
      // Expired or malformed tokens are ordinary traffic, not incidents — the
      // request is about to be rejected by JwtAuthGuard anyway. Staying quiet
      // here keeps an expired-token storm from flooding the logs.
      return undefined;
    }
  }
}
