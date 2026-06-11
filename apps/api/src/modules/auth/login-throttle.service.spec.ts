import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { RedisService } from '../../common/services/redis.service';
import { LoginThrottleService } from './login-throttle.service';

/**
 * Minimal in-memory stand-in for RedisService. Stores a numeric counter and a
 * TTL per key. TTL is not decremented over wall-clock (tests do not advance
 * time) — it is sufficient to model "is this key currently locked?".
 */
class FakeRedis {
  readonly store = new Map<string, { value: number; ttl: number }>();

  async incr(key: string): Promise<number> {
    const existing = this.store.get(key);
    const value = (existing ? existing.value : 0) + 1;
    this.store.set(key, { value, ttl: existing ? existing.ttl : -1 });
    return value;
  }

  async expire(key: string, ttlSeconds: number): Promise<number> {
    const existing = this.store.get(key);
    if (!existing) return 0;
    existing.ttl = ttlSeconds;
    return 1;
  }

  async set(key: string, _value: string, ttlSeconds?: number): Promise<void> {
    this.store.set(key, { value: 1, ttl: ttlSeconds ?? -1 });
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async ttl(key: string): Promise<number> {
    const existing = this.store.get(key);
    return existing ? existing.ttl : -2; // -2 = no such key (ioredis semantics)
  }
}

/** Redis whose every operation rejects — used to prove fail-open behaviour. */
class ThrowingRedis {
  async incr(): Promise<number> {
    throw new Error('redis down');
  }
  async expire(): Promise<number> {
    throw new Error('redis down');
  }
  async set(): Promise<void> {
    throw new Error('redis down');
  }
  async del(): Promise<number> {
    throw new Error('redis down');
  }
  async ttl(): Promise<number> {
    throw new Error('redis down');
  }
}

const configStub = {
  // Service always supplies the canonical defaults as the second arg.
  get: <T>(_key: string, def?: T): T => def as T,
} as unknown as ConfigService;

const ACCOUNT_THRESHOLD = 10;
const IP_THRESHOLD = 100;

describe('LoginThrottleService', () => {
  let redis: FakeRedis;
  let svc: LoginThrottleService;

  beforeEach(() => {
    redis = new FakeRedis();
    svc = new LoginThrottleService(redis as unknown as RedisService, configStub);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Resolve a thrown HttpException for inspection (or fail if none thrown). */
  async function expectLocked(email: string, ip: string): Promise<HttpException> {
    try {
      await svc.assertNotLocked(email, ip);
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      return err as HttpException;
    }
    throw new Error('expected assertNotLocked to throw, but it resolved');
  }

  describe('Layer 1 — per-account lockout', () => {
    const email = 'victim@example.com';
    const ip = '203.0.113.7';

    it('locks the account on the threshold-th failure; the next attempt is 429 with Retry-After', async () => {
      // First (threshold - 1) failures: still unlocked.
      for (let i = 0; i < ACCOUNT_THRESHOLD - 1; i++) {
        await svc.recordFailure(email, ip);
        await expect(svc.assertNotLocked(email, ip)).resolves.toBeUndefined();
      }

      // The threshold-th failure arms the lock.
      await svc.recordFailure(email, ip);

      const err = await expectLocked(email, ip);
      expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const body = err.getResponse() as { retryAfter: number };
      // count == threshold → 2^0 = 1 minute → 60 seconds.
      expect(body.retryAfter).toBe(60);
    });

    it('applies exponential backoff: count=threshold+1 locks for 2 minutes', async () => {
      for (let i = 0; i < ACCOUNT_THRESHOLD + 1; i++) {
        await svc.recordFailure(email, ip);
      }
      const err = await expectLocked(email, ip);
      const body = err.getResponse() as { retryAfter: number };
      expect(body.retryAfter).toBe(120); // 2^1 = 2 minutes
    });

    it('a correct password BEFORE the threshold resets the counter (recordSuccess clears it)', async () => {
      for (let i = 0; i < ACCOUNT_THRESHOLD - 1; i++) {
        await svc.recordFailure(email, ip);
      }
      await svc.recordSuccess(email, ip);

      // Counter was cleared: it now takes a fresh full run of failures to lock.
      await expect(svc.assertNotLocked(email, ip)).resolves.toBeUndefined();
      for (let i = 0; i < ACCOUNT_THRESHOLD - 1; i++) {
        await svc.recordFailure(email, ip);
        await expect(svc.assertNotLocked(email, ip)).resolves.toBeUndefined();
      }
    });

    it('keys the account counter by sha256 of the lowercased email (case-insensitive)', async () => {
      for (let i = 0; i < ACCOUNT_THRESHOLD; i++) {
        await svc.recordFailure('Victim@Example.COM', ip);
      }
      // A differently-cased spelling of the same address is treated as locked.
      await expectLocked('victim@example.com', ip);
    });
  });

  describe('Layer 2 — per-IP velocity', () => {
    const ip = '198.51.100.42';

    it('locks the IP at the IP threshold across DISTINCT accounts (no account lock involved)', async () => {
      for (let i = 0; i < IP_THRESHOLD; i++) {
        await svc.recordFailure(`user${i}@example.com`, ip);
      }
      // A brand-new account from the same IP is now blocked by the velocity layer.
      const err = await expectLocked('fresh@example.com', ip);
      const body = err.getResponse() as { retryAfter: number };
      expect(body.retryAfter).toBe(900); // 15 min IP lock
    });

    it('does not lock the IP below the threshold', async () => {
      for (let i = 0; i < IP_THRESHOLD - 1; i++) {
        await svc.recordFailure(`user${i}@example.com`, ip);
      }
      await expect(svc.assertNotLocked('fresh@example.com', ip)).resolves.toBeUndefined();
    });
  });

  describe('NAT-safety — successes never count', () => {
    it('200 successful logins for distinct accounts from one IP lock nobody', async () => {
      const sharedIp = '100.64.0.1'; // CGNAT range
      for (let i = 0; i < 200; i++) {
        await svc.recordSuccess(`firm-user-${i}@example.com`, sharedIp);
      }
      await expect(
        svc.assertNotLocked('another-firm-user@example.com', sharedIp),
      ).resolves.toBeUndefined();
      // No per-IP failure counter was ever created.
      expect(redis.store.has(`auth:fail:ip:${sharedIp}`)).toBe(false);
    });

    it('recordSuccess preserves the per-IP velocity counter (NIST SP 800-63B)', async () => {
      const ip = '198.51.100.9';
      await svc.recordFailure('a@example.com', ip);
      await svc.recordFailure('b@example.com', ip);
      await svc.recordSuccess('a@example.com', ip);

      // The IP counter still reflects both prior failures; only account 'a'
      // was cleared.
      expect(redis.store.get(`auth:fail:ip:${ip}`)?.value).toBe(2);
    });
  });

  describe('per-account isolation', () => {
    const ip = '192.0.2.50';

    it('locking account A does not lock account B from the same IP', async () => {
      for (let i = 0; i < ACCOUNT_THRESHOLD; i++) {
        await svc.recordFailure('accountA@example.com', ip);
      }
      // A is locked...
      await expectLocked('accountA@example.com', ip);
      // ...but B (same IP, IP velocity still well under the 100 threshold) is fine.
      await expect(
        svc.assertNotLocked('accountB@example.com', ip),
      ).resolves.toBeUndefined();
    });
  });

  describe('fail-open on Redis outage', () => {
    let throwingSvc: LoginThrottleService;
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      throwingSvc = new LoginThrottleService(
        new ThrowingRedis() as unknown as RedisService,
        configStub,
      );
    });

    it('assertNotLocked resolves (login proceeds) and logs a structured warning', async () => {
      await expect(
        throwingSvc.assertNotLocked('x@example.com', '10.0.0.1'),
      ).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('recordFailure and recordSuccess never throw on Redis errors', async () => {
      await expect(throwingSvc.recordFailure('x@example.com', '10.0.0.1')).resolves.toBeUndefined();
      await expect(throwingSvc.recordSuccess('x@example.com', '10.0.0.1')).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    });
  });
});
