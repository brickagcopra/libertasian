import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JwtPayload } from '@libertasian/types';

import { RedisService } from '../../../common/services/redis.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';

/** Error code a displaced session receives (409). Clients key off this. */
export const SESSION_DISPLACED_CODE = 'session_displaced';

/** How long a displaced marker lives: one refresh-token lifetime plus a day. */
const DISPLACED_TTL_SEC = 8 * 24 * 60 * 60;
/** How long an organization's plan code is cached for the per-request check. */
const TIER_CACHE_TTL_SEC = 300;

/**
 * Atomic "touch" of one session in a user's active set.
 *
 * KEYS[1] active zset (member = sid, score = last request ms)
 * KEYS[2] displaced set (sids that lost their slot and must claim it back)
 * ARGV[1] sid  ARGV[2] now ms  ARGV[3] window ms  ARGV[4] limit
 * ARGV[5] displaced ttl sec  ARGV[6] "1" = claim (clear own displaced mark first)
 *
 * Returns { displaced (0/1), sids displaced by this call... }.
 *
 * Sessions idle for longer than the window are dropped from the active set
 * WITHOUT being marked displaced: an idle device is not "in use", so it simply
 * rejoins on its next request. Only sessions that were active inside the
 * window and fell out because a newer one arrived are marked displaced, which
 * is what stops two devices from silently taking turns.
 */
const TOUCH_SCRIPT = `
local active = KEYS[1]
local displaced = KEYS[2]
local sid = ARGV[1]
local now = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
local limit = tonumber(ARGV[4])
local dttl = tonumber(ARGV[5])
if ARGV[6] == '1' then
  redis.call('SREM', displaced, sid)
elseif redis.call('SISMEMBER', displaced, sid) == 1 then
  return {1}
end
redis.call('ZREMRANGEBYSCORE', active, '-inf', now - window)
redis.call('ZADD', active, now, sid)
local result = {0}
local count = redis.call('ZCARD', active)
if count > limit then
  local members = redis.call('ZRANGE', active, 0, -1)
  local excess = count - limit
  for _, m in ipairs(members) do
    if excess <= 0 then break end
    if m ~= sid then
      redis.call('ZREM', active, m)
      redis.call('SADD', displaced, m)
      table.insert(result, m)
      excess = excess - 1
    end
  end
  redis.call('EXPIRE', displaced, dttl)
end
redis.call('PEXPIRE', active, window)
return result
`;

/**
 * Per-account concurrent-use cap (device limits, phase 2).
 *
 * Phase 1 caps how many devices may stay SIGNED IN. This caps how many may be
 * IN USE at once: pro 2, edu 1, other plans uncapped. Every authenticated
 * request touches the caller's session (the access token's `sid`, i.e. its
 * refresh-token family) in a per-user Redis sorted set; the newest K by last
 * request keep their slot. A session pushed out is marked displaced and every
 * further request answers 409 `session_displaced` until the user taps "Use it
 * here" on that device (POST /auth/sessions/claim), which displaces the
 * least recently used other session in turn.
 *
 * Behind DEVICE_CONCURRENCY_ENABLED (default false). Fails OPEN: a Redis or
 * database error logs a warning and lets the request through.
 */
@Injectable()
export class SessionConcurrencyService {
  private readonly logger = new Logger(SessionConcurrencyService.name);
  private readonly enabled: boolean;
  private readonly windowMs: number;
  private readonly limits: Readonly<Record<string, number>>;

