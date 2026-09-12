import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { PlanEntitlement } from '@prisma/client';

import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FeatureFlagService } from '../feature-flags/feature-flags.service';
import { PlansService } from '../plans/plans.service';
import { CANONICAL_ENTITLEMENT_KEYS } from './entitlement-keys';
import { SubscriptionsService } from './subscriptions.service';

/**
 * ONE tier, THREE sources: the hardcoded `getDefaultEntitlements()` table
 * (live, because `billing.db_plans` is OFF in production), the
 * `plan_entitlements` rows seeded from `prisma/seeds/plan-seed.ts` (live the
 * moment the flag is flipped), and the marketing copy the seed's `description`
 * strings render on /pricing. They have drifted before — free advertised
 * camera scans it did not grant — and nothing failed.
 *
 * This spec is the guard: for EVERY plan code and EVERY key, the two resolvers
 * must produce the same value. The seed is compared THROUGH
 * `PlansService.entitlementsFromRows` rather than by reading `numericValue`
 * directly, because that method is what the flag-ON path actually runs —
 * including its `unlimited` → -1 and null-coalescing rules. Re-implementing
 * that mapping here would let a bug in it pass.
 *
 * `require` rather than `import`: `prisma/seeds` sits outside this package's
 * tsconfig `rootDir`, so a static import breaks `tsc`.
 */
