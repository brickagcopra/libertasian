import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { AuditService } from '../audit/audit.service';
import { SubscriptionsService } from './subscriptions.service';
import { EntitlementService } from './entitlement.service';

/**
 * The entitlement cache key must separate a BROWSER from LIVE APP STORE BUILD
 * 25.
 *
 * Both send no `x-platform` header, so both resolve to a `null` platform and,
 * on the platform alone, to the same cache key. With `PAYWALL_ENFORCED_WEB` on
 * they resolve to OPPOSITE entitlements, so sharing a key means whichever
 * client warms it first serves its answer to the other for the full 120s TTL:
 *
 *   browser warms it  → build 25 is handed a 403 it has no purchase surface to
 *                       clear. This is the build-23 rejection, arriving
 *                       intermittently and only under real mixed traffic.
 *   build 25 warms it → the browser reads the paid corpus free, and the flag
 *                       appears not to work.
 *
 * Neither direction can be caught by a sequential test of the resolver alone,
 * which is why these assert on the KEYS rather than on the values.
 */
describe('entitlement cache is keyed by client surface', () => {
  let service: EntitlementService;
  let redis: jest.Mocked<Pick<RedisService, 'get' | 'set' | 'del'>>;

  const BASE = { aiAnswers: 15, previewOnly: true };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntitlementService,
        {
          provide: PrismaService,
          useValue: {
            entitlementOverride: {
              findMany: jest.fn().mockResolvedValue([]),
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: SubscriptionsService,
          useValue: { getEntitlements: jest.fn().mockResolvedValue(BASE) },
        },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get(EntitlementService);
    redis = module.get(RedisService);
  });

  afterEach(() => jest.clearAllMocks());

  it('writes a browser under its OWN key, not the headerless one', async () => {
    await service.resolveEffectiveEntitlements('org-1', null, 'web');

    expect(redis.set).toHaveBeenCalledWith(
      'cache:entitlements:org-1:none:web',
      JSON.stringify(BASE),
      120,
    );
  });

  it('writes legacy_app under the plain headerless key — PROTECTS LIVE BUILD 25', async () => {
    await service.resolveEffectiveEntitlements('org-1', null, 'legacy_app');

    expect(redis.set).toHaveBeenCalledWith(
      'cache:entitlements:org-1:none',
      JSON.stringify(BASE),
      120,
    );
  });

  it('does not read a browser entry for a legacy_app caller', async () => {
    // The direction that would gate a shipped binary with no purchase surface.
    redis.get.mockImplementation(async (key: string) =>
      key === 'cache:entitlements:org-1:none:web'
        ? JSON.stringify({ aiAnswers: 999, previewOnly: false })
        : null,
    );

    const ent = await service.resolveEffectiveEntitlements(
      'org-1',
      null,
      'legacy_app',
    );

    expect(redis.get).toHaveBeenCalledWith('cache:entitlements:org-1:none');
    expect(ent).toEqual(BASE);
  });

  it('does not read a legacy_app entry for a browser', async () => {
    // The other direction: the browser reading the ungated answer build 25 left
    // behind, which is the free-corpus bypass this whole change closes.
    redis.get.mockImplementation(async (key: string) =>
      key === 'cache:entitlements:org-1:none'
        ? JSON.stringify({ aiAnswers: 999, previewOnly: false })
        : null,
    );

    const ent = await service.resolveEffectiveEntitlements('org-1', null, 'web');

    expect(redis.get).toHaveBeenCalledWith('cache:entitlements:org-1:none:web');
    expect(ent).toEqual(BASE);
  });

  it('keeps the pre-existing keys byte-identical', async () => {
    // Nothing already in Redis is orphaned by this deploy: only the browser
    // gains a new slot. An orphaned key is a stale paywall decision that
    // survives its own invalidation for the full TTL.
    await service.resolveEffectiveEntitlements('org-1', 'ios', 'ios');
    await service.resolveEffectiveEntitlements('org-1', 'android', 'android');
    await service.resolveEffectiveEntitlements('org-1', null, null);

    const keys = redis.set.mock.calls.map((call) => call[0]);
    expect(keys).toEqual([
      'cache:entitlements:org-1:ios',
      'cache:entitlements:org-1:android',
      'cache:entitlements:org-1:none',
    ]);
  });

  it('invalidates the browser key as well as the rest', async () => {
    await service.invalidateEntitlementCache('org-1');

    const deleted = redis.del.mock.calls.map((call) => call[0]).sort();
    expect(deleted).toEqual([
      'cache:entitlements:org-1:android',
      'cache:entitlements:org-1:android:web',
      'cache:entitlements:org-1:ios',
      'cache:entitlements:org-1:ios:web',
      'cache:entitlements:org-1:none',
      'cache:entitlements:org-1:none:web',
    ]);
  });

  it('covers every key the read path can write', async () => {
    // The property that actually matters, asserted rather than assumed: run the
    // resolver over every (platform, surface) pair that can reach it, then check
    // that one invalidation deletes all of them. A variant the read path writes
    // but the invalidation list forgets would serve a pre-grant entitlement for
    // the full TTL after a purchase.
    const platforms = ['ios', 'android', null] as const;
    const surfaces = ['ios', 'android', 'legacy_app', 'web', null] as const;

    for (const platform of platforms) {
      for (const surface of surfaces) {
        await service.resolveEffectiveEntitlements('org-1', platform, surface);
      }
    }
    const written = new Set(redis.set.mock.calls.map((call) => call[0]));

    redis.del.mockClear();
    await service.invalidateEntitlementCache('org-1');
    const deleted = new Set(redis.del.mock.calls.map((call) => call[0]));

    for (const key of written) {
      expect(deleted).toContain(key);
    }
  });
});
