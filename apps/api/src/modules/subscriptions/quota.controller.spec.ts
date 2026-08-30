import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { QuotaController } from './quota.controller';
import { UsageQuotaService } from './usage-quota.service';
import { EntitlementService } from './entitlement.service';

describe('QuotaController', () => {
  let controller: QuotaController;
  let usageQuota: jest.Mocked<Pick<UsageQuotaService, 'getUsageSummaryV2'>>;
  let entitlementService: jest.Mocked<
    Pick<EntitlementService, 'getActiveBonuses' | 'resolveEffectiveEntitlements'>
  >;

  const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

  /** D14 flags, per platform. Both false unless a test says otherwise. */
  let storeAvailable: Record<string, boolean>;

  const mockUser = {
    sub: 'user-1',
    organizationId: 'org-1',
    email: 'user@example.com',
    role: 'member',
  } as any;

  beforeEach(async () => {
    storeAvailable = {
      STORE_PURCHASE_AVAILABLE_IOS: false,
      STORE_PURCHASE_AVAILABLE_ANDROID: false,
    };

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
            resolveEffectiveEntitlements: jest
              .fn()
              .mockResolvedValue({ previewOnly: false }),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => storeAvailable[key]) },
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

    /**
     * `previewOnly` is the whole reason this field exists: clients were
     * otherwise inferring it from quota numbers, and an inference is wrong the
     * moment a plan has generation quotas but no corpus entitlement.
     */
    describe('previewOnly', () => {
      const withEntitlements = (previewOnly: boolean | undefined) => {
        usageQuota.getUsageSummaryV2.mockResolvedValue({
          quotas: {},
          billingPeriodStart: null,
          billingPeriodEnd: null,
        } as any);
        entitlementService.getActiveBonuses.mockResolvedValue([]);
        entitlementService.resolveEffectiveEntitlements.mockResolvedValue({
          previewOnly,
        } as any);
      };

      it('is true for a non-entitled org', async () => {
        withEntitlements(true);

        const result = await controller.getUsage(mockUser);

        expect(result.data.previewOnly).toBe(true);
      });

      it('is false for an entitled org', async () => {
        withEntitlements(false);

        const result = await controller.getUsage(mockUser);

        expect(result.data.previewOnly).toBe(false);
      });

      it('comes from resolveEffectiveEntitlements, not from quota values', async () => {
        // The exact case the old client-side inference gets wrong: positive
        // generation quotas on an account that still cannot read the paid
        // corpora. The flag must say true regardless of the numbers beside it.
        usageQuota.getUsageSummaryV2.mockResolvedValue({
          quotas: {
            cameraScansPerMonth: { limit: 25, used: 0 },
            digestsPerMonth: { limit: 100, used: 0 },
          },
          billingPeriodStart: null,
          billingPeriodEnd: null,
        } as any);
        entitlementService.getActiveBonuses.mockResolvedValue([]);
        entitlementService.resolveEffectiveEntitlements.mockResolvedValue({
          previewOnly: true,
        } as any);

        const result = await controller.getUsage(mockUser);

        expect(result.data.previewOnly).toBe(true);
        // `null` platform: this call passes no `x-platform` header, so the
        // controller resolves entitlements for the not-enforced variant.
        expect(entitlementService.resolveEffectiveEntitlements).toHaveBeenCalledWith(
          'org-1',
          null,
        );
      });

      it('defaults to false when the entitlement is absent', async () => {
        // Never fail closed on a missing field: an account wrongly marked
        // non-entitled loses surfaces it paid for.
        withEntitlements(undefined);

        const result = await controller.getUsage(mockUser);

        expect(result.data.previewOnly).toBe(false);
      });

      it('is false for a platform admin even on a non-entitled org', async () => {
        // Mirrors DocumentsController/SearchController.resolvePreviewOnly: an
        // admin whose client hid surfaces the API will serve them is a worse
        // outcome than an admin seeing everything.
        withEntitlements(true);

        const result = await controller.getUsage({
          ...mockUser,
          isPlatformAdmin: true,
        } as any);

        expect(result.data.previewOnly).toBe(false);
      });
    });

    it('should call services with correct user context', async () => {
      usageQuota.getUsageSummaryV2.mockResolvedValue({
        quotas: {},
        billingPeriodStart: null,
        billingPeriodEnd: null,
      } as any);
      entitlementService.getActiveBonuses.mockResolvedValue([]);

      await controller.getUsage(mockUser);

      expect(usageQuota.getUsageSummaryV2).toHaveBeenCalledWith('org-1', 'user-1', null);
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

  // ======================================================================
  // D14 mechanism C — storePurchaseAvailable
  // ======================================================================

  describe('storePurchaseAvailable', () => {
    beforeEach(() => {
      usageQuota.getUsageSummaryV2.mockResolvedValue({
        quotas: {},
        billingPeriodStart: null,
        billingPeriodEnd: null,
      } as never);
      entitlementService.getActiveBonuses.mockResolvedValue([] as never);
    });

    const available = async (platform?: string) =>
      (await controller.getUsage(mockUser, platform)).data.storePurchaseAvailable;

    it('DEFAULTS TO FALSE on every platform', async () => {
      // The whole point of the flag: the first IAP build ships behaving
      // identically to the approved one, so it is safe to submit while store
      // products are still in review. A `true` default would flip that on at
      // deploy time, offering a purchase for products that do not exist.
      expect(await available('ios')).toBe(false);
      expect(await available('android')).toBe(false);
    });

    it('is false for web, an absent header and an unknown platform', async () => {
      // None of these can purchase anything, and every older build sends no
      // header at all.
      expect(await available(undefined)).toBe(false);
      expect(await available('web')).toBe(false);
      expect(await available('windows')).toBe(false);
      expect(await available('')).toBe(false);
    });

    it('resolves PER PLATFORM, not globally', async () => {
      // An Android-approved / iOS-pending state is normal during a rollout, and
      // one flag would get it wrong for one of them.
      storeAvailable['STORE_PURCHASE_AVAILABLE_ANDROID'] = true;

      expect(await available('android')).toBe(true);
      expect(await available('ios')).toBe(false);
    });

    it('reads the platform case-insensitively', async () => {
      storeAvailable['STORE_PURCHASE_AVAILABLE_IOS'] = true;
      expect(await available('iOS')).toBe(true);
      expect(await available('IOS')).toBe(true);
    });

    it('is independent of previewOnly', async () => {
      // The client needs BOTH: previewOnly says whether the account is
      // entitled, this says whether it could buy its way in. Collapsing them
      // would lose the case the flag exists for — previewOnly true AND a
      // purchase available.
      storeAvailable['STORE_PURCHASE_AVAILABLE_IOS'] = true;
      entitlementService.resolveEffectiveEntitlements.mockResolvedValue({
        previewOnly: true,
      } as never);

      const res = await controller.getUsage(mockUser, 'ios');

      expect(res.data.previewOnly).toBe(true);
      expect(res.data.storePurchaseAvailable).toBe(true);
    });

    it('travels in the same response as previewOnly', async () => {
      // Two values that decide one rendering must not be able to disagree
      // because they arrived separately — the client persists one blob.
      const res = await controller.getUsage(mockUser, 'ios');

      expect(Object.keys(res.data)).toEqual(
        expect.arrayContaining(['previewOnly', 'storePurchaseAvailable']),
      );
    });
  });
});
