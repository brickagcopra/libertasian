import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { PromotionRuleEngineService } from './promotion-rule-engine.service';
import { PromotionService } from './promotion.service';

describe('PromotionService', () => {
  let service: PromotionService;
  let prisma: {
    promotion: { findUnique: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    promotionRedemption: { findUnique: jest.Mock; findMany: jest.Mock; count: jest.Mock; update: jest.Mock };
    promotionRule: { findMany: jest.Mock; deleteMany: jest.Mock; createMany: jest.Mock };
    promotionBenefit: { findMany: jest.Mock; deleteMany: jest.Mock; createMany: jest.Mock };
    promotionPlanRule: { findMany: jest.Mock; deleteMany: jest.Mock; createMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let audit: jest.Mocked<Pick<AuditService, 'log'>>;
  let entitlementService: jest.Mocked<Pick<EntitlementService, 'grantBonus'>>;
  let ruleEngine: jest.Mocked<
    Pick<
      PromotionRuleEngineService,
      'evaluatePromotion' | 'invalidateEligibleCache' | 'invalidatePricingCache'
    >
  >;
  let pricingEngine: jest.Mocked<Pick<PricingEngineService, 'resolvePlanPrice'>>;

  // ---- Hardcoded plan pricing for mock (centavos PHP) ----

  const PLAN_PRICING: Record<string, { monthly: number; annual: number; name: string }> = {
    free: { monthly: 0, annual: 0, name: 'Free' },
    edu: { monthly: 29900, annual: 299000, name: 'Edu' },
    pro: { monthly: 99900, annual: 999000, name: 'Pro' },
    team: { monthly: 249900, annual: 2499000, name: 'Team' },
    enterprise: { monthly: 499900, annual: 4999000, name: 'Enterprise' },
  };

  // ---- Fixtures ----

  const ORG_ID = '00000000-0000-0000-0000-000000000001';
  const USER_ID = '00000000-0000-0000-0000-000000000002';
  const PROMO_ID = '00000000-0000-0000-0000-000000000010';
  const REDEMPTION_ID = '00000000-0000-0000-0000-000000000020';
  const SUB_ID = '00000000-0000-0000-0000-000000000030';

  const makePromotion = (overrides: Record<string, unknown> = {}) => ({
    id: PROMO_ID,
    name: 'Summer Sale',
    slug: 'summer-sale',
    description: '50% off all plans',
    internalNotes: null,
    promotionType: 'sale',
    status: 'active',
    priority: 10,
    startsAt: new Date('2025-06-01'),
    endsAt: new Date('2025-08-31'),
    maxRedemptions: null,
    maxRedemptionsPerOrg: 1,
    currentRedemptions: 0,
    isStackableWithCoupons: false,
    isStackableWithPromos: false,
    isDisplayedOnPricing: true,
    metadataJson: {},
    createdByUserId: USER_ID,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    rules: [],
    benefits: [
      {
        id: 'benefit-1',
        benefitType: 'percentage_discount',
        discountValue: 50,
        bonusEntitlementKey: null,
        bonusEntitlementValue: null,
        bonusDurationDays: null,
        trialExtensionDays: null,
        appliesToBillingPeriod: 'any',
      },
    ],
    ...overrides,
  });

  const makeRedemption = (overrides: Record<string, unknown> = {}) => ({
    id: REDEMPTION_ID,
    promotionId: PROMO_ID,
    organizationId: ORG_ID,
    userId: USER_ID,
    subscriptionId: null,
    paymentId: null,
    status: 'applied',
    discountAmountApplied: 49950,
    originalAmount: 99900,
    benefitsAppliedJson: [{ type: 'percentage_discount', value: 50, discountAmount: 49950 }],
    revokedAt: null,
    revokeReason: null,
    metadataJson: {},
    createdAt: new Date(),
    promotion: { id: PROMO_ID, name: 'Summer Sale' },
    ...overrides,
  });

  // ---- Setup ----

  beforeEach(async () => {
    const txMock = {
      promotion: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      promotionRedemption: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({
          id: REDEMPTION_ID,
          status: 'applied',
        }),
      },
      promotionRule: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      promotionBenefit: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      promotionPlanRule: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    prisma = {
      promotion: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      promotionRedemption: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      },
      promotionRule: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      promotionBenefit: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      promotionPlanRule: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => {
        txMock.promotion.findUnique.mockResolvedValue({
          currentRedemptions: 0,
          maxRedemptions: null,
          maxRedemptionsPerOrg: 1,
        });
        txMock.promotion.update.mockResolvedValue({});
        return fn(txMock);
      }),
    };

    audit = { log: jest.fn().mockResolvedValue(undefined) };
    entitlementService = { grantBonus: jest.fn().mockResolvedValue({}) };
    ruleEngine = {
      evaluatePromotion: jest.fn(),
      invalidateEligibleCache: jest.fn().mockResolvedValue(undefined),
      invalidatePricingCache: jest.fn().mockResolvedValue(undefined),
    };

    pricingEngine = {
      resolvePlanPrice: jest.fn().mockImplementation(
        async (planCode: string, billingPeriod: string) => {
          const pricing = PLAN_PRICING[planCode];
          if (!pricing) {
            throw new Error(`Invalid plan code: ${planCode}`);
          }
          const amount = billingPeriod === 'annual' ? pricing.annual : pricing.monthly;
          return {
            amount,
            planName: pricing.name,
            planId: null,
            currency: 'PHP',
            source: 'hardcoded' as const,
          };
        },
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromotionService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: EntitlementService, useValue: entitlementService },
        { provide: PromotionRuleEngineService, useValue: ruleEngine },
        { provide: PricingEngineService, useValue: pricingEngine },
      ],
    }).compile();

    service = module.get<PromotionService>(PromotionService);
  });

  // ---- findById ----

  describe('findById', () => {
    it('should return promotion with rules and benefits', async () => {
      const promo = makePromotion();
      prisma.promotion.findUnique.mockResolvedValue(promo);

      const result = await service.findById(PROMO_ID);

      expect(result.id).toBe(PROMO_ID);
      expect(result.name).toBe('Summer Sale');
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.promotion.findUnique.mockResolvedValue(null);

      await expect(service.findById(PROMO_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ---- findBySlug ----

  describe('findBySlug', () => {
    it('should return promotion by slug', async () => {
      const promo = makePromotion();
      prisma.promotion.findUnique.mockResolvedValue(promo);

      const result = await service.findBySlug('summer-sale');

      expect(result.slug).toBe('summer-sale');
    });

    it('should throw NotFoundException when slug not found', async () => {
      prisma.promotion.findUnique.mockResolvedValue(null);

      await expect(service.findBySlug('unknown')).rejects.toThrow(NotFoundException);
    });
  });

  // ---- list ----

  describe('list', () => {
    it('should return paginated results', async () => {
      const promos = [
        { ...makePromotion({ id: 'p1' }), _count: { redemptions: 0 } },
        { ...makePromotion({ id: 'p2' }), _count: { redemptions: 0 } },
      ];
      prisma.promotion.findMany.mockResolvedValue(promos);

      const result = await service.list({ limit: 20 });

      expect(result.data).toHaveLength(2);
      expect(result.hasNext).toBe(false);
    });

    it('should detect hasNext when more items exist', async () => {
      const promos = Array.from({ length: 21 }, (_, i) =>
        ({ ...makePromotion({ id: `p${i}` }), _count: { redemptions: 0 } }),
      );
      prisma.promotion.findMany.mockResolvedValue(promos);

      const result = await service.list({ limit: 20 });

      expect(result.data).toHaveLength(20);
      expect(result.hasNext).toBe(true);
      expect(result.nextCursor).toBe('p19');
    });

    it('should filter by status', async () => {
      prisma.promotion.findMany.mockResolvedValue([]);

      await service.list({ status: 'active' });

      expect(prisma.promotion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'active' }),
        }),
      );
    });

    it('should use cursor for pagination', async () => {
      prisma.promotion.findMany.mockResolvedValue([]);

      await service.list({ cursor: 'cursor-id', limit: 10 });

      expect(prisma.promotion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 1,
          cursor: { id: 'cursor-id' },
        }),
      );
    });
  });

  // ---- applyPromotion ----

  describe('applyPromotion', () => {
    it('should apply promotion successfully', async () => {
      ruleEngine.evaluatePromotion.mockResolvedValue({
        eligible: true,
        promotionId: PROMO_ID,
        ruleResults: [],
        errors: [],
      });
      prisma.promotion.findUnique.mockResolvedValue(makePromotion());

      const result = await service.applyPromotion({
        promotionId: PROMO_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        planCode: 'pro',
        billingPeriod: 'monthly',
      });

      expect(result.redemptionId).toBe(REDEMPTION_ID);
      expect(result.discountAmountApplied).toBe(49950);
      expect(result.originalAmount).toBe(99900);
    });

    it('should throw BadRequestException when not eligible', async () => {
      ruleEngine.evaluatePromotion.mockResolvedValue({
        eligible: false,
        promotionId: PROMO_ID,
        ruleResults: [],
        errors: ['Promotion has expired'],
      });

      await expect(
        service.applyPromotion({
          promotionId: PROMO_ID,
          organizationId: ORG_ID,
          userId: USER_ID,
          planCode: 'pro',
          billingPeriod: 'monthly',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when promotion not found after eligibility check', async () => {
      ruleEngine.evaluatePromotion.mockResolvedValue({
        eligible: true,
        promotionId: PROMO_ID,
        ruleResults: [],
        errors: [],
      });
      prisma.promotion.findUnique.mockResolvedValue(null);

      await expect(
        service.applyPromotion({
          promotionId: PROMO_ID,
          organizationId: ORG_ID,
          userId: USER_ID,
          planCode: 'pro',
          billingPeriod: 'monthly',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should grant bonus entitlements for bonus_credit benefits', async () => {
      ruleEngine.evaluatePromotion.mockResolvedValue({
        eligible: true,
        promotionId: PROMO_ID,
        ruleResults: [],
        errors: [],
      });

      const promo = makePromotion({
        benefits: [
          {
            id: 'b-1',
            benefitType: 'bonus_credit',
            discountValue: null,
            bonusEntitlementKey: 'aiAnswers',
            bonusEntitlementValue: 100,
            bonusDurationDays: 30,
            trialExtensionDays: null,
            appliesToBillingPeriod: 'any',
          },
        ],
      });
      prisma.promotion.findUnique.mockResolvedValue(promo);

      await service.applyPromotion({
        promotionId: PROMO_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        planCode: 'pro',
        billingPeriod: 'monthly',
      });

      expect(entitlementService.grantBonus).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          entitlementKey: 'aiAnswers',
          numericValue: 100,
          sourceType: 'promotion',
          sourceId: PROMO_ID,
        }),
      );
    });

    it('should log audit event on successful application', async () => {
      ruleEngine.evaluatePromotion.mockResolvedValue({
        eligible: true,
        promotionId: PROMO_ID,
        ruleResults: [],
        errors: [],
      });
      prisma.promotion.findUnique.mockResolvedValue(makePromotion());

      await service.applyPromotion({
        promotionId: PROMO_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        planCode: 'pro',
        billingPeriod: 'monthly',
      });

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'promotion.applied',
          entityType: 'PromotionRedemption',
        }),
      );
    });

    it('should invalidate eligible cache after application', async () => {
      ruleEngine.evaluatePromotion.mockResolvedValue({
        eligible: true,
        promotionId: PROMO_ID,
        ruleResults: [],
        errors: [],
      });
      prisma.promotion.findUnique.mockResolvedValue(makePromotion());

      await service.applyPromotion({
        promotionId: PROMO_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        planCode: 'pro',
        billingPeriod: 'monthly',
      });

      expect(ruleEngine.invalidateEligibleCache).toHaveBeenCalledWith(ORG_ID);
    });

    it('should cap discount at original amount', async () => {
      ruleEngine.evaluatePromotion.mockResolvedValue({
        eligible: true,
        promotionId: PROMO_ID,
        ruleResults: [],
        errors: [],
      });

      const promo = makePromotion({
        benefits: [
          {
            id: 'b-1',
            benefitType: 'percentage_discount',
            discountValue: 100,
            bonusEntitlementKey: null,
            bonusEntitlementValue: null,
            bonusDurationDays: null,
            trialExtensionDays: null,
            appliesToBillingPeriod: 'any',
          },
          {
            id: 'b-2',
            benefitType: 'fixed_discount',
            discountValue: 50000,
            bonusEntitlementKey: null,
            bonusEntitlementValue: null,
            bonusDurationDays: null,
            trialExtensionDays: null,
            appliesToBillingPeriod: 'any',
          },
        ],
      });
      prisma.promotion.findUnique.mockResolvedValue(promo);

      const result = await service.applyPromotion({
        promotionId: PROMO_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        planCode: 'pro',
        billingPeriod: 'monthly',
      });

      expect(result.discountAmountApplied).toBe(99900);
    });

    it('should skip benefits not matching billing period', async () => {
      ruleEngine.evaluatePromotion.mockResolvedValue({
        eligible: true,
        promotionId: PROMO_ID,
        ruleResults: [],
        errors: [],
      });

      const promo = makePromotion({
        benefits: [
          {
            id: 'b-1',
            benefitType: 'percentage_discount',
            discountValue: 50,
            bonusEntitlementKey: null,
            bonusEntitlementValue: null,
            bonusDurationDays: null,
            trialExtensionDays: null,
            appliesToBillingPeriod: 'annual',
          },
        ],
      });
      prisma.promotion.findUnique.mockResolvedValue(promo);

      const result = await service.applyPromotion({
        promotionId: PROMO_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        planCode: 'pro',
        billingPeriod: 'monthly',
      });

      expect(result.discountAmountApplied).toBe(0);
    });

    it('should handle trial_extension benefit type', async () => {
      ruleEngine.evaluatePromotion.mockResolvedValue({
        eligible: true,
        promotionId: PROMO_ID,
        ruleResults: [],
        errors: [],
      });

      const promo = makePromotion({
        benefits: [
          {
            id: 'b-1',
            benefitType: 'trial_extension',
            discountValue: null,
            bonusEntitlementKey: null,
            bonusEntitlementValue: null,
            bonusDurationDays: null,
            trialExtensionDays: 14,
            appliesToBillingPeriod: 'any',
          },
        ],
      });
      prisma.promotion.findUnique.mockResolvedValue(promo);

      const result = await service.applyPromotion({
        promotionId: PROMO_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        planCode: 'pro',
        billingPeriod: 'monthly',
      });

      expect(result.benefitsApplied).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'trial_extension', extensionDays: 14 }),
        ]),
      );
    });
  });

  // ---- revokeRedemption ----

  describe('revokeRedemption', () => {
    it('should revoke redemption successfully', async () => {
      prisma.promotionRedemption.findUnique.mockResolvedValue(makeRedemption());
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          promotionRedemption: { update: jest.fn() },
          promotion: { update: jest.fn() },
        };
        return fn(tx);
      });

      await service.revokeRedemption(REDEMPTION_ID, USER_ID, 'Customer request');

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'promotion.revoked',
          entityType: 'PromotionRedemption',
        }),
      );
    });

    it('should throw NotFoundException when redemption not found', async () => {
      prisma.promotionRedemption.findUnique.mockResolvedValue(null);

      await expect(
        service.revokeRedemption(REDEMPTION_ID, USER_ID, 'reason'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when already revoked', async () => {
      prisma.promotionRedemption.findUnique.mockResolvedValue(
        makeRedemption({ status: 'revoked' }),
      );

      await expect(
        service.revokeRedemption(REDEMPTION_ID, USER_ID, 'reason'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should invalidate eligible cache after revocation', async () => {
      prisma.promotionRedemption.findUnique.mockResolvedValue(makeRedemption());
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          promotionRedemption: { update: jest.fn() },
          promotion: { update: jest.fn() },
        };
        return fn(tx);
      });

      await service.revokeRedemption(REDEMPTION_ID, USER_ID, 'reason');

      expect(ruleEngine.invalidateEligibleCache).toHaveBeenCalledWith(ORG_ID);
    });
  });

  // ---- activateScheduledPromotions ----

  describe('activateScheduledPromotions', () => {
    it('should return 0 when no scheduled promotions', async () => {
      prisma.promotion.findMany.mockResolvedValue([]);

      const result = await service.activateScheduledPromotions();

      expect(result).toBe(0);
    });

    it('should activate scheduled promotions that have reached startsAt', async () => {
      prisma.promotion.findMany.mockResolvedValue([
        { id: 'p1', name: 'Promo 1' },
        { id: 'p2', name: 'Promo 2' },
      ]);
      prisma.promotion.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.activateScheduledPromotions();

      expect(result).toBe(2);
      expect(prisma.promotion.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'active' },
        }),
      );
    });

    it('should log audit event for each activated promotion', async () => {
      prisma.promotion.findMany.mockResolvedValue([
        { id: 'p1', name: 'Promo 1' },
      ]);
      prisma.promotion.updateMany.mockResolvedValue({ count: 1 });

      await service.activateScheduledPromotions();

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'promotion.activated',
          actorType: 'system',
        }),
      );
    });

    it('should invalidate pricing cache after activation', async () => {
      prisma.promotion.findMany.mockResolvedValue([
        { id: 'p1', name: 'Promo 1' },
      ]);
      prisma.promotion.updateMany.mockResolvedValue({ count: 1 });

      await service.activateScheduledPromotions();

      expect(ruleEngine.invalidatePricingCache).toHaveBeenCalled();
    });
  });

  // ---- expireEndedPromotions ----

  describe('expireEndedPromotions', () => {
    it('should return 0 when no expired promotions', async () => {
      prisma.promotion.findMany.mockResolvedValue([]);

      const result = await service.expireEndedPromotions();

      expect(result).toBe(0);
    });

    it('should expire active promotions that have passed endsAt', async () => {
      prisma.promotion.findMany.mockResolvedValue([
        { id: 'p1', name: 'Promo 1' },
      ]);
      prisma.promotion.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.expireEndedPromotions();

      expect(result).toBe(1);
      expect(prisma.promotion.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'expired' },
        }),
      );
    });

    it('should log audit event for each expired promotion', async () => {
      prisma.promotion.findMany.mockResolvedValue([
        { id: 'p1', name: 'Promo 1' },
        { id: 'p2', name: 'Promo 2' },
      ]);
      prisma.promotion.updateMany.mockResolvedValue({ count: 2 });

      await service.expireEndedPromotions();

      expect(audit.log).toHaveBeenCalledTimes(2);
    });

    it('should invalidate pricing cache after expiration', async () => {
      prisma.promotion.findMany.mockResolvedValue([
        { id: 'p1', name: 'Promo 1' },
      ]);
      prisma.promotion.updateMany.mockResolvedValue({ count: 1 });

      await service.expireEndedPromotions();

      expect(ruleEngine.invalidatePricingCache).toHaveBeenCalled();
    });
  });

  // ---- create ----

  describe('create', () => {
    it('should create a promotion with basic fields', async () => {
      prisma.promotion.findUnique.mockResolvedValue(null); // No duplicate slug
      const created = makePromotion({ status: 'draft' });
      prisma.promotion.create.mockResolvedValue(created);

      const result = await service.create({
        name: 'Summer Sale',
        slug: 'summer-sale',
        promotionType: 'sale',
      }, USER_ID);

      expect(result.id).toBe(PROMO_ID);
      expect(prisma.promotion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Summer Sale',
            slug: 'summer-sale',
            promotionType: 'sale',
            createdByUserId: USER_ID,
          }),
        }),
      );
    });

    it('should create promotion with rules and benefits', async () => {
      prisma.promotion.findUnique.mockResolvedValue(null);
      prisma.promotion.create.mockResolvedValue(makePromotion());

      await service.create({
        name: 'Summer Sale',
        slug: 'summer-sale',
        promotionType: 'sale',
        rules: [{ ruleType: 'date_range', configuration: {} }],
        benefits: [{ benefitType: 'percentage_discount', discountValue: 50 }],
      }, USER_ID);

      expect(prisma.promotion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            rules: expect.objectContaining({ create: expect.any(Array) }),
            benefits: expect.objectContaining({ create: expect.any(Array) }),
          }),
        }),
      );
    });

    it('should throw ConflictException for duplicate slug', async () => {
      prisma.promotion.findUnique.mockResolvedValue(makePromotion());

      await expect(
        service.create({ name: 'Test', slug: 'summer-sale', promotionType: 'sale' }, USER_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('should use default values for optional fields', async () => {
      prisma.promotion.findUnique.mockResolvedValue(null);
      prisma.promotion.create.mockResolvedValue(makePromotion({ status: 'draft' }));

      await service.create({
        name: 'Test Promo',
        slug: 'test-promo',
        promotionType: 'bonus',
      }, USER_ID);

      expect(prisma.promotion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'draft',
            priority: 0,
            maxRedemptionsPerOrg: 1,
            isStackableWithCoupons: false,
            isStackableWithPromos: false,
            isDisplayedOnPricing: false,
          }),
        }),
      );
    });
  });

  // ---- update ----

  describe('update', () => {
    it('should update promotion fields', async () => {
      prisma.promotion.findUnique.mockResolvedValue(makePromotion());
      prisma.promotion.update.mockResolvedValue(makePromotion({ name: 'Updated Sale' }));

      const result = await service.update(PROMO_ID, { name: 'Updated Sale' });

      expect(result.name).toBe('Updated Sale');
      expect(prisma.promotion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: PROMO_ID },
          data: expect.objectContaining({ name: 'Updated Sale' }),
        }),
      );
    });

    it('should throw NotFoundException when promotion not found', async () => {
      prisma.promotion.findUnique.mockResolvedValue(null);

      await expect(service.update(PROMO_ID, { name: 'Test' })).rejects.toThrow(NotFoundException);
    });

    it('should validate status transitions', async () => {
      prisma.promotion.findUnique.mockResolvedValue(makePromotion({ status: 'archived' }));

      await expect(
        service.update(PROMO_ID, { status: 'active' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow valid status transition', async () => {
      prisma.promotion.findUnique.mockResolvedValue(makePromotion({ status: 'active' }));
      prisma.promotion.update.mockResolvedValue(makePromotion({ status: 'paused' }));

      const result = await service.update(PROMO_ID, { status: 'paused' });

      expect(result.status).toBe('paused');
    });

    it('should invalidate pricing cache when display or status changes', async () => {
      prisma.promotion.findUnique.mockResolvedValue(makePromotion());
      prisma.promotion.update.mockResolvedValue(makePromotion({ isDisplayedOnPricing: false }));

      await service.update(PROMO_ID, { isDisplayedOnPricing: false });

      expect(ruleEngine.invalidatePricingCache).toHaveBeenCalled();
    });
  });

  // ---- archive ----

  describe('archive', () => {
    it('should archive a promotion', async () => {
      prisma.promotion.findUnique.mockResolvedValue(makePromotion({ status: 'active' }));
      prisma.promotion.update.mockResolvedValue(makePromotion({ status: 'archived' }));

      const result = await service.archive(PROMO_ID);

      expect(result.status).toBe('archived');
      expect(prisma.promotion.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'archived' } }),
      );
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.promotion.findUnique.mockResolvedValue(null);

      await expect(service.archive(PROMO_ID)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when already archived', async () => {
      prisma.promotion.findUnique.mockResolvedValue(makePromotion({ status: 'archived' }));

      await expect(service.archive(PROMO_ID)).rejects.toThrow(BadRequestException);
    });

    it('should invalidate pricing cache', async () => {
      prisma.promotion.findUnique.mockResolvedValue(makePromotion({ status: 'active' }));
      prisma.promotion.update.mockResolvedValue(makePromotion({ status: 'archived' }));

      await service.archive(PROMO_ID);

      expect(ruleEngine.invalidatePricingCache).toHaveBeenCalled();
    });
  });

  // ---- setStatus ----

  describe('setStatus', () => {
    it('should transition from draft to active', async () => {
      prisma.promotion.findUnique.mockResolvedValue(makePromotion({ status: 'draft' }));
      prisma.promotion.update.mockResolvedValue(makePromotion({ status: 'active' }));

      const result = await service.setStatus(PROMO_ID, 'active');

      expect(result.status).toBe('active');
    });

    it('should transition from active to paused', async () => {
      prisma.promotion.findUnique.mockResolvedValue(makePromotion({ status: 'active' }));
      prisma.promotion.update.mockResolvedValue(makePromotion({ status: 'paused' }));

      const result = await service.setStatus(PROMO_ID, 'paused');

      expect(result.status).toBe('paused');
    });

    it('should reject invalid transition', async () => {
      prisma.promotion.findUnique.mockResolvedValue(makePromotion({ status: 'expired' }));

      await expect(service.setStatus(PROMO_ID, 'active')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.promotion.findUnique.mockResolvedValue(null);

      await expect(service.setStatus(PROMO_ID, 'active')).rejects.toThrow(NotFoundException);
    });
  });

  // ---- findByIdWithStats ----

  describe('findByIdWithStats', () => {
    it('should return promotion with redemption stats', async () => {
      const promo = { ...makePromotion(), planRules: [], createdBy: { id: USER_ID, fullName: 'Test', email: 'test@test.com' }, _count: { redemptions: 5 } };
      prisma.promotion.findUnique.mockResolvedValue(promo);
      prisma.promotionRedemption.count
        .mockResolvedValueOnce(4)  // applied
        .mockResolvedValueOnce(1); // revoked

      const result = await service.findByIdWithStats(PROMO_ID);

      expect(result.stats.totalRedemptions).toBe(5);
      expect(result.stats.appliedCount).toBe(4);
      expect(result.stats.revokedCount).toBe(1);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.promotion.findUnique.mockResolvedValue(null);

      await expect(service.findByIdWithStats(PROMO_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ---- Enhanced list ----

  describe('list (enhanced)', () => {
    it('should support search by name', async () => {
      prisma.promotion.findMany.mockResolvedValue([]);

      await service.list({ search: 'summer' });

      expect(prisma.promotion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { name: { contains: 'summer', mode: 'insensitive' } },
            ]),
          }),
        }),
      );
    });

    it('should support status filter', async () => {
      prisma.promotion.findMany.mockResolvedValue([]);

      await service.list({ status: 'active' });

      expect(prisma.promotion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'active' }),
        }),
      );
    });

    it('should support promotionType filter', async () => {
      prisma.promotion.findMany.mockResolvedValue([]);

      await service.list({ promotionType: 'sale' });

      expect(prisma.promotion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ promotionType: 'sale' }),
        }),
      );
    });

    it('should support sortBy and sortDir', async () => {
      prisma.promotion.findMany.mockResolvedValue([]);

      await service.list({ sortBy: 'priority', sortDir: 'asc' });

      expect(prisma.promotion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { priority: 'asc' },
        }),
      );
    });

    it('should return hasNext and nextCursor', async () => {
      const items = Array.from({ length: 21 }, (_, i) => ({
        ...makePromotion({ id: `promo-${i}` }),
        _count: { redemptions: 0 },
      }));
      prisma.promotion.findMany.mockResolvedValue(items);

      const result = await service.list({ limit: 20 });

      expect(result.hasNext).toBe(true);
      expect(result.data).toHaveLength(20);
      expect(result.nextCursor).toBe('promo-19');
    });
  });

  // ---- getRedemptionHistory ----

  describe('getRedemptionHistory', () => {
    it('should return paginated redemptions', async () => {
      prisma.promotion.findUnique.mockResolvedValue({ id: PROMO_ID });
      const redemptions = [makeRedemption()];
      prisma.promotionRedemption.findMany.mockResolvedValue(redemptions);

      const result = await service.getRedemptionHistory(PROMO_ID, {});

      expect(result.data).toHaveLength(1);
      expect(result.hasNext).toBe(false);
    });

    it('should throw NotFoundException when promotion not found', async () => {
      prisma.promotion.findUnique.mockResolvedValue(null);

      await expect(
        service.getRedemptionHistory(PROMO_ID, {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should apply status filter', async () => {
      prisma.promotion.findUnique.mockResolvedValue({ id: PROMO_ID });
      prisma.promotionRedemption.findMany.mockResolvedValue([]);

      await service.getRedemptionHistory(PROMO_ID, { status: 'revoked' });

      expect(prisma.promotionRedemption.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'revoked' }),
        }),
      );
    });
  });

  // ---- setRules ----

  describe('setRules', () => {
    it('should replace all rules', async () => {
      prisma.promotion.findUnique.mockResolvedValue(makePromotion());
      const newRules = [{ ruleType: 'date_range', configuration: {}, ordering: 0, isActive: true }];
      prisma.promotionRule.findMany.mockResolvedValue(newRules);

      const result = await service.setRules(PROMO_ID, [
        { ruleType: 'date_range', configuration: {} },
      ]);

      expect(result).toEqual(newRules);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException when promotion not found', async () => {
      prisma.promotion.findUnique.mockResolvedValue(null);

      await expect(
        service.setRules(PROMO_ID, []),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---- setBenefits ----

  describe('setBenefits', () => {
    it('should replace all benefits', async () => {
      prisma.promotion.findUnique.mockResolvedValue(makePromotion());
      const newBenefits = [{ benefitType: 'percentage_discount', discountValue: 20 }];
      prisma.promotionBenefit.findMany.mockResolvedValue(newBenefits);

      const result = await service.setBenefits(PROMO_ID, [
        { benefitType: 'percentage_discount', discountValue: 20 },
      ]);

      expect(result).toEqual(newBenefits);
      expect(ruleEngine.invalidatePricingCache).toHaveBeenCalled();
    });

    it('should throw NotFoundException when promotion not found', async () => {
      prisma.promotion.findUnique.mockResolvedValue(null);

      await expect(
        service.setBenefits(PROMO_ID, []),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---- setPlanRules ----

  describe('setPlanRules', () => {
    it('should replace all plan rules', async () => {
      prisma.promotion.findUnique.mockResolvedValue(makePromotion());
      const newRules = [{ planCode: 'pro', ruleType: 'include' }];
      prisma.promotionPlanRule.findMany.mockResolvedValue(newRules);

      const result = await service.setPlanRules(PROMO_ID, [
        { planCode: 'pro', ruleType: 'include' },
      ]);

      expect(result).toEqual(newRules);
    });

    it('should throw NotFoundException when promotion not found', async () => {
      prisma.promotion.findUnique.mockResolvedValue(null);

      await expect(
        service.setPlanRules(PROMO_ID, []),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
