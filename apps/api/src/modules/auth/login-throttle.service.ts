import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

import { RedisService } from '../../common/services/redis.service';

/**
 * Two-layer brute-force protection for password login, modelled on the
 * Auth0 / OWASP / NIST guidance:
 *
 *   Layer 1 — per-account: count CONSECUTIVE failed credential checks against
 *   a single account (keyed by sha256 of the lowercased email). At the
 *   threshold the account is locked with exponential backoff. A successful
 *   login clears this counter.
 *
 *   Layer 2 — per-IP velocity: count failures originating from a single IP.
 *   This is a coarse backstop against credential-stuffing that sprays many
 *   accounts from one host. Per NIST SP 800-63B, a successful authentication
 *   (a "new secret" being accepted) does NOT reset this velocity counter —
 *   only the per-account counter clears on success.
 *
 * NAT-safety: only FAILURES are counted. Successful logins never increment
 * either counter, so a CGNAT / office-NAT egress IP shared by an entire firm
 * is never locked out by its members' normal sign-ins.
 *
 * Fail-open: every Redis call is wrapped in try/catch. On a Redis outage the
 * service logs a structured warning and allows the attempt — a cache failure
 * must never block legitimate logins.
 */
@Injectable()
export class LoginThrottleService {
  private readonly logger = new Logger(LoginThrottleService.name);

  private readonly accountThreshold: number;
  private readonly ipThreshold: number;
  private readonly windowSec: number;
  private readonly maxLockMin: number;

  /** Redis key namespaces (per CLAUDE.md key-namespacing convention). */
  private static readonly ACCT_FAIL_PREFIX = 'auth:fail:acct:';
  private static readonly ACCT_LOCK_PREFIX = 'auth:lock:acct:';
  private static readonly IP_FAIL_PREFIX = 'auth:fail:ip:';
  private static readonly IP_LOCK_PREFIX = 'auth:lock:ip:';

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.accountThreshold = this.config.get<number>('AUTH_LOCK_ACCOUNT_THRESHOLD', 10);
    this.ipThreshold = this.config.get<number>('AUTH_LOCK_IP_THRESHOLD', 100);
    this.windowSec = this.config.get<number>('AUTH_LOCK_WINDOW_SEC', 900);
    this.maxLockMin = this.config.get<number>('AUTH_LOCK_MAX_MIN', 30);
  }

  /**
   * Throw HttpException(429) with a Retry-After (seconds) if either the
   * per-account or the per-IP layer is currently locked. Call at the START of
   * login, before any credential comparison. Fails open on Redis error.
   */
  async assertNotLocked(email: string, ip: string): Promise<void> {
    const acctRetry = await this.lockTtl(
      LoginThrottleService.ACCT_LOCK_PREFIX + this.accountHash(email),
    );
    if (acctRetry > 0) {
      this.logger.warn(`Login blocked: per-account lock active (retryAfter=${acctRetry}s)`);
      throw this.lockedException(acctRetry);
    }

    const ipRetry = await this.lockTtl(LoginThrottleService.IP_LOCK_PREFIX + ip);
    if (ipRetry > 0) {
      this.logger.warn(`Login blocked: per-IP velocity lock active (retryAfter=${ipRetry}s)`);
      throw this.lockedException(ipRetry);
    }
  }

  /**
   * Record one failed credential check. Increments BOTH the per-account and
   * per-IP failure counters and arms the corresponding lock once a threshold
   * is crossed. Counts failures only — never call on success.
   */
  async recordFailure(email: string, ip: string): Promise<void> {
    await this.bumpAccount(this.accountHash(email));
    await this.bumpIp(ip);
  }

  /**
   * Record a fully successful login. Clears ONLY the per-account failure
   * counter (and any standing account lock). The per-IP velocity counter is
   * intentionally left intact per NIST SP 800-63B.
   */
  async recordSuccess(email: string, ip: string): Promise<void> {
    // `ip` is part of the contract for symmetry/future use; the per-IP
    // velocity counter is deliberately NOT cleared here (NIST: a new accepted
    // secret does not reset rate limiting).
    void ip;
    const hash = this.accountHash(email);
    try {
      await this.redis.del(LoginThrottleService.ACCT_FAIL_PREFIX + hash);
      await this.redis.del(LoginThrottleService.ACCT_LOCK_PREFIX + hash);
    } catch (err) {
      this.failOpen('recordSuccess: clearing per-account counter failed', err);
    }
  }

  // ---- Internals ----

  /** Read the remaining lock TTL (seconds) for a lock key; 0 if not locked. */
  private async lockTtl(lockKey: string): Promise<number> {
    try {
      const ttl = await this.redis.ttl(lockKey);
      // ioredis: -2 = no such key, -1 = key without expiry. Treat both as "not locked".
      return ttl > 0 ? ttl : 0;
    } catch (err) {
      this.failOpen('assertNotLocked: Redis TTL lookup failed', err);
      return 0;
    }
  }

  private async bumpAccount(hash: string): Promise<void> {
    const failKey = LoginThrottleService.ACCT_FAIL_PREFIX + hash;
    try {
      const count = await this.redis.incr(failKey);
      // Sliding window: refresh the TTL on every consecutive failure.
      await this.redis.expire(failKey, this.windowSec);

      if (count >= this.accountThreshold) {
        const overshoot = count - this.accountThreshold; // 0, 1, 2, ...
        const lockMin = Math.min(this.maxLockMin, Math.pow(2, overshoot));
        await this.redis.set(
          LoginThrottleService.ACCT_LOCK_PREFIX + hash,
          '1',
          Math.round(lockMin * 60),
        );
      }
    } catch (err) {
      this.failOpen('recordFailure: per-account counter increment failed', err);
    }
  }

  private async bumpIp(ip: string): Promise<void> {
    const failKey = LoginThrottleService.IP_FAIL_PREFIX + ip;
    try {
      const count = await this.redis.incr(failKey);
      await this.redis.expire(failKey, this.windowSec);

      if (count >= this.ipThreshold) {
        await this.redis.set(LoginThrottleService.IP_LOCK_PREFIX + ip, '1', this.windowSec);
      }
    } catch (err) {
      this.failOpen('recordFailure: per-IP counter increment failed', err);
    }
  }

  /** sha256(lowercased, trimmed email) — never store or log the raw email. */
  private accountHash(email: string): string {
    return crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  }

  private lockedException(retryAfterSec: number): HttpException {
    // `retryAfter` is surfaced both in the body and (via HttpExceptionFilter)
    // as the standard Retry-After response header.
    return new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message: 'Too many failed login attempts. Please try again later.',
        retryAfter: retryAfterSec,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private failOpen(context: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.warn(`${context}: ${message} — failing open, login allowed`);
  }
}