describe('free/plan entitlement drift: hardcoded table vs plan-seed', () => {
  let service: SubscriptionsService;
  let plans: PlansService;

  type SeedEntitlement = {
    key: string;
    valueType: string;
    numericValue?: number;
    booleanValue?: boolean;
    description: string;
  };
  type SeedPlan = { code: string; entitlements: SeedEntitlement[] };

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PLAN_SEEDS } = require('../../../prisma/seeds/plan-seed') as {
    PLAN_SEEDS: SeedPlan[];
  };

  const PLAN_CODES = ['free', 'edu', 'pro', 'team', 'enterprise'] as const;

  /**
   * Keys the SEED grants that the hardcoded table has no field for, so the two
   * cannot agree on them by construction.
   *
   * They are listed — not skipped silently — because each one is a real
   * difference in what an account gets depending on which resolver ran. With
   * `billing.db_plans` OFF (production today) an edu account has NO
   * `codalReader` key at all and every read of it falls through to whatever the
   * caller's default is; with the flag ON it is `true`. Closing the gap means
   * adding these to `SubscriptionEntitlements` and to `getDefaultEntitlements`,
   * which is a behaviour change and not this PR's job. Until then the list is
   * the record of what is known-divergent, and the test below fails the moment
   * anything NOT on it diverges.
   */
  const KNOWN_SEED_ONLY_KEYS: Record<string, string[]> = {
    edu: ['codalReader', 'flashcardGeneration', 'studyProgressTracking'],
    enterprise: ['dedicatedSupport', 'customIntegrations'],
  };

  /** The seed's own spelling of a value, resolved the way the service does. */
  const asEntitlementRow = (e: SeedEntitlement): PlanEntitlement =>
    ({
      key: e.key,
      valueType: e.valueType,
      numericValue: e.numericValue ?? null,
      booleanValue: e.booleanValue ?? null,
    }) as unknown as PlanEntitlement;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        PlansService,
        { provide: PrismaService, useValue: { subscription: { findFirst: jest.fn() } } },
        { provide: RedisService, useValue: { get: jest.fn(), set: jest.fn() } },
        { provide: FeatureFlagService, useValue: { isEnabled: jest.fn().mockResolvedValue(false) } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(true) } },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
    // The real PlansService: `entitlementsFromRows` is pure, and using the real
    // one is the entire point — a double would assert against a copy.
    plans = module.get<PlansService>(PlansService);
  });

  it.each(PLAN_CODES)('every plan code is seeded: %s', (code) => {
    expect(PLAN_SEEDS.map((p) => p.code)).toContain(code);
  });

  it.each(PLAN_CODES)(
    '%s: getDefaultEntitlements equals the seed resolved through entitlementsFromRows',
    (code) => {
      const seed = PLAN_SEEDS.find((p) => p.code === code)!;
      const fromSeed = plans.entitlementsFromRows(
        seed.entitlements.map(asEntitlementRow),
      ) as unknown as Record<string, number | boolean>;
      const hardcoded = service.getDefaultEntitlements(code) as unknown as Record<
        string,
        number | boolean
      >;

      const allowed = new Set(KNOWN_SEED_ONLY_KEYS[code] ?? []);
      const expected: Record<string, number | boolean> = {};
      for (const [key, value] of Object.entries(fromSeed)) {
        if (!allowed.has(key)) expected[key] = value;
      }

      // One object comparison, not a per-key loop: a key the HARDCODED table
      // defines and the seed does not is drift too, and only comparing whole
      // objects catches it in both directions.
      expect(hardcoded).toEqual(expected);
    },
  );

  it('the seed-only allowlist names keys that really are seed-only', () => {
    for (const [code, keys] of Object.entries(KNOWN_SEED_ONLY_KEYS)) {
      const seed = PLAN_SEEDS.find((p) => p.code === code)!;
      const hardcoded = service.getDefaultEntitlements(code) as unknown as Record<
        string,
        unknown
      >;

      for (const key of keys) {
        // Still in the seed...
        expect(seed.entitlements.map((e) => e.key)).toContain(key);
        // ...and still missing from the hardcoded table. When someone adds it,
        // this fails and the entry comes off the list.
        expect(Object.keys(hardcoded)).not.toContain(key);
      }
    }
  });

  it('no plan grants a key outside the known entitlement vocabulary', () => {
    // `CANONICAL_ENTITLEMENT_KEYS` is what the quota and admin surfaces
    // iterate. A seed key outside it is granted by nothing and reported by
    // nothing.
    const vocabulary = new Set<string>([
      ...CANONICAL_ENTITLEMENT_KEYS,
      ...Object.values(KNOWN_SEED_ONLY_KEYS).flat(),
    ]);

    for (const plan of PLAN_SEEDS) {
      for (const e of plan.entitlements) {
        expect({ plan: plan.code, key: e.key, known: vocabulary.has(e.key) }).toEqual({
          plan: plan.code,
          key: e.key,
          known: true,
        });
      }
    }
  });

  /**
   * The free tier is the one a signed-out visitor and App Review both meet, so
   * its four decided values are asserted literally rather than only relatively.
   */
  describe('free tier resolves to the values /pricing advertises', () => {
    const freeSeed = () => PLAN_SEEDS.find((p) => p.code === 'free')!;

    it('hardcoded table', () => {
      const ent = service.getDefaultEntitlements('free');
      expect(ent.aiAnswers).toBe(3);
      expect(ent.cameraScansPerMonth).toBe(1);
      expect(ent.digestsPerMonth).toBe(1);
      expect(ent.offlineReading).toBe(true);
    });

    it('seed rows', () => {
      const ent = plans.entitlementsFromRows(
        freeSeed().entitlements.map(asEntitlementRow),
      );
      expect(ent.aiAnswers).toBe(3);
      expect(ent.cameraScansPerMonth).toBe(1);
      expect(ent.digestsPerMonth).toBe(1);
      expect(ent.offlineReading).toBe(true);
    });

    /**
     * Not decoration: `description` is rendered VERBATIM by the /pricing plan
     * card, so a stale string is a public claim about a quota the API does not
     * grant. That is the exact failure this PR closes.
     */
    it('seed descriptions state the granted numbers', () => {
      const byKey = new Map(freeSeed().entitlements.map((e) => [e.key, e]));
      expect(byKey.get('aiAnswers')!.description).toContain('3');
      expect(byKey.get('cameraScansPerMonth')!.description).toContain('1/month');
      expect(byKey.get('digestsPerMonth')!.description).toContain('1/month');
    });

    /**
     * Every quota the free tier grants is > 0 by design: exhausting a quota
     * returns 429 quota_exceeded, while a 0 limit returns 402
     * subscription_required — the status App Review reads as a paywall.
     */
    it('grants no zero-valued quota on any surface it exposes', () => {
      const ent = service.getDefaultEntitlements('free') as unknown as Record<
        string,
        number | boolean
      >;
      for (const key of ['aiAnswers', 'searchQueries', 'digestsPerMonth', 'cameraScansPerMonth']) {
        expect({ key, value: ent[key] }).toEqual({ key, value: expect.any(Number) });
        expect(ent[key] as number).toBeGreaterThan(0);
      }
    });
  });
});
