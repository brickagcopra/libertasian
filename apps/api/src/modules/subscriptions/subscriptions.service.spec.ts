import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { FeatureFlagService } from '../feature-flags/feature-flags.service';
import { PlansService } from '../plans/plans.service';
import {
  ACCESSIBLE_STATE_VALUES,
  SubscriptionState,
} from './subscription-state-machine';
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

  /**
   * Prisma double that actually HONOURS the status filter, in both the old
   * (`status: 'active'`) and new (`status: { in: [...] }`) shapes. Without
   * this the per-state tests below would pass against the buggy query too.
   * Rows are supplied in createdAt-desc order; the first match wins.
   */
  const withRows = (...rows: Array<Record<string, unknown>>) => {
    (prisma.subscription.findFirst as jest.Mock).mockImplementation(
      ({ where }: { where: { status?: string | { in?: string[] } } }) => {
        const filter = where.status;
        const allows = (s: string) =>
          typeof filter === 'string' ? filter === s : (filter?.in?.includes(s) ?? true);
        return Promise.resolve(rows.find((r) => allows(r['status'] as string)) ?? null);
      },
    );
  };

  // ---- getActiveSubscription ----

  describe('getActiveSubscription', () => {
    it('should return active subscription for org', async () => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(mockSubscription);

      const result = await service.getActiveSubscription('org-1');

      expect(result).toEqual(mockSubscription);
      expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          status: { in: ACCESSIBLE_STATE_VALUES },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
    });

    it('never treats a provisioning row as accessible', async () => {
      withRows({ ...mockSubscription, status: SubscriptionState.PROVISIONING });

      await expect(service.getActiveSubscription('org-1')).resolves.toBeNull();
    });

    it('should return null when no accessible subscription', async () => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getActiveSubscription('org-no-sub');
      expect(result).toBeNull();
    });
  });

  // ---- hasAccessibleSubscription ----

  describe('hasAccessibleSubscription', () => {
    it('is true when an accessible row exists', async () => {
      withRows({ ...mockSubscription, status: SubscriptionState.CANCELLING });

      await expect(service.hasAccessibleSubscription('org-1')).resolves.toBe(true);
    });

    it('is false when the only row is in a non-accessible state', async () => {
      withRows({ ...mockSubscription, status: SubscriptionState.CANCELLED });

      await expect(service.hasAccessibleSubscription('org-1')).resolves.toBe(false);
    });
  });

  // ---- getPlanCode ----

  describe('getPlanCode', () => {
    it('should return plan code from active subscription', async () => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(mockSubscription);

      const code = await service.getPlanCode('org-1');
      expect(code).toBe('pro');
    });

    // REGRESSION: with the query filtering on the literal string 'active',
    // every state below except ACTIVE resolved to 'free'.
    it.each([
      SubscriptionState.TRIALING,
      SubscriptionState.ACTIVE,
      SubscriptionState.PAST_DUE,
      SubscriptionState.GRACE_PERIOD,
      SubscriptionState.CANCELLING,
      SubscriptionState.COMPLIMENTARY,
      SubscriptionState.MIGRATING,
    ])('resolves a %s subscription to its own plan code, not free', async (status) => {
      withRows({ ...mockSubscription, status });

      await expect(service.getPlanCode('org-1')).resolves.toBe('pro');
    });

    it('keeps the paid tier for a CANCELLING sub until currentPeriodEnd', async () => {
      // Access is time-bounded by the `cancellation_end` lifecycle event, which
      // flips CANCELLING -> CANCELLED at currentPeriodEnd. Before it fires the
      // row is accessible; after it fires the status no longer is.
      const periodEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      withRows({
        ...mockSubscription,
        status: SubscriptionState.CANCELLING,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: periodEnd,
      });
      await expect(service.getPlanCode('org-1')).resolves.toBe('pro');

      // ...and once cancellation_end has run, it drops to free.
      withRows({
        ...mockSubscription,
        status: SubscriptionState.CANCELLED,
        currentPeriodEnd: periodEnd,
      });
      await expect(service.getPlanCode('org-1')).resolves.toBe('free');
    });

    // Guards prod org 0ead67bb (App Store reviewer demo): a complimentary pro
    // row sitting above two older active free rows on the same org.
    it('keeps a complimentary row above older free rows on the same org', async () => {
      withRows(
        { ...mockSubscription, id: 'sub-comp', planCode: 'pro', status: SubscriptionState.COMPLIMENTARY },
        { ...mockSubscription, id: 'sub-free-1', planCode: 'free', status: SubscriptionState.ACTIVE },
        { ...mockSubscription, id: 'sub-free-2', planCode: 'free', status: SubscriptionState.ACTIVE },
      );

      await expect(service.getPlanCode('org-reviewer')).resolves.toBe('pro');
    });

    // The EXACT prod shape of the reviewer demo account: sub 6741e44f is
    // status='active' + plan_code='pro' (NOT 'complimentary'), sitting above
    // two older active free rows on org 0ead67bb. Any ordering refactor that
    // breaks the go-live key swap must fail here.
    it('keeps the reviewer demo row (active pro) above its older active free rows', async () => {
      withRows(
        {
          ...mockSubscription,
          id: '6741e44f-7445-4347-869e-550b9845be3f',
          organizationId: '0ead67bb-d7a0-45a6-9d0c-723cfe98f839',
          planCode: 'pro',
          status: SubscriptionState.ACTIVE,
          xenditSubscriptionId: null,
          currentPeriodEnd: new Date('2030-01-01'),
        },
        { ...mockSubscription, id: 'sub-free-old-1', planCode: 'free', status: SubscriptionState.ACTIVE },
        { ...mockSubscription, id: 'sub-free-old-2', planCode: 'free', status: SubscriptionState.ACTIVE },
      );

      await expect(
        service.getPlanCode('0ead67bb-d7a0-45a6-9d0c-723cfe98f839'),
      ).resolves.toBe('pro');
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
      expect(ent.documentUploadsPerMonth).toBe(0);
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
      expect(ent.documentUploadsPerMonth).toBe(0);
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
      expect(ent.documentUploadsPerMonth).toBe(-1); // unlimited
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
      expect(ent.documentUploadsPerMonth).toBe(-1);
      expect(ent.maxResearchWorkspaces).toBe(20);
    });

    it('should return enterprise tier defaults', () => {
      const ent = service.getDefaultEntitlements('enterprise');
      expect(ent.editorialTools).toBe(true);
      expect(ent.maxApiKeys).toBe(10);
      expect(ent.hearingPrepPerMonth).toBe(-1);
      expect(ent.contradictionDetectionPerMonth).toBe(-1);
      expect(ent.documentUploadsPerMonth).toBe(-1);
      expect(ent.maxResearchWorkspaces).toBe(-1);
    });

    it('should fallback to free for unknown plan code', () => {
      const ent = service.getDefaultEntitlements('platinum');
      expect(ent.aiAnswers).toBe(15);
      expect(ent.searchQueries).toBe(50);
    });

    describe('previewOnly entitlement', () => {
      it('is true for free plan', () => {
        expect(service.getDefaultEntitlements('free').previewOnly).toBe(true);
      });

      it('is false for edu plan', () => {
        expect(service.getDefaultEntitlements('edu').previewOnly).toBe(false);
      });

      it('is false for pro plan', () => {
        expect(service.getDefaultEntitlements('pro').previewOnly).toBe(false);
      });

      it('is false for team plan', () => {
        expect(service.getDefaultEntitlements('team').previewOnly).toBe(false);
      });

      it('is false for enterprise plan', () => {
        expect(service.getDefaultEntitlements('enterprise').previewOnly).toBe(false);
      });

      it('falls back to free=true for unknown plan codes', () => {
        expect(service.getDefaultEntitlements('platinum').previewOnly).toBe(true);
      });
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
