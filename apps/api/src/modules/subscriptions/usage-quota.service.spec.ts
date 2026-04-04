import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { EntitlementService } from './entitlement.service';
import { UsageQuotaService } from './usage-quota.service';
import type { QuotaType } from './usage-quota.service';

describe('UsageQuotaService', () => {
  let service: UsageQuotaService;
  let redis: jest.Mocked<RedisService>;
  let entitlementService: jest.Mocked<EntitlementService>;
  let prisma: {
    subscription: {
      findFirst: jest.Mock;
    };
  };

  const mockEntitlements = {
    aiAnswers: 15,
    searchQueries: 50,
    digestsPerMonth: 3,
    cameraScansPerMonth: 3,
    memoDraftingPerMonth: 0,
    pleadingAssistancePerMonth: 0,
    caseComparisonPerMonth: 0,
    timelineGenerationPerMonth: 0,
    hearingPrepPerMonth: 0,
    contradictionDetectionPerMonth: 0,
  };

  beforeEach(async () => {
    prisma = {
      subscription: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsageQuotaService,
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            incr: jest.fn(),
            expire: jest.fn(),
          },
        },
        {
          provide: EntitlementService,
          useValue: {
            resolveEffectiveEntitlements: jest.fn().mockResolvedValue(mockEntitlements),
            getBaseEntitlements: jest.fn().mockResolvedValue(mockEntitlements),
            invalidateEntitlementCache: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<UsageQuotaService>(UsageQuotaService);
    redis = module.get(RedisService);
    entitlementService = module.get(EntitlementService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---- checkAndIncrement ----

  describe('checkAndIncrement', () => {
    it('should allow when under daily limit', async () => {
      redis.get.mockResolvedValue('5');
      redis.incr.mockResolvedValue(6);

      const result = await service.checkAndIncrement('org-1', 'user-1', 'aiAnswers');

      expect(result.allowed).toBe(true);
      expect(result.used).toBe(6);
      expect(result.limit).toBe(15);
      expect(result.remaining).toBe(9);
      expect(result.resetsAt).toBeTruthy();
    });

    it('should deny when quota exhausted', async () => {
      redis.get.mockResolvedValue('15');

      const result = await service.checkAndIncrement('org-1', 'user-1', 'aiAnswers');

      expect(result.allowed).toBe(false);
      expect(result.used).toBe(15);
      expect(result.remaining).toBe(0);
      expect(redis.incr).not.toHaveBeenCalled();
    });

    it('should return unlimited for -1 limit', async () => {
      entitlementService.resolveEffectiveEntitlements.mockResolvedValue({
        aiAnswers: -1,
      });

      const result = await service.checkAndIncrement('org-1', 'user-1', 'aiAnswers');

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(-1);
      expect(result.remaining).toBe(-1);
      expect(result.resetsAt).toBe('');
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.incr).not.toHaveBeenCalled();
    });

    it('should set TTL on first increment (newCount === 1)', async () => {
      redis.get.mockResolvedValue(null);
      redis.incr.mockResolvedValue(1);

      await service.checkAndIncrement('org-1', 'user-1', 'aiAnswers');

      expect(redis.expire).toHaveBeenCalledWith(
        expect.stringContaining('quota:daily:org-1:user-1:aiAnswers'),
        expect.any(Number),
      );
    });

    it('should not set TTL on subsequent increments', async () => {
      redis.get.mockResolvedValue('3');
      redis.incr.mockResolvedValue(4);

      await service.checkAndIncrement('org-1', 'user-1', 'aiAnswers');

      expect(redis.expire).not.toHaveBeenCalled();
    });

    it('should use daily key for aiAnswers (free user, no billing period)', async () => {
      redis.get.mockResolvedValue('0');
      redis.incr.mockResolvedValue(1);

      await service.checkAndIncrement('org-1', 'user-1', 'aiAnswers');

      expect(redis.get).toHaveBeenCalledWith('quota:daily:org-1:user-1:aiAnswers');
    });

    it('should use daily key for searchQueries', async () => {
      redis.get.mockResolvedValue('10');
      redis.incr.mockResolvedValue(11);

      await service.checkAndIncrement('org-1', 'user-1', 'searchQueries');

      expect(redis.get).toHaveBeenCalledWith('quota:daily:org-1:user-1:searchQueries');
    });

    it('should use monthly key for digestsPerMonth (free user)', async () => {
      redis.get.mockResolvedValue('5');
      redis.incr.mockResolvedValue(6);

      await service.checkAndIncrement('org-1', 'user-1', 'digestsPerMonth');

      expect(redis.get).toHaveBeenCalledWith('quota:monthly:org-1:user-1:digestsPerMonth');
    });

    it('should use monthly key for cameraScansPerMonth', async () => {
      redis.get.mockResolvedValue('2');
      redis.incr.mockResolvedValue(3);

      await service.checkAndIncrement('org-1', 'user-1', 'cameraScansPerMonth');

      expect(redis.get).toHaveBeenCalledWith('quota:monthly:org-1:user-1:cameraScansPerMonth');
    });

    it('should treat 0 limit as immediate deny', async () => {
      redis.get.mockResolvedValue(null);

      const result = await service.checkAndIncrement('org-1', 'user-1', 'memoDraftingPerMonth');

      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(0);
      expect(result.remaining).toBe(0);
    });

    it('should handle missing entitlement key as 0', async () => {
      entitlementService.resolveEffectiveEntitlements.mockResolvedValue({});
      redis.get.mockResolvedValue(null);

      const result = await service.checkAndIncrement('org-1', 'user-1', 'hearingPrepPerMonth');

      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(0);
    });

    it('should have resetsAt as ISO string for daily quota', async () => {
      redis.get.mockResolvedValue('0');
      redis.incr.mockResolvedValue(1);

      const result = await service.checkAndIncrement('org-1', 'user-1', 'aiAnswers');

      expect(new Date(result.resetsAt).toISOString()).toBe(result.resetsAt);
      expect(new Date(result.resetsAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('should have resetsAt as ISO string for monthly quota', async () => {
      redis.get.mockResolvedValue('0');
      redis.incr.mockResolvedValue(1);

      const result = await service.checkAndIncrement('org-1', 'user-1', 'digestsPerMonth');

      expect(new Date(result.resetsAt).toISOString()).toBe(result.resetsAt);
      expect(new Date(result.resetsAt).getTime()).toBeGreaterThan(Date.now());
    });
  });

  // ---- Billing-cycle-aware keys ----

  describe('billing-cycle-aware keys', () => {
    it('should use period-stamped key when subscription has billing period', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        currentPeriodStart: new Date('2026-03-15T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-04-15T00:00:00.000Z'),
      });
      redis.get.mockResolvedValue('1');
      redis.incr.mockResolvedValue(2);

      await service.checkAndIncrement('org-1', 'user-1', 'digestsPerMonth');

      expect(redis.get).toHaveBeenCalledWith(
        'quota:period:org-1:user-1:digestsPerMonth:2026-03-15',
      );
    });

    it('should fall back to monthly key when no billing period', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);
      redis.get.mockResolvedValue('1');
      redis.incr.mockResolvedValue(2);

      await service.checkAndIncrement('org-1', 'user-1', 'digestsPerMonth');

      expect(redis.get).toHaveBeenCalledWith('quota:monthly:org-1:user-1:digestsPerMonth');
    });

    it('should still use daily key for daily quotas even with billing period', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        currentPeriodStart: new Date('2026-03-15T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-04-15T00:00:00.000Z'),
      });
      redis.get.mockResolvedValue('1');
      redis.incr.mockResolvedValue(2);

      await service.checkAndIncrement('org-1', 'user-1', 'aiAnswers');

      expect(redis.get).toHaveBeenCalledWith('quota:daily:org-1:user-1:aiAnswers');
    });

    it('should use billing period end as resetsAt for monthly quotas', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        currentPeriodStart: new Date('2026-03-15T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-04-15T00:00:00.000Z'),
      });
      redis.get.mockResolvedValue('0');
      redis.incr.mockResolvedValue(1);

      const result = await service.checkAndIncrement('org-1', 'user-1', 'digestsPerMonth');

      expect(result.resetsAt).toBe('2026-04-15T00:00:00.000Z');
    });

    it('should compute TTL from billing period end for period-stamped keys', async () => {
      const periodEnd = new Date(Date.now() + 86400000 * 10); // 10 days from now
      prisma.subscription.findFirst.mockResolvedValue({
        currentPeriodStart: new Date('2026-03-15T00:00:00.000Z'),
        currentPeriodEnd: periodEnd,
      });
      redis.get.mockResolvedValue(null);
      redis.incr.mockResolvedValue(1);

      await service.checkAndIncrement('org-1', 'user-1', 'digestsPerMonth');

      // TTL should be approximately 10 days in seconds
      const expectedTtl = Math.ceil((periodEnd.getTime() - Date.now()) / 1000);
      expect(redis.expire).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
      );
      const actualTtl = redis.expire.mock.calls[0]![1] as number;
      expect(actualTtl).toBeGreaterThan(expectedTtl - 5);
      expect(actualTtl).toBeLessThanOrEqual(expectedTtl + 5);
    });
  });

  // ---- getUsageSummary (V1 backward compat) ----

  describe('getUsageSummary', () => {
    it('should return summary for all quota types', async () => {
      redis.get.mockResolvedValue('2');

      const summary = await service.getUsageSummary('org-1', 'user-1');

      const types: QuotaType[] = [
        'aiAnswers', 'searchQueries', 'digestsPerMonth', 'cameraScansPerMonth',
        'memoDraftingPerMonth', 'pleadingAssistancePerMonth', 'caseComparisonPerMonth',
        'timelineGenerationPerMonth', 'hearingPrepPerMonth', 'contradictionDetectionPerMonth',
      ];

      for (const t of types) {
        expect(summary[t]).toBeDefined();
        expect(summary[t]).toHaveProperty('allowed');
        expect(summary[t]).toHaveProperty('used');
        expect(summary[t]).toHaveProperty('limit');
        expect(summary[t]).toHaveProperty('remaining');
        expect(summary[t]).toHaveProperty('resetsAt');
      }
    });

    it('should handle unlimited quotas in summary', async () => {
      entitlementService.resolveEffectiveEntitlements.mockResolvedValue({
        aiAnswers: -1,
        searchQueries: -1,
        digestsPerMonth: -1,
        cameraScansPerMonth: -1,
        memoDraftingPerMonth: -1,
        pleadingAssistancePerMonth: -1,
        caseComparisonPerMonth: -1,
        timelineGenerationPerMonth: -1,
        hearingPrepPerMonth: -1,
        contradictionDetectionPerMonth: -1,
      });
      entitlementService.getBaseEntitlements.mockResolvedValue({
        aiAnswers: -1,
        searchQueries: -1,
        digestsPerMonth: -1,
        cameraScansPerMonth: -1,
        memoDraftingPerMonth: -1,
        pleadingAssistancePerMonth: -1,
        caseComparisonPerMonth: -1,
        timelineGenerationPerMonth: -1,
        hearingPrepPerMonth: -1,
        contradictionDetectionPerMonth: -1,
      });

      const summary = await service.getUsageSummary('org-1', 'user-1');

      expect(summary.aiAnswers.allowed).toBe(true);
      expect(summary.aiAnswers.limit).toBe(-1);
      expect(summary.aiAnswers.remaining).toBe(-1);
      expect(summary.aiAnswers.resetsAt).toBe('');
      expect(redis.get).not.toHaveBeenCalled();
    });

    it('should compute remaining correctly', async () => {
      redis.get.mockResolvedValue('10');

      const summary = await service.getUsageSummary('org-1', 'user-1');

      expect(summary.aiAnswers.used).toBe(10);
      expect(summary.aiAnswers.remaining).toBe(5);
      expect(summary.aiAnswers.allowed).toBe(true);
    });

    it('should clamp remaining to 0 when overused', async () => {
      entitlementService.resolveEffectiveEntitlements.mockResolvedValue({
        ...mockEntitlements,
        aiAnswers: 5,
      });
      entitlementService.getBaseEntitlements.mockResolvedValue({
        ...mockEntitlements,
        aiAnswers: 5,
      });
      redis.get.mockResolvedValue('10'); // over limit

      const summary = await service.getUsageSummary('org-1', 'user-1');

      expect(summary.aiAnswers.remaining).toBe(0);
      expect(summary.aiAnswers.allowed).toBe(false);
    });

    it('should NOT include baseLimit or bonusAmount in V1 summary', async () => {
      redis.get.mockResolvedValue('0');

      const summary = await service.getUsageSummary('org-1', 'user-1');

      // V1 should NOT have V2-specific fields
      expect(summary.aiAnswers).not.toHaveProperty('baseLimit');
      expect(summary.aiAnswers).not.toHaveProperty('bonusAmount');
    });
  });

  // ---- getUsageSummaryV2 ----

  describe('getUsageSummaryV2', () => {
    it('should include baseLimit and bonusAmount', async () => {
      entitlementService.resolveEffectiveEntitlements.mockResolvedValue({
        ...mockEntitlements,
        aiAnswers: 65, // 15 base + 50 bonus
      });
      entitlementService.getBaseEntitlements.mockResolvedValue(mockEntitlements);
      redis.get.mockResolvedValue('5');

      const summary = await service.getUsageSummaryV2('org-1', 'user-1');

      expect(summary.quotas.aiAnswers.baseLimit).toBe(15);
      expect(summary.quotas.aiAnswers.bonusAmount).toBe(50);
      expect(summary.quotas.aiAnswers.limit).toBe(65);
    });

    it('should return billing period dates', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        currentPeriodStart: new Date('2026-03-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-04-01T00:00:00.000Z'),
      });
      redis.get.mockResolvedValue('0');

      const summary = await service.getUsageSummaryV2('org-1', 'user-1');

      expect(summary.billingPeriodStart).toBe('2026-03-01T00:00:00.000Z');
      expect(summary.billingPeriodEnd).toBe('2026-04-01T00:00:00.000Z');
    });

    it('should return null billing period for free users', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);
      redis.get.mockResolvedValue('0');

      const summary = await service.getUsageSummaryV2('org-1', 'user-1');

      expect(summary.billingPeriodStart).toBeNull();
      expect(summary.billingPeriodEnd).toBeNull();
    });

    it('should have 0 bonusAmount when effective equals base', async () => {
      redis.get.mockResolvedValue('0');

      const summary = await service.getUsageSummaryV2('org-1', 'user-1');

      expect(summary.quotas.aiAnswers.bonusAmount).toBe(0);
      expect(summary.quotas.aiAnswers.baseLimit).toBe(15);
    });

    it('should have 0 bonusAmount for unlimited quotas', async () => {
      entitlementService.resolveEffectiveEntitlements.mockResolvedValue({
        ...mockEntitlements,
        aiAnswers: -1,
      });
      entitlementService.getBaseEntitlements.mockResolvedValue({
        ...mockEntitlements,
        aiAnswers: -1,
      });

      const summary = await service.getUsageSummaryV2('org-1', 'user-1');

      expect(summary.quotas.aiAnswers.bonusAmount).toBe(0);
      expect(summary.quotas.aiAnswers.baseLimit).toBe(-1);
    });
  });

  // ---- resetQuotasForBillingCycle ----

  describe('resetQuotasForBillingCycle', () => {
    it('should invalidate entitlement cache', async () => {
      await service.resetQuotasForBillingCycle('org-1');

      expect(entitlementService.invalidateEntitlementCache).toHaveBeenCalledWith('org-1');
    });
  });
});
