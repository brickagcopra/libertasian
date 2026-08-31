import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as Joi from 'joi';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { runWithRequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { FeatureFlagService } from '../feature-flags/feature-flags.service';
import { PlansService } from '../plans/plans.service';
import { EntitlementService } from './entitlement.service';
import { SubscriptionsService } from './subscriptions.service';
import { UsageQuotaService } from './usage-quota.service';

/**
 * End-to-end through the real services: does the quota a caller is held to
 * actually follow the platform on their request?
 *
 * #443 made the paywall GUARD platform-aware. This file covers the gap it left:
 * every quota path resolved entitlements platform-blind, so a gated free-tier
 * iOS user would still have drawn PRO-SIZED quotas (50 AI answers instead of
 * the free tier's 15). The build-26 reviewer would have seen a free account
 * with pro limits.
 *
 * Nothing here threads a `platform` argument. That is the point: the value
 * arrives through the request-scoped context that `RequestPlatformMiddleware`
 * establishes, so the 15+ indirect callers of `checkAndIncrement` become
 * platform-aware without touching their signatures.
 */
describe('platform-aware entitlements (integration)', () => {
  const VARS = [
    'PAYWALL_ENFORCED',
    'STORE_PURCHASE_AVAILABLE_IOS',
    'STORE_PURCHASE_AVAILABLE_ANDROID',
  ] as const;

  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const v of VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
  });
  afterEach(() => {
    for (const v of VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  /**
   * Build the real service graph over an explicit env.
   *
   * Config goes through PROCESS.ENV, not a `load:` factory. Joi coerces
   * `'true'` to a real boolean only on the env-var path; a `load:` factory
   * leaves it a string, and `isStorePurchaseAvailable` compares with
   * `=== true`. Every "not enforced" assertion below would then pass for the
   * wrong reason — the flag would simply be reading OFF. (#443's spec notes
   * the same trap.)
   */
  const buildServices = async (env: Record<string, string>) => {
    Object.assign(process.env, env);

    const redisStore = new Map<string, string>();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          validationSchema: Joi.object({
            PAYWALL_ENFORCED: Joi.boolean().default(false),
            STORE_PURCHASE_AVAILABLE_IOS: Joi.boolean().default(false),
            STORE_PURCHASE_AVAILABLE_ANDROID: Joi.boolean().default(false),
          }).unknown(true),
          validationOptions: { allowUnknown: true },
        }),
      ],
      providers: [
        SubscriptionsService,
        EntitlementService,
        UsageQuotaService,
        {
          provide: PrismaService,
          useValue: {
            // A FREE org: the only accessible subscription is on the free plan.
            subscription: {
              findFirst: jest.fn().mockResolvedValue({
                id: 'sub-1',
                organizationId: 'org-1',
                planCode: 'free',
                entitlementsJson: null,
                currentPeriodStart: null,
                currentPeriodEnd: null,
              }),
            },
            entitlementOverride: { findMany: jest.fn().mockResolvedValue([]) },
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(async (k: string) => redisStore.get(k) ?? null),
            set: jest.fn(async (k: string, v: string) => {
              redisStore.set(k, v);
            }),
            del: jest.fn(async (k: string) => {
              redisStore.delete(k);
            }),
            incr: jest.fn(async (k: string) => {
              const next = Number(redisStore.get(k) ?? '0') + 1;
              redisStore.set(k, String(next));
              return next;
            }),
            getClient: () => ({ set: jest.fn() }),
          },
        },
        { provide: AuditService, useValue: { log: jest.fn() } },
        {
          provide: FeatureFlagService,
          // DB plans OFF, so the hardcoded free defaults apply (aiAnswers 15).
          useValue: { isEnabled: jest.fn().mockResolvedValue(false) },
        },
        { provide: PlansService, useValue: { resolveEntitlements: jest.fn() } },
      ],
    }).compile();

    return {
      entitlements: moduleRef.get(EntitlementService),
      quota: moduleRef.get(UsageQuotaService),
      config: moduleRef.get(ConfigService),
      redisStore,
    };
  };

  // ---- inertness: this is the state the PR merges into ----

  it('with both store flags UNSET, an ios request still resolves pro-sized quotas', async () => {
    const { entitlements } = await buildServices({});

    const ent = await runWithRequestContext({ platform: 'ios' }, () =>
      entitlements.resolveEffectiveEntitlements('org-1'),
    );

    // Unchanged from today: nothing is purchasable on any platform, so the
    // free org is still resolved as 'pro' with the 50-answer allowance. If
    // this flips, the PR is not inert.
    expect(ent.aiAnswers).toBe(50);
  });

  it('with both store flags UNSET, a request with no platform resolves pro-sized quotas', async () => {
    const { entitlements } = await buildServices({});

    const ent = await runWithRequestContext({ platform: null }, () =>
      entitlements.resolveEffectiveEntitlements('org-1'),
    );

    expect(ent.aiAnswers).toBe(50);
  });

  // ---- THE GAP THIS PR CLOSES ----

  it('gates a FREE org on ios to the free-tier quota once iOS purchasing is ON', async () => {
    const { entitlements } = await buildServices({
      STORE_PURCHASE_AVAILABLE_IOS: 'true',
    });

    const ent = await runWithRequestContext({ platform: 'ios' }, () =>
      entitlements.resolveEffectiveEntitlements('org-1'),
    );

    // 15, NOT 50. Before this change the guard would have gated this user
    // while the quota layer still handed them the pro allowance.
    expect(ent.aiAnswers).toBe(15);
    expect(ent.searchQueries).toBe(50);
  });

  it('leaves a header-less caller on pro-sized quotas even when iOS purchasing is ON — PROTECTS LIVE BUILD 25', async () => {
    const { entitlements } = await buildServices({
      STORE_PURCHASE_AVAILABLE_IOS: 'true',
    });

    const ent = await runWithRequestContext({ platform: null }, () =>
      entitlements.resolveEffectiveEntitlements('org-1'),
    );

    // App Store build 25 predates the `x-platform` header and has no purchase
    // surface. It must keep its ungated allowance when iOS purchasing is
    // switched on for build 26.
    expect(ent.aiAnswers).toBe(50);
  });

  it('leaves an android caller ungated when only iOS purchasing is ON', async () => {
    const { entitlements } = await buildServices({
      STORE_PURCHASE_AVAILABLE_IOS: 'true',
    });

    const ent = await runWithRequestContext({ platform: 'android' }, () =>
      entitlements.resolveEffectiveEntitlements('org-1'),
    );

    expect(ent.aiAnswers).toBe(50);
  });

  // ---- outside any request ----

  it('resolves ungated OUTSIDE any request even when iOS purchasing is ON', async () => {
    const { entitlements } = await buildServices({
      STORE_PURCHASE_AVAILABLE_IOS: 'true',
    });

    // No runWithRequestContext: this is a BullMQ worker, a @Cron sweep or a
    // script. It must behave exactly as it does today.
    const ent = await entitlements.resolveEffectiveEntitlements('org-1');

    expect(ent.aiAnswers).toBe(50);
  });

  // ---- the quota path itself ----

  it('enforces the limit checkAndIncrement derives from the request platform', async () => {
    const { quota } = await buildServices({
      STORE_PURCHASE_AVAILABLE_IOS: 'true',
    });

    // `checkAndIncrement` takes no platform argument and never will — it has
    // 15 callers, several behind service layers with no request object. The
    // limit it reports must come from the ambient request.
    const onIos = await runWithRequestContext({ platform: 'ios' }, () =>
      quota.checkAndIncrement('org-1', 'user-1', 'aiAnswers'),
    );

    expect(onIos.limit).toBe(15);
  });

  it('gives the same call the pro limit when the request has no platform', async () => {
    const { quota } = await buildServices({
      STORE_PURCHASE_AVAILABLE_IOS: 'true',
    });

    const headerless = await runWithRequestContext({ platform: null }, () =>
      quota.checkAndIncrement('org-1', 'user-1', 'aiAnswers'),
    );

    // Same org, same code path, same flags — only the request's platform
    // differs, and it is what decides the limit.
    expect(headerless.limit).toBe(50);
  });

  it('keeps the two platforms in separate cache entries', async () => {
    const { entitlements, redisStore } = await buildServices({
      STORE_PURCHASE_AVAILABLE_IOS: 'true',
    });

    await runWithRequestContext({ platform: 'ios' }, () =>
      entitlements.resolveEffectiveEntitlements('org-1'),
    );
    await runWithRequestContext({ platform: null }, () =>
      entitlements.resolveEffectiveEntitlements('org-1'),
    );

    // The #443 key shape, now fed by the resolved context. One key per
    // variant, and the gated answer is not sitting under the header-less key.
    expect([...redisStore.keys()].sort()).toEqual([
      'cache:entitlements:org-1:ios',
      'cache:entitlements:org-1:none',
    ]);
    expect(JSON.parse(redisStore.get('cache:entitlements:org-1:ios')!).aiAnswers).toBe(15);
    expect(JSON.parse(redisStore.get('cache:entitlements:org-1:none')!).aiAnswers).toBe(50);
  });

  it('does not serve one platform its neighbour cached answer under concurrency', async () => {
    const { entitlements } = await buildServices({
      STORE_PURCHASE_AVAILABLE_IOS: 'true',
    });

    // Interleaved, not sequential: both requests are in flight at once, which
    // is the only way a shared platform would be observable.
    const [ios, headerless] = await Promise.all([
      runWithRequestContext({ platform: 'ios' }, () =>
        entitlements.resolveEffectiveEntitlements('org-1'),
      ),
      runWithRequestContext({ platform: null }, () =>
        entitlements.resolveEffectiveEntitlements('org-1'),
      ),
    ]);

    expect(ios.aiAnswers).toBe(15);
    expect(headerless.aiAnswers).toBe(50);
  });

  // ---- an explicit argument still overrides the context ----

  it('lets an explicit platform argument win over the ambient request', async () => {
    const { entitlements } = await buildServices({
      STORE_PURCHASE_AVAILABLE_IOS: 'true',
    });

    const ent = await runWithRequestContext({ platform: 'ios' }, () =>
      // Explicit `null` is a real value meaning "not enforced", and beats the
      // ios context. This is the escape hatch tests and deliberate callers use.
      entitlements.resolveEffectiveEntitlements('org-1', null),
    );

    expect(ent.aiAnswers).toBe(50);
  });
});
