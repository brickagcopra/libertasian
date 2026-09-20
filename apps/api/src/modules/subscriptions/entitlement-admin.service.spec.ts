import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { AuditService } from '../audit/audit.service';
import { SubscriptionsService } from './subscriptions.service';
import { EntitlementService } from './entitlement.service';

/**
 * The admin "effective entitlements" surface.
 *
 * The invariant under test throughout: this feature REPORTS precedence, it does
 * not implement it. The effective column must come from
 * `resolveEffectiveEntitlements` — the same call a real request makes — so the
 * panel cannot drift from what users get.
 */
describe('EntitlementService — admin entitlements surface', () => {
  const ORG = 'org-1';
  const SUB = 'sub-1';

  // The live free plan: /pricing advertises 3 AI answers and one digest a
  // month, and `getDefaultEntitlements('free')` grants exactly that.
  const PLAN_DEFAULTS = {
    aiAnswers: 3,
    searchQueries: 50,
    digestsPerMonth: 1,
    offlineReading: true,
  };

  let service: EntitlementService;
  let prisma: {
    subscription: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    entitlementOverride: { findMany: jest.Mock };
  };
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let subscriptions: {
    getEntitlements: jest.Mock;
    resolvePlanDefaults: jest.Mock;
    getActiveSubscription: jest.Mock;
    isPaywallEnforcedFor: jest.Mock;
  };
  let audit: { log: jest.Mock };

  /** A subscription row as `findUnique`/`findMany` return it. */
  function subRow(entitlementsJson: unknown, overrides: Record<string, unknown> = {}) {
    return {
      id: SUB,
      organizationId: ORG,
      planCode: 'free',
      entitlementsJson,
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue(subRow({})),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockImplementation(({ data }) => ({ id: SUB, ...data })),
      },
      entitlementOverride: { findMany: jest.fn().mockResolvedValue([]) },
    };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      del: jest.fn(),
    };
    subscriptions = {
      // The resolver's answer, which the report must echo verbatim.
      getEntitlements: jest.fn().mockResolvedValue({ ...PLAN_DEFAULTS }),
      resolvePlanDefaults: jest.fn().mockResolvedValue({ ...PLAN_DEFAULTS }),
      getActiveSubscription: jest.fn().mockResolvedValue({ id: SUB }),
      isPaywallEnforcedFor: jest.fn().mockReturnValue(true),
    };
    audit = { log: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntitlementService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: SubscriptionsService, useValue: subscriptions },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<EntitlementService>(EntitlementService);
  });

  afterEach(() => jest.clearAllMocks());

  function rowFor(report: { keys: { key: string }[] }, key: string) {
    const row = report.keys.find((k) => k.key === key);
    if (!row) throw new Error(`no row for ${key}`);
    return row as never as {
      key: string;
      planValue: unknown;
      storedValue: unknown;
      hasStoredValue: boolean;
      activeOverrides: unknown[];
      effectiveValue: unknown;
      winningLayer: string;
      conflictsWithPlan: boolean;
    };
  }

  // ---- Precedence is reported, never re-derived ----

  describe('getEffectiveEntitlementReport — precedence is unchanged', () => {
    it('takes effectiveValue from resolveEffectiveEntitlements, not from its own merge', async () => {
      // A resolver answer that NO combination of the layers below would produce.
      // If the report recomputed precedence it would report 15 or 0, not 999.
      subscriptions.getEntitlements.mockResolvedValue({
        ...PLAN_DEFAULTS,
        aiAnswers: 999,
      });
      prisma.subscription.findUnique.mockResolvedValue(
        subRow({ aiAnswers: 0 }),
      );

      const report = await service.getEffectiveEntitlementReport(SUB, null);

      expect(rowFor(report, 'aiAnswers').effectiveValue).toBe(999);
    });

    it('resolves the effective column for the requested platform', async () => {
      await service.getEffectiveEntitlementReport(SUB, 'ios');

      // Third argument: the surface the report SIMULATES, derived from the
      // platform it was asked about rather than inherited from the admin's own
      // browser.
      expect(subscriptions.getEntitlements).toHaveBeenCalledWith(
        ORG,
        'ios',
        'ios',
      );
      // Second argument: the simulated surface, derived from the platform the
      // report was asked about — not inherited from the admin's own browser.
      expect(subscriptions.isPaywallEnforcedFor).toHaveBeenCalledWith(
        'ios',
        'ios',
      );
    });

    it('reports web as the wire spelling of the null platform', async () => {
      const report = await service.getEffectiveEntitlementReport(SUB, null);

      expect(report.platform).toBe('web');
      // `platform ?? 'web'` — the same mapping the `platform` field of the
      // report itself uses, so both columns describe one client.
      expect(subscriptions.getEntitlements).toHaveBeenCalledWith(
        ORG,
        null,
        'web',
      );
    });

    it('404s on an unknown subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      await expect(
        service.getEffectiveEntitlementReport('nope', null),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---- winningLayer ----

  describe('winningLayer', () => {
    it("is 'plan' when nothing else carries the key", async () => {
      prisma.subscription.findUnique.mockResolvedValue(subRow({}));

      const report = await service.getEffectiveEntitlementReport(SUB, null);
      const row = rowFor(report, 'aiAnswers');

      expect(row.winningLayer).toBe('plan');
      expect(row.planValue).toBe(3);
      expect(row.storedValue).toBeNull();
      expect(row.hasStoredValue).toBe(false);
    });

    it("is 'subscription' when entitlements_json carries the key", async () => {
      prisma.subscription.findUnique.mockResolvedValue(
        subRow({ aiAnswers: 0 }),
      );

      const report = await service.getEffectiveEntitlementReport(SUB, null);
      const row = rowFor(report, 'aiAnswers');

      expect(row.winningLayer).toBe('subscription');
      expect(row.storedValue).toBe(0);
      expect(row.hasStoredValue).toBe(true);
    });

    it("is 'override' when an active entitlement_override carries the key", async () => {
      prisma.subscription.findUnique.mockResolvedValue(
        subRow({ aiAnswers: 0 }),
      );
      prisma.entitlementOverride.findMany.mockResolvedValue([
        {
          id: 'ov-1',
          entitlementKey: 'aiAnswers',
          overrideType: 'admin_override',
          numericValue: 500,
          booleanValue: null,
          reason: 'complimentary',
          sourceType: 'admin',
          expiresAt: null,
        },
      ]);

      const report = await service.getEffectiveEntitlementReport(SUB, null);
      const row = rowFor(report, 'aiAnswers');

      expect(row.winningLayer).toBe('override');
      expect(row.activeOverrides).toHaveLength(1);
    });

    it("stays 'subscription' when the stored value equals the plan value", async () => {
      // Structural, not value-inferred: clearing a stored 3 is still a change
      // of which layer answers, and the panel must not imply otherwise.
      prisma.subscription.findUnique.mockResolvedValue(
        subRow({ aiAnswers: 3 }),
      );

      const report = await service.getEffectiveEntitlementReport(SUB, null);
      const row = rowFor(report, 'aiAnswers');

      expect(row.winningLayer).toBe('subscription');
      expect(row.conflictsWithPlan).toBe(false);
    });
  });

  // ---- conflictsWithPlan ----

  describe('conflictsWithPlan', () => {
    it('fires on the live bug: plan grants 3, subscription stores 0', async () => {
      prisma.subscription.findUnique.mockResolvedValue(
        subRow({ aiAnswers: 0, searchQueries: 50, digestsPerMonth: 3 }),
      );

      const report = await service.getEffectiveEntitlementReport(SUB, null);

      const ai = rowFor(report, 'aiAnswers');
      expect(ai.conflictsWithPlan).toBe(true);
      expect(ai.planValue).toBe(3);
      expect(ai.storedValue).toBe(0);

      // Same blob, same value as the plan — not a conflict.
      expect(rowFor(report, 'searchQueries').conflictsWithPlan).toBe(false);
      // Same blob, different value — also a conflict.
      expect(rowFor(report, 'digestsPerMonth').conflictsWithPlan).toBe(true);
    });

    it('does not fire for a key with no stored value', async () => {
      prisma.subscription.findUnique.mockResolvedValue(subRow({}));

      const report = await service.getEffectiveEntitlementReport(SUB, null);

      expect(rowFor(report, 'aiAnswers').conflictsWithPlan).toBe(false);
    });

    it('does not fire for a stored key the plan does not define', async () => {
      prisma.subscription.findUnique.mockResolvedValue(
        subRow({ maxApiKeys: 5 }),
      );

      const report = await service.getEffectiveEntitlementReport(SUB, null);
      const row = rowFor(report, 'maxApiKeys');

      expect(row.planValue).toBeNull();
      expect(row.conflictsWithPlan).toBe(false);
    });
  });

  // ---- Honesty about what the report is describing ----

  describe('report context', () => {
    it('flags a platform where the paywall is not enforced', async () => {
      subscriptions.isPaywallEnforcedFor.mockReturnValue(false);

      const report = await service.getEffectiveEntitlementReport(SUB, null);

      expect(report.paywallEnforced).toBe(false);
    });

    it('flags a row that is not the subscription the org resolves against', async () => {
      subscriptions.getActiveSubscription.mockResolvedValue({ id: 'sub-newer' });

      const report = await service.getEffectiveEntitlementReport(SUB, null);

      expect(report.isResolvedSubscription).toBe(false);
      expect(report.resolvedSubscriptionId).toBe('sub-newer');
    });

    it('surfaces a stored key that is not on the canonical list so it can be cleared', async () => {
      prisma.subscription.findUnique.mockResolvedValue(
        subRow({ legacyBonusCredits: 3 }),
      );

      const report = await service.getEffectiveEntitlementReport(SUB, null);

      expect(rowFor(report, 'legacyBonusCredits').hasStoredValue).toBe(true);
    });

    it('tolerates an entitlements_json that is not an object', async () => {
      prisma.subscription.findUnique.mockResolvedValue(subRow(null));

      const report = await service.getEffectiveEntitlementReport(SUB, null);

      expect(rowFor(report, 'aiAnswers').hasStoredValue).toBe(false);
    });
  });

  // ---- Writes ----

  describe('setSubscriptionEntitlements', () => {
    it('rejects unknown keys', async () => {
      await expect(
        service.setSubscriptionEntitlements(SUB, { aiAnswer: 15 }, 'admin-1'),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('accepts canonical keys and merges rather than replacing the blob', async () => {
      prisma.subscription.findUnique.mockResolvedValue(
        subRow({ aiAnswers: 0, maxMatters: 9 }),
      );

      await service.setSubscriptionEntitlements(SUB, { aiAnswers: 15 }, 'admin-1');

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: SUB },
        data: { entitlementsJson: { aiAnswers: 15, maxMatters: 9 } },
      });
    });

    it('audit-logs before and after', async () => {
      prisma.subscription.findUnique.mockResolvedValue(subRow({ aiAnswers: 0 }));

      await service.setSubscriptionEntitlements(SUB, { aiAnswers: 15 }, 'admin-1');

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription.entitlements_json_set',
          entityId: SUB,
          organizationId: ORG,
          actorUserId: 'admin-1',
          metadata: expect.objectContaining({
            before: { aiAnswers: 0 },
            after: { aiAnswers: 15 },
          }),
        }),
      );
    });

    it('invalidates the entitlement cache for every platform variant', async () => {
      await service.setSubscriptionEntitlements(SUB, { aiAnswers: 15 }, 'admin-1');

      expect(redis.del).toHaveBeenCalledWith('cache:entitlements:org-1:ios');
      expect(redis.del).toHaveBeenCalledWith('cache:entitlements:org-1:android');
      expect(redis.del).toHaveBeenCalledWith('cache:entitlements:org-1:none');
    });
  });

  describe('clearSubscriptionEntitlement', () => {
    it('removes the key so it falls back to the plan', async () => {
      prisma.subscription.findUnique.mockResolvedValue(
        subRow({ aiAnswers: 0, searchQueries: 50 }),
      );

      await service.clearSubscriptionEntitlement(SUB, 'aiAnswers', 'admin-1');

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: SUB },
        data: { entitlementsJson: { searchQueries: 50 } },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription.entitlements_json_clear',
          metadata: expect.objectContaining({ key: 'aiAnswers', clearedValue: 0 }),
        }),
      );
    });

    it('404s when the subscription stores no such key', async () => {
      prisma.subscription.findUnique.mockResolvedValue(subRow({}));

      await expect(
        service.clearSubscriptionEntitlement(SUB, 'aiAnswers', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('clears a non-canonical key that is actually stored', async () => {
      prisma.subscription.findUnique.mockResolvedValue(
        subRow({ legacyBonusCredits: 3 }),
      );

      await service.clearSubscriptionEntitlement(
        SUB,
        'legacyBonusCredits',
        'admin-1',
      );

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: SUB },
        data: { entitlementsJson: {} },
      });
    });
  });

  describe('pruneSubscriptionEntitlementKey', () => {
    beforeEach(() => {
      prisma.subscription.findMany.mockResolvedValue([
        // The 9 paid-era free rows: aiAnswers 0 alongside other keys.
        { id: 's1', organizationId: 'org-a', entitlementsJson: { aiAnswers: 0, searchQueries: 50 } },
        { id: 's2', organizationId: 'org-b', entitlementsJson: { aiAnswers: 0 } },
        // A deliberate complimentary grant — must survive.
        { id: 's3', organizationId: 'org-c', entitlementsJson: { aiAnswers: 500 } },
        // A different key entirely.
        { id: 's4', organizationId: 'org-d', entitlementsJson: { digestsPerMonth: 0 } },
        // Nothing stored.
        { id: 's5', organizationId: 'org-e', entitlementsJson: {} },
      ]);
    });

    it('touches only exact value matches', async () => {
      const result = await service.pruneSubscriptionEntitlementKey(
        'aiAnswers',
        0,
        'admin-1',
      );

      expect(result.affectedCount).toBe(2);
      expect(result.subscriptionIds).toEqual(['s1', 's2']);
      expect(prisma.subscription.update).toHaveBeenCalledTimes(2);
    });

    it('leaves the other keys on a pruned row intact', async () => {
      await service.pruneSubscriptionEntitlementKey('aiAnswers', 0, 'admin-1');

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { entitlementsJson: { searchQueries: 50 } },
      });
    });

    it('writes one audit row per affected subscription, scoped to its own org', async () => {
      await service.pruneSubscriptionEntitlementKey('aiAnswers', 0, 'admin-1');

      expect(audit.log).toHaveBeenCalledTimes(2);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-a',
          action: 'subscription.entitlements_json_prune',
          entityId: 's1',
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-b', entityId: 's2' }),
      );
    });

    it('does not match false against 0', async () => {
      prisma.subscription.findMany.mockResolvedValue([
        { id: 's1', organizationId: 'org-a', entitlementsJson: { offlineReading: false } },
      ]);

      const result = await service.pruneSubscriptionEntitlementKey(
        'offlineReading',
        0,
        'admin-1',
      );

      expect(result.affectedCount).toBe(0);
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('matches booleans when the value is a boolean', async () => {
      prisma.subscription.findMany.mockResolvedValue([
        { id: 's1', organizationId: 'org-a', entitlementsJson: { previewOnly: true } },
        { id: 's2', organizationId: 'org-b', entitlementsJson: { previewOnly: false } },
      ]);

      const result = await service.pruneSubscriptionEntitlementKey(
        'previewOnly',
        true,
        'admin-1',
      );

      expect(result.subscriptionIds).toEqual(['s1']);
    });

    it('invalidates the cache of every affected org', async () => {
      await service.pruneSubscriptionEntitlementKey('aiAnswers', 0, 'admin-1');

      expect(redis.del).toHaveBeenCalledWith('cache:entitlements:org-a:ios');
      expect(redis.del).toHaveBeenCalledWith('cache:entitlements:org-b:none');
      expect(redis.del).not.toHaveBeenCalledWith('cache:entitlements:org-c:ios');
    });
  });

  describe('countStoredEntitlementKeys', () => {
    beforeEach(() => {
      prisma.subscription.findMany.mockResolvedValue([
        { entitlementsJson: { aiAnswers: 0, searchQueries: 50 } },
        { entitlementsJson: { aiAnswers: 0 } },
        { entitlementsJson: { aiAnswers: 500 } },
        { entitlementsJson: {} },
      ]);
    });

    it('counts subscriptions per key and buckets by distinct value', async () => {
      const result = await service.countStoredEntitlementKeys();

      expect(result['aiAnswers']?.count).toBe(3);
      expect(result['aiAnswers']?.values).toEqual([
        { value: 0, count: 2 },
        { value: 500, count: 1 },
      ]);
      expect(result['searchQueries']?.count).toBe(1);
    });

    it('omits keys nothing stores', async () => {
      const result = await service.countStoredEntitlementKeys();

      expect(result['digestsPerMonth']).toBeUndefined();
    });

    it('narrows to one plan code when asked', async () => {
      await service.countStoredEntitlementKeys('free');

      expect(prisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { planCode: 'free' } }),
      );
    });
  });
});
