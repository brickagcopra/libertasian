import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { FeatureFlagService } from '../feature-flags/feature-flags.service';
import { PlansService } from '../plans/plans.service';
import { SubscriptionsService } from './subscriptions.service';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let prisma: jest.Mocked<PrismaService>;
  let plansService: jest.Mocked<PlansService>;
  let featureFlagService: jest.Mocked<FeatureFlagService>;

  const mockSubscription = {
    id: 'sub-1',
    organizationId: 'org-1',
    planCode: 'pro',
    status: 'active',
    billingPeriod: 'monthly',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(),
    seats: 1,
    entitlementsJson: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        {
          provide: PrismaService,
          useValue: {
            subscription: {
              findFirst: jest.fn(),
            },
          },
        },
        {
          provide: PlansService,
          useValue: {
            resolveEntitlements: jest.fn(),
          },
        },
        {
          provide: FeatureFlagService,
          useValue: {
            isEnabled: jest.fn().mockResolvedValue(false),
          },
        },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
    prisma = module.get(PrismaService);
    plansService = module.get(PlansService);
    featureFlagService = module.get(FeatureFlagService);
  });

  // ---- getActiveSubscription ----

  describe('getActiveSubscription', () => {
    it('should return active subscription for org', async () => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(mockSubscription);

      const result = await service.getActiveSubscription('org-1');

      expect(result).toEqual(mockSubscription);
      expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', status: 'active' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return null when no active subscription', async () => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getActiveSubscription('org-no-sub');
      expect(result).toBeNull();
    });
  });

  // ---- getPlanCode ----

  describe('getPlanCode', () => {
    it('should return plan code from active subscription', async () => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(mockSubscription);

      const code = await service.getPlanCode('org-1');
      expect(code).toBe('pro');
    });

    it('should default to free when no subscription', async () => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(null);

      const code = await service.getPlanCode('org-no-sub');
      expect(code).toBe('free');
    });
  });

  // ---- meetsMinimumTier (static) ----

  describe('meetsMinimumTier', () => {
    it('should pass when current equals required', () => {
      expect(SubscriptionsService.meetsMinimumTier('pro', 'pro')).toBe(true);
    });

    it('should pass when current exceeds required', () => {
      expect(SubscriptionsService.meetsMinimumTier('enterprise', 'edu')).toBe(true);
    });

    it('should fail when current below required', () => {
      expect(SubscriptionsService.meetsMinimumTier('free', 'pro')).toBe(false);
    });

    it('should handle full tier hierarchy correctly', () => {
      const tiers = ['free', 'edu', 'pro', 'team', 'enterprise'];
      for (let i = 0; i < tiers.length; i++) {
        for (let j = 0; j < tiers.length; j++) {
          const result = SubscriptionsService.meetsMinimumTier(tiers[i]!, tiers[j]!);
          expect(result).toBe(i >= j);
        }
      }
    });

    it('should treat unknown tiers as free (level 0)', () => {
      expect(SubscriptionsService.meetsMinimumTier('unknown', 'free')).toBe(true);
      expect(SubscriptionsService.meetsMinimumTier('unknown', 'edu')).toBe(false);
    });
  });

  // ---- getDefaultEntitlements ----

  describe('getDefaultEntitlements', () => {
    it('should return free tier defaults', () => {
      const ent = service.getDefaultEntitlements('free');
      expect(ent.aiAnswers).toBe(15);
      expect(ent.searchQueries).toBe(50);
      expect(ent.digestsPerMonth).toBe(3);
      expect(ent.cameraScansPerMonth).toBe(3);
      expect(ent.maxMatters).toBe(0);
      expect(ent.offlineReading).toBe(false);
      expect(ent.teamCollaboration).toBe(false);
      expect(ent.auditLogs).toBe(false);
      expect(ent.editorialTools).toBe(false);
      expect(ent.memoDraftingPerMonth).toBe(0);
      expect(ent.maxApiKeys).toBe(0);
    });

    it('should return edu tier defaults', () => {
      const ent = service.getDefaultEntitlements('edu');
      expect(ent.aiAnswers).toBe(100);
      expect(ent.searchQueries).toBe(-1); // unlimited
      expect(ent.digestsPerMonth).toBe(30);
      expect(ent.cameraScansPerMonth).toBe(10);
      expect(ent.offlineReading).toBe(true);
      expect(ent.teamCollaboration).toBe(false);
    });

    it('should return pro tier defaults', () => {
      const ent = service.getDefaultEntitlements('pro');
      expect(ent.aiAnswers).toBe(-1); // unlimited
      expect(ent.searchQueries).toBe(-1);
      expect(ent.digestsPerMonth).toBe(-1);
      expect(ent.cameraScansPerMonth).toBe(-1);
      expect(ent.maxMatters).toBe(20);
      expect(ent.memoDraftingPerMonth).toBe(20);
      expect(ent.pleadingAssistancePerMonth).toBe(10);
      expect(ent.maxResearchWorkspaces).toBe(3);
    });

    it('should return team tier defaults', () => {
      const ent = service.getDefaultEntitlements('team');
      expect(ent.maxMatters).toBe(-1); // unlimited
      expect(ent.teamCollaboration).toBe(true);
      expect(ent.auditLogs).toBe(true);
      expect(ent.editorialTools).toBe(false);
      expect(ent.hearingPrepPerMonth).toBe(10);
      expect(ent.contradictionDetectionPerMonth).toBe(5);
      expect(ent.maxResearchWorkspaces).toBe(20);
    });

    it('should return enterprise tier defaults', () => {
      const ent = service.getDefaultEntitlements('enterprise');
      expect(ent.editorialTools).toBe(true);
      expect(ent.maxApiKeys).toBe(10);
      expect(ent.hearingPrepPerMonth).toBe(-1);
      expect(ent.contradictionDetectionPerMonth).toBe(-1);
      expect(ent.maxResearchWorkspaces).toBe(-1);
    });

    it('should fallback to free for unknown plan code', () => {
      const ent = service.getDefaultEntitlements('platinum');
      expect(ent.aiAnswers).toBe(15);
      expect(ent.searchQueries).toBe(50);
    });
  });

  // ---- getEntitlements (flag OFF — hardcoded fallback) ----

  describe('getEntitlements (billing.db_plans OFF)', () => {
    beforeEach(() => {
      featureFlagService.isEnabled.mockResolvedValue(false);
    });

    it('should return free defaults when no subscription', async () => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(null);

      const ent = await service.getEntitlements('org-1');
      expect(ent.aiAnswers).toBe(15);
      expect(ent.searchQueries).toBe(50);
      expect(featureFlagService.isEnabled).toHaveBeenCalledWith(
        'billing.db_plans',
        'org-1',
        'free',
      );
    });

    it('should return plan defaults when entitlementsJson is empty', async () => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        planCode: 'edu',
        entitlementsJson: {},
      });

      const ent = await service.getEntitlements('org-1');
      expect(ent.aiAnswers).toBe(100);
      expect(ent.offlineReading).toBe(true);
    });

    it('should merge stored entitlements over plan defaults', async () => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        planCode: 'pro',
        entitlementsJson: { maxMatters: 50, aiAnswers: 500 },
      });

      const ent = await service.getEntitlements('org-1');
      // Overridden values
      expect(ent.maxMatters).toBe(50);
      expect(ent.aiAnswers).toBe(500);
      // Non-overridden defaults preserved
      expect(ent.searchQueries).toBe(-1);
      expect(ent.offlineReading).toBe(true);
    });

    it('should handle null entitlementsJson gracefully', async () => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        planCode: 'team',
        entitlementsJson: null,
      });

      const ent = await service.getEntitlements('org-1');
      expect(ent.teamCollaboration).toBe(true);
      expect(ent.auditLogs).toBe(true);
    });

    it('should NOT call plansService when flag is OFF', async () => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(mockSubscription);

      await service.getEntitlements('org-1');
      expect(plansService.resolveEntitlements).not.toHaveBeenCalled();
    });
  });

  // ---- getEntitlements (flag ON — DB resolution) ----

  describe('getEntitlements (billing.db_plans ON)', () => {
    beforeEach(() => {
      featureFlagService.isEnabled.mockResolvedValue(true);
    });

    it('should resolve entitlements from DB when flag is ON', async () => {
      const dbEntitlements = {
        aiAnswers: -1,
        searchQueries: -1,
        digestsPerMonth: -1,
        maxMatters: 25,
        offlineReading: true,
      };
      plansService.resolveEntitlements.mockResolvedValue(dbEntitlements);
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        planCode: 'pro',
        entitlementsJson: {},
      });

      const ent = await service.getEntitlements('org-1');
      expect(plansService.resolveEntitlements).toHaveBeenCalledWith('pro');
      expect(ent.maxMatters).toBe(25);
      expect(ent.aiAnswers).toBe(-1);
    });

    it('should merge subscription overrides on top of DB entitlements', async () => {
      const dbEntitlements = {
        aiAnswers: -1,
        maxMatters: 20,
      };
      plansService.resolveEntitlements.mockResolvedValue(dbEntitlements);
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        planCode: 'pro',
        entitlementsJson: { maxMatters: 50 },
      });

      const ent = await service.getEntitlements('org-1');
      expect(ent.maxMatters).toBe(50); // Override wins
      expect(ent.aiAnswers).toBe(-1); // DB value preserved
    });

    it('should fallback to hardcoded when DB resolution fails', async () => {
      plansService.resolveEntitlements.mockRejectedValue(new Error('Plan not found'));
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        planCode: 'pro',
        entitlementsJson: {},
      });

      const ent = await service.getEntitlements('org-1');
      // Should fall back to hardcoded pro defaults
      expect(ent.aiAnswers).toBe(-1);
      expect(ent.maxMatters).toBe(20);
    });

    it('should use DB free defaults when no subscription and flag is ON', async () => {
      const dbFreeEntitlements = {
        aiAnswers: 10, // Different from hardcoded 15 — proves DB was used
        searchQueries: 40,
      };
      plansService.resolveEntitlements.mockResolvedValue(dbFreeEntitlements);
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(null);

      const ent = await service.getEntitlements('org-1');
      expect(plansService.resolveEntitlements).toHaveBeenCalledWith('free');
      expect(ent.aiAnswers).toBe(10);
      expect(ent.searchQueries).toBe(40);
    });
  });
});
