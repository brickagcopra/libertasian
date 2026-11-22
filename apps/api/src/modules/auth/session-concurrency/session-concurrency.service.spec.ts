import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import type { RedisService } from '../../../common/services/redis.service';
import type { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { SessionConcurrencyService } from './session-concurrency.service';

type Env = Record<string, unknown>;

const config = (env: Env): ConfigService =>
  ({ get: (k: string, d?: unknown) => (k in env ? env[k] : d) }) as unknown as ConfigService;

const user = (sid: string | undefined, extra: Record<string, unknown> = {}) =>
  ({ sub: 'user-1', sid, organizationId: 'org-1', ...extra }) as never;

describe('SessionConcurrencyService (mocked Redis)', () => {
  let client: { eval: jest.Mock; multi: jest.Mock; del: jest.Mock };
  let redis: { getClient: () => typeof client; get: jest.Mock; set: jest.Mock };
  let subscriptions: { getPlanCode: jest.Mock };

  const build = (env: Env = { DEVICE_CONCURRENCY_ENABLED: true }) =>
    new SessionConcurrencyService(
      redis as unknown as RedisService,
      subscriptions as unknown as SubscriptionsService,
      config(env),
    );

  beforeEach(() => {
    const multi = { zrem: jest.fn(), srem: jest.fn(), exec: jest.fn().mockResolvedValue([]) };
    multi.zrem.mockReturnValue(multi);
    multi.srem.mockReturnValue(multi);
    client = {
      eval: jest.fn().mockResolvedValue([0]),
      multi: jest.fn(() => multi),
      del: jest.fn().mockResolvedValue(2),
    };
    redis = {
      getClient: () => client,
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    subscriptions = { getPlanCode: jest.fn().mockResolvedValue('pro') };
  });

  it('limits: pro 2, edu 1, others uncapped; env overrides', () => {
    const svc = build({ DEVICE_CONCURRENCY_PRO: '3', DEVICE_CONCURRENCY_EDU: 1 });
    expect(svc.limitForTier('pro')).toBe(3);
    expect(svc.limitForTier('edu')).toBe(1);
    expect(svc.limitForTier('free')).toBeNull();
    expect(build().limitForTier('pro')).toBe(2);
  });

  it('does nothing when disabled', async () => {
    await build({}).assertActive(user('s1'));
    expect(client.eval).not.toHaveBeenCalled();
    expect(subscriptions.getPlanCode).not.toHaveBeenCalled();
  });

  it('skips tokens without sid, platform admins, and uncapped plans', async () => {
    const svc = build();
    await svc.assertActive(user(undefined));
    await svc.assertActive(user('s1', { isPlatformAdmin: true }));
    subscriptions.getPlanCode.mockResolvedValue('free');
    await svc.assertActive(user('s1'));
    expect(client.eval).not.toHaveBeenCalled();
  });

  it('passes the plan cap to the script and caches the plan code', async () => {
    await build().assertActive(user('s1'));
    expect(client.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      'nest:session:active:user-1',
      'nest:session:displaced:user-1',
      's1',
      expect.any(String),
      '600000',
      '2',
      String(8 * 24 * 3600),
      '0',
    );
    expect(redis.set).toHaveBeenCalledWith('nest:session:tier:org-1', 'pro', 300);

    redis.get.mockResolvedValue('edu');
    await build().assertActive(user('s1'));
    expect(subscriptions.getPlanCode).toHaveBeenCalledTimes(1);
    expect(client.eval.mock.calls[1][7]).toBe('1');
  });

  it('throws 409 session_displaced when the script reports displacement', async () => {
    client.eval.mockResolvedValue([1]);
    const err = await build()
      .assertActive(user('s1'))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(409);
    expect((err as HttpException).getResponse()).toMatchObject({ code: 'session_displaced' });
  });

  it('fails open on Redis and DB errors', async () => {
    client.eval.mockRejectedValue(new Error('redis down'));
    await expect(build().assertActive(user('s1'))).resolves.toBeUndefined();
    subscriptions.getPlanCode.mockRejectedValue(new Error('db down'));
    await expect(build().assertActive(user('s1'))).resolves.toBeUndefined();
    await expect(build().claim(user('s1'))).resolves.toBe(0);
  });

  it('claim sets the claim flag and returns the displaced count', async () => {
    client.eval.mockResolvedValue([0, 's2']);
    await expect(build().claim(user('s1'))).resolves.toBe(1);
    expect(client.eval.mock.calls[0][9]).toBe('1');
  });

  it('release / releaseAll clear the user keys', async () => {
    const svc = build();
    await svc.release('user-1', 's1');
    expect(client.multi).toHaveBeenCalled();
    await svc.releaseAll('user-1');
    expect(client.del).toHaveBeenCalledWith(
      'nest:session:active:user-1',
      'nest:session:displaced:user-1',
    );
  });
});

/**
 * Runs the real Lua script. Opt-in: set SESSION_CONCURRENCY_REDIS_URL to a
 * THROWAWAY Redis — the suite flushes the db it points at.
 */
const REDIS_URL = process.env['SESSION_CONCURRENCY_REDIS_URL'];
(REDIS_URL ? describe : describe.skip)('SessionConcurrencyService (real Redis script)', () => {
  let client: Redis;
  let now: number;
  let svc: SessionConcurrencyService;
  let tier: string;

  beforeAll(() => {
    client = new Redis(REDIS_URL as string);
  });
  afterAll(async () => {
    await client.quit();
  });

  beforeEach(async () => {
    await client.flushdb();
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    tier = 'pro';
    const redis = {
      getClient: () => client,
      get: async () => null,
      set: async () => undefined,
    } as unknown as RedisService;
    const subs = { getPlanCode: async () => tier } as unknown as SubscriptionsService;
    svc = new SessionConcurrencyService(redis, subs, config({ DEVICE_CONCURRENCY_ENABLED: true }));
  });
  afterEach(() => jest.restoreAllMocks());

  const ok = (sid: string) => svc.assertActive(user(sid));
  const displaced = (sid: string) =>
    expect(svc.assertActive(user(sid))).rejects.toMatchObject({ status: 409 });

  it('pro: two in use at once; a third displaces the least recently used', async () => {
    await ok('a');
    now += 1000;
    await ok('b');
    now += 1000;
    await ok('a'); // a is now newer than b
    now += 1000;
    await ok('c'); // b is least recently used
    now += 1000;
    await displaced('b');
    await ok('a');
    await ok('c');
  });

  it('a displaced device stays displaced until it claims; claiming displaces the LRU other', async () => {
    await ok('a');
    now += 1000;
    await ok('b');
    now += 1000;
    await ok('c'); // displaces a
    now += 1000;
    await displaced('a');
    await displaced('a'); // no silent ping-pong
    await expect(svc.claim(user('a'))).resolves.toBe(1); // displaces b (LRU)
    now += 1000;
    await ok('a');
    await displaced('b');
    await ok('c');
  });

  it('sessions idle past the window free their slot without being displaced', async () => {
    await ok('a');
    now += 1000;
    await ok('b');
    now += 11 * 60 * 1000; // both idle > 10 min
    await ok('c');
    now += 1000;
    await ok('a'); // a rejoins: c and a in use, b idle
    now += 1000;
    await ok('b'); // b rejoins and displaces c (LRU)
    now += 1000;
    await displaced('c');
  });

  it('edu: one device at a time', async () => {
    tier = 'edu';
    await ok('a');
    now += 1000;
    await ok('b');
    await displaced('a');
  });

  it('release frees the slot and clears a displaced mark', async () => {
    await ok('a');
    now += 1000;
    await ok('b');
    now += 1000;
    await ok('c'); // displaces a
    await svc.release('user-1', 'a');
    now += 1000;
    await ok('a'); // fresh again: displaces b (LRU)
    await displaced('b');
  });

  it('every key it writes has a TTL', async () => {
    await ok('a');
    now += 1000;
    await ok('b');
    now += 1000;
    await ok('c');
    const keys = await client.keys('nest:session:*');
    expect(keys.sort()).toEqual(['nest:session:active:user-1', 'nest:session:displaced:user-1']);
    for (const key of keys) {
      expect(await client.ttl(key)).toBeGreaterThan(0);
    }
  });
});
