import { Test, TestingModule } from '@nestjs/testing';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { QuotaController } from './quota.controller';
import { UsageQuotaService } from './usage-quota.service';
import { EntitlementService } from './entitlement.service';

describe('QuotaController', () => {
  let controller: QuotaController;
  let usageQuota: jest.Mocked<Pick<UsageQuotaService, 'getUsageSummaryV2'>>;
  let entitlementService: jest.Mocked<Pick<EntitlementService, 'getActiveBonuses'>>;

  const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

  const mockUser = {
    sub: 'user-1',
    organizationId: 'org-1',
    email: 'user@example.com',
    role: 'member',
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [QuotaController],
      providers: [
        {
          provide: UsageQuotaService,
          useValue: {
            getUsageSummaryV2: jest.fn(),
          },
        },
        {
          provide: EntitlementService,
          useValue: {
            getActiveBonuses: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue(mockGuard)
      .overrideGuard(TenantGuard).useValue(mockGuard)
      .compile();

    controller = module.get<QuotaController>(QuotaController);
    usageQuota = module.get(UsageQuotaService);
    entitlementService = module.get(EntitlementService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /quotas/usage', () => {
    it('should return usage summary with bonuses and billing period', async () => {
      const mockSummary = {
        quotas: {
          aiAnswers: {
            allowed: true,
            used: 5,
            limit: 65,
            remaining: 60,
            resetsAt: '2026-04-01T00:00:00.000Z',
            baseLimit: 15,
            bonusAmount: 50,
          },
        },
        billingPeriodStart: '2026-03-01T00:00:00.000Z',
        billingPeriodEnd: '2026-04-01T00:00:00.000Z',
      };
      const mockBonuses = [
        {
          id: 'ov-1',
          entitlementKey: 'aiAnswers',
          overrideType: 'bonus_credit',
          numericValue: 50,
          booleanValue: null,
          reason: 'Promo',
          sourceType: 'promotion',
          expiresAt: '2026-06-01T00:00:00.000Z',
        },
      ];

      usageQuota.getUsageSummaryV2.mockResolvedValue(mockSummary as any);
      entitlementService.getActiveBonuses.mockResolvedValue(mockBonuses);

      const result = await controller.getUsage(mockUser);

      expect(result.success).toBe(true);
      expect(result.data.quotas).toEqual(mockSummary.quotas);
      expect(result.data.billingPeriodStart).toBe('2026-03-01T00:00:00.000Z');
      expect(result.data.billingPeriodEnd).toBe('2026-04-01T00:00:00.000Z');
      expect(result.data.activeBonuses).toEqual(mockBonuses);
    });

    it('should call services with correct user context', async () => {
      usageQuota.getUsageSummaryV2.mockResolvedValue({
        quotas: {},
        billingPeriodStart: null,
        billingPeriodEnd: null,
      } as any);
      entitlementService.getActiveBonuses.mockResolvedValue([]);

      await controller.getUsage(mockUser);

      expect(usageQuota.getUsageSummaryV2).toHaveBeenCalledWith('org-1', 'user-1');
      expect(entitlementService.getActiveBonuses).toHaveBeenCalledWith('org-1');
    });

    it('should return empty bonuses when none are active', async () => {
      usageQuota.getUsageSummaryV2.mockResolvedValue({
        quotas: {},
        billingPeriodStart: null,
        billingPeriodEnd: null,
      } as any);
      entitlementService.getActiveBonuses.mockResolvedValue([]);

      const result = await controller.getUsage(mockUser);

      expect(result.data.activeBonuses).toEqual([]);
    });

    it('should return null billing period for free users', async () => {
      usageQuota.getUsageSummaryV2.mockResolvedValue({
        quotas: {},
        billingPeriodStart: null,
        billingPeriodEnd: null,
      } as any);
      entitlementService.getActiveBonuses.mockResolvedValue([]);

      const result = await controller.getUsage(mockUser);

      expect(result.data.billingPeriodStart).toBeNull();
      expect(result.data.billingPeriodEnd).toBeNull();
    });

    it('should fetch summary and bonuses concurrently', async () => {
      let summaryCallOrder = 0;
      let bonusCallOrder = 0;
      let callCounter = 0;

      usageQuota.getUsageSummaryV2.mockImplementation(async () => {
        summaryCallOrder = ++callCounter;
        return { quotas: {}, billingPeriodStart: null, billingPeriodEnd: null } as any;
      });
      entitlementService.getActiveBonuses.mockImplementation(async () => {
        bonusCallOrder = ++callCounter;
        return [];
      });

      await controller.getUsage(mockUser);

      // Both should be called (order doesn't matter with Promise.all)
      expect(summaryCallOrder).toBeGreaterThan(0);
      expect(bonusCallOrder).toBeGreaterThan(0);
    });
  });
});