  constructor(
    private readonly redis: RedisService,
    private readonly subscriptions: SubscriptionsService,
    private readonly config: ConfigService,
  ) {
    const rawEnabled = this.config.get<boolean | string>('DEVICE_CONCURRENCY_ENABLED', false);
    this.enabled = rawEnabled === true || rawEnabled === 'true';
    this.windowMs =
      Number(this.config.get<number | string>('DEVICE_CONCURRENCY_WINDOW_SEC', 600)) * 1000;
    this.limits = {
      pro: Number(this.config.get<number | string>('DEVICE_CONCURRENCY_PRO', 2)),
      edu: Number(this.config.get<number | string>('DEVICE_CONCURRENCY_EDU', 1)),
    };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Concurrent-use cap for a plan code, or null when the plan is uncapped. */
  limitForTier(tier: string): number | null {
    const limit = this.limits[tier];
    return limit !== undefined && Number.isFinite(limit) && limit >= 1 ? limit : null;
  }

  /**
   * Record this request against the caller's session. Throws 409
   * `session_displaced` when the session has lost its slot. Never throws for
   * any other reason.
   */
  async assertActive(user: JwtPayload | undefined): Promise<void> {
    const displaced = await this.touch(user, false);
    if (displaced) {
      throw new HttpException(
        {
          success: false,
          error: SESSION_DISPLACED_CODE,
          code: SESSION_DISPLACED_CODE,
          message:
            'Your account is in use on another device. Choose "Use it here" to continue on this one.',
        },
        HttpStatus.CONFLICT,
      );
    }
  }

  /**
   * Take a slot back for the caller's session ("Use it here"). Displaces the
   * least recently used other session when the cap is full. Returns how many
   * sessions were displaced. Fails open (returns 0).
   */
  async claim(user: JwtPayload | undefined): Promise<number> {
    const result = await this.run(user, true);
    return result ? result.displacedSids.length : 0;
  }

  /**
   * Sessions of this user currently holding an in-use slot (requested inside
   * the window and not displaced), or null when the cap is off or Redis is
   * unreachable — "unknown", not "none".
   */
  async inUseSessionIds(userId: string): Promise<Set<string> | null> {
    if (!this.enabled) return null;
    try {
      const sids = await this.redis
        .getClient()
        .zrangebyscore(this.activeKey(userId), Date.now() - this.windowMs, '+inf');
      return new Set(sids);
    } catch (err) {
      this.warn('in_use', userId, err);
      return null;
    }
  }

  /** Forget a session (logout / revoke). Best effort. */
  async release(userId: string, sid: string | undefined): Promise<void> {
    if (!this.enabled || !sid) return;
    try {
      const client = this.redis.getClient();
      await client
        .multi()
        .zrem(this.activeKey(userId), sid)
        .srem(this.displacedKey(userId), sid)
        .exec();
    } catch (err) {
      this.warn('release', userId, err);
    }
  }

  /** Forget every session of a user (sign out everywhere). Best effort. */
  async releaseAll(userId: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.redis.getClient().del(this.activeKey(userId), this.displacedKey(userId));
    } catch (err) {
      this.warn('release_all', userId, err);
    }
  }

  private async touch(user: JwtPayload | undefined, claim: boolean): Promise<boolean> {
    const result = await this.run(user, claim);
    return result?.displaced ?? false;
  }

  private async run(
    user: JwtPayload | undefined,
    claim: boolean,
  ): Promise<{ displaced: boolean; displacedSids: string[] } | null> {
    if (!this.enabled || !user?.sub || !user.sid || !user.organizationId) return null;
    // Platform admins sign in on many devices to support users.
    if (user.isPlatformAdmin) return null;
    try {
      const tier = await this.planCode(user.organizationId);
      const limit = this.limitForTier(tier);
      if (limit === null) return null;

      const raw = (await this.redis
        .getClient()
        .eval(
          TOUCH_SCRIPT,
          2,
          this.activeKey(user.sub),
          this.displacedKey(user.sub),
          user.sid,
          String(Date.now()),
          String(this.windowMs),
          String(limit),
          String(DISPLACED_TTL_SEC),
          claim ? '1' : '0',
        )) as unknown;

      if (!Array.isArray(raw)) return null;
      const displaced = Number(raw[0]) === 1;
      const displacedSids = raw.slice(1).map(String);
      for (const other of displacedSids) {
        this.logger.log(
          `session_displaced user=${user.sub} sid=${other} by=${user.sid} tier=${tier} limit=${limit}${claim ? ' via=claim' : ''}`,
        );
      }
      return { displaced, displacedSids };
    } catch (err) {
      this.warn(claim ? 'claim' : 'touch', user.sub, err);
      return null;
    }
  }

  /** Plan code for the org, cached briefly: this runs on every request. */
  private async planCode(organizationId: string): Promise<string> {
    const key = `nest:session:tier:${organizationId}`;
    const cached = await this.redis.get(key);
    if (cached) return cached;
    const tier = await this.subscriptions.getPlanCode(organizationId);
    await this.redis.set(key, tier, TIER_CACHE_TTL_SEC);
    return tier;
  }

  private activeKey(userId: string): string {
    return `nest:session:active:${userId}`;
  }

  private displacedKey(userId: string): string {
    return `nest:session:displaced:${userId}`;
  }

  private warn(op: string, userId: string, err: unknown): void {
    this.logger.warn(
      `session_concurrency ${op} failed open user=${userId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
