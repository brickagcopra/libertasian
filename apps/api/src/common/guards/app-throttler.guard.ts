import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Custom ThrottlerGuard that tracks by userId when authenticated,
 * falling back to IP address for unauthenticated requests.
 *
 * Per CLAUDE.md rate limiting specs:
 * - Auth routes: 10 req / 15 min per IP (override via @Throttle)
 * - General API: 300 req / min per user (default)
 * - Admin endpoints: 100 req / min per user (override via @Throttle)
 * - Search/AI: plan-based quotas (handled at service level)
 *
 * Rate limit responses return 429 with Retry-After header (built into ThrottlerGuard).
 * Exemptions via @SkipThrottle() decorator (e.g., health check).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(
    req: Record<string, unknown>,
  ): Promise<string> {
    const user = req['user'] as { sub?: string } | undefined;
    // Authenticated: track by userId for per-user limits
    // Unauthenticated: track by IP for per-IP limits
    return user?.sub ?? (req['ip'] as string) ?? 'unknown';
  }
}
