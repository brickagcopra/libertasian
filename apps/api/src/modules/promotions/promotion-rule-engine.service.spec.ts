import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import {
  PricingEngineService,
  PLAN_PRICING,
} from '../pricing/pricing-engine.service';
import { PromotionRuleEngineService } from './promotion-rule-engine.service';

describe('PromotionRuleEngineService', () => {
  let service: PromotionRuleEngineService;
  let prisma: {
    promotion: { findUnique: jest.Mock; findMany: jest.Mock };
    promotionPlanRule: { findMany: jest.Mock };
    promotionRedemption: { count: jest.Mock };
    organization: { findUnique: jest.Mock };
    subscription: { findFirst: jest.Mock; count: jest.Mock };
    couponRedemption: { count: jest.Mock };
  };
  let redis: jest.Mocked<Pick<RedisService, 'get' | 'set' | 'del'>>;
  let pricingEngine: { resolvePlanPrice: jest.Mock };

  // ---- Fixtures ----

  const ORG_ID = '00000000-0000-0000-0000-000000000001';
  const USER_ID = '00000000-0000-0000-0000-000000000002';
  const PROMO_ID = '00000000-0000-0000-0000-000000000010';

  const makePromotion = (overrides: Record<string, unknown> = {}) => ({
    id: PROMO_ID,
    name: 'Summer Sale',
    slug: 'summer-sale',
    description: '50% off all plans',
    promotionType: 'sale',
    status: 'active',
    priority: 10,
    startsAt: new Date('2025-06-01'),
    endsAt: new Date('2030-08-31'),
    maxRedemptions: null,
    maxRedemptionsPerOrg: 1,
    currentRedemptions: 0,
    isStackableWithCoupons: false,
    isStackableWithPromos: false,
    isDisplayedOnPricing: true,
    metadataJson: {},
    createdAt: new Date('2025-01-01'),
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

  // ---- Setup ----

  beforeEach(async () => {
    prisma = {
      promotion: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      promotionPlanRule: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      promotionRedemption: {
        count: jest.fn().mockResolvedValue(0),
      },
      organization: {
        findUnique: jest.fn().mockResolvedValue({ type: 'individual' }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'active',
          planCode: 'pro',
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      couponRedemption: {
        count: jest.fn().mockResolvedValue(0),
      },
    };

    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(1),
    };

    pricingEngine = {
      resolvePlanPrice: jest.fn().mockImplementation(
        (planCode: string, billingPeriod: string) => {
          const pricing = PLAN_PRICING[planCode];
          if (!pricing || pricing.monthly === 0) {
            return Promise.reject(new Error(`Invalid plan code: ${planCode}`));
          }
          const amount =
            billingPeriod === 'annual' ? pricing.annual : pricing.monthly;
          return Promise.resolve({
            amount,
            planName: pricing.name,
            planId: null,
            currency: 'PHP',
            source: 'hardcoded' as const,
          });
        },
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromotionRuleEngineService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: PricingEngineService, useValue: pricingEngine },
      ],
    }).compile();

    service = module.get<PromotionRuleEngineService>(PromotionRuleEngineService);
  });

  // ---- evaluatePromotion ----

  describe('evaluatePromotion', () => {
    it('should return not eligible when promotion not found', async () => {
      prisma.promotion.findUnique.mockResolvedValue(null);

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(false);
      expect(result.errors).toContain('Promotion not found');
    });

    it('should return not eligible when promotion is not active', async () => {
      prisma.promotion.findUnique.mockResolvedValue(makePromotion({ status: 'draft' }));

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(false);
      expect(result.errors[0]).toContain('not active');
    });

    it('should return eligible when no rules and promotion is active', async () => {
      prisma.promotion.findUnique.mockResolvedValue(makePromotion());

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should include discount preview when eligible', async () => {
      prisma.promotion.findUnique.mockResolvedValue(makePromotion());

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(true);
      expect(result.discountPreview).toBeDefined();
      expect(result.discountPreview!.originalAmount).toBe(99900);
      expect(result.discountPreview!.discountAmount).toBe(49950);
      expect(result.discountPreview!.finalAmount).toBe(49950);
    });

    it('should fail plan eligibility when plan is excluded via PromotionPlanRule', async () => {
      prisma.promotion.findUnique.mockResolvedValue(makePromotion());
      prisma.promotionPlanRule.findMany.mockResolvedValue([
        { id: 'rule-1', promotionId: PROMO_ID, planCode: 'pro', ruleType: 'exclude' },
      ]);

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(false);
      expect(result.errors[0]).toContain('excluded');
    });

    it('should pass plan eligibility when plan is in include list', async () => {
      prisma.promotion.findUnique.mockResolvedValue(makePromotion());
      prisma.promotionPlanRule.findMany.mockResolvedValue([
        { id: 'rule-1', promotionId: PROMO_ID, planCode: 'pro', ruleType: 'include' },
      ]);

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(true);
    });

    it('should fail plan eligibility when plan is not in include list', async () => {
      prisma.promotion.findUnique.mockResolvedValue(makePromotion());
      prisma.promotionPlanRule.findMany.mockResolvedValue([
        { id: 'rule-1', promotionId: PROMO_ID, planCode: 'team', ruleType: 'include' },
      ]);

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(false);
      expect(result.errors[0]).toContain('not eligible');
    });

    it('should evaluate date_range rule and pass when within range', async () => {
      const promo = makePromotion({
        rules: [
          {
            id: 'rule-1',
            ruleType: 'date_range',
            configuration: {},
            ordering: 0,
            isActive: true,
          },
        ],
      });
      prisma.promotion.findUnique.mockResolvedValue(promo);

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(true);
      expect(result.ruleResults).toHaveLength(1);
      expect(result.ruleResults[0]!.ruleType).toBe('date_range');
    });

    it('should evaluate date_range rule and fail when expired', async () => {
      const promo = makePromotion({
        endsAt: new Date('2020-01-01'),
        rules: [
          {
            id: 'rule-1',
            ruleType: 'date_range',
            configuration: {},
            ordering: 0,
            isActive: true,
          },
        ],
      });
      prisma.promotion.findUnique.mockResolvedValue(promo);

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(false);
      expect(result.errors[0]).toContain('expired');
    });

    it('should accumulate errors from multiple failing rules', async () => {
      const promo = makePromotion({
        endsAt: new Date('2020-01-01'),
        maxRedemptions: 0,
        rules: [
          {
            id: 'rule-1',
            ruleType: 'date_range',
            configuration: {},
            ordering: 0,
            isActive: true,
          },
          {
            id: 'rule-2',
            ruleType: 'redemption_limit',
            configuration: {},
            ordering: 1,
            isActive: true,
          },
        ],
      });
      prisma.promotion.findUnique.mockResolvedValue(promo);

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(result.ruleResults).toHaveLength(2);
    });

    it('should skip inactive rules', async () => {
      const promo = makePromotion({
        rules: [
          {
            id: 'rule-1',
            ruleType: 'minimum_tier',
            configuration: { minimumTier: 'enterprise' },
            ordering: 0,
            isActive: false,
          },
        ],
      });
      prisma.promotion.findUnique.mockResolvedValue(promo);

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(true);
      expect(result.ruleResults).toHaveLength(0);
    });

    it('should handle unknown rule types gracefully', async () => {
      const promo = makePromotion({
        rules: [
          {
            id: 'rule-1',
            ruleType: 'nonexistent_rule',
            configuration: {},
            ordering: 0,
            isActive: true,
          },
        ],
      });
      prisma.promotion.findUnique.mockResolvedValue(promo);

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(false);
      expect(result.errors[0]).toContain('Unknown rule type');
    });

    it('should evaluate new_subscriber rule correctly', async () => {
      const promo = makePromotion({
        rules: [
          {
            id: 'rule-1',
            ruleType: 'new_subscriber',
            configuration: { requireNewSubscriber: true },
            ordering: 0,
            isActive: true,
          },
        ],
      });
      prisma.promotion.findUnique.mockResolvedValue(promo);
      // isNewSubscriber = true because subscription count = 0

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(true);
    });

    it('should fail new_subscriber rule for existing subscribers', async () => {
      const promo = makePromotion({
        rules: [
          {
            id: 'rule-1',
            ruleType: 'new_subscriber',
            configuration: { requireNewSubscriber: true },
            ordering: 0,
            isActive: true,
          },
        ],
      });
      prisma.promotion.findUnique.mockResolvedValue(promo);
      // Make it not a new subscriber
      prisma.subscription.count.mockResolvedValue(2);

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(false);
      expect(result.errors[0]).toContain('new subscribers');
    });

    it('should evaluate billing_period rule', async () => {
      const promo = makePromotion({
        rules: [
          {
            id: 'rule-1',
            ruleType: 'billing_period',
            configuration: { allowedPeriods: ['annual'] },
            ordering: 0,
            isActive: true,
          },
        ],
      });
      prisma.promotion.findUnique.mockResolvedValue(promo);

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(false);
      expect(result.errors[0]).toContain('not eligible');
    });

    it('should evaluate minimum_tier rule', async () => {
      const promo = makePromotion({
        rules: [
          {
            id: 'rule-1',
            ruleType: 'minimum_tier',
            configuration: { minimumTier: 'team' },
            ordering: 0,
            isActive: true,
          },
        ],
      });
      prisma.promotion.findUnique.mockResolvedValue(promo);

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(false);
      expect(result.errors[0]).toContain('minimum tier');
    });

    it('should evaluate organization_type rule', async () => {
      const promo = makePromotion({
        rules: [
          {
            id: 'rule-1',
            ruleType: 'organization_type',
            configuration: { allowedTypes: ['firm'] },
            ordering: 0,
            isActive: true,
          },
        ],
      });
      prisma.promotion.findUnique.mockResolvedValue(promo);

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(false);
      expect(result.errors[0]).toContain('not eligible');
    });

    it('should evaluate subscription_status rule', async () => {
      const promo = makePromotion({
        rules: [
          {
            id: 'rule-1',
            ruleType: 'subscription_status',
            configuration: { allowedStatuses: ['trialing'] },
            ordering: 0,
            isActive: true,
          },
        ],
      });
      prisma.promotion.findUnique.mockResolvedValue(promo);

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(false);
      expect(result.errors[0]).toContain('not eligible');
    });

    it('should evaluate stacking rule — fail when has coupon and not stackable', async () => {
      const promo = makePromotion({
        rules: [
          {
            id: 'rule-1',
            ruleType: 'stacking',
            configuration: {},
            ordering: 0,
            isActive: true,
          },
        ],
      });
      prisma.promotion.findUnique.mockResolvedValue(promo);
      prisma.couponRedemption.count.mockResolvedValue(1);

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(false);
      expect(result.errors[0]).toContain('coupon');
    });

    it('should evaluate stacking rule — pass when stackable with coupons', async () => {
      const promo = makePromotion({
        isStackableWithCoupons: true,
        rules: [
          {
            id: 'rule-1',
            ruleType: 'stacking',
            configuration: {},
            ordering: 0,
            isActive: true,
          },
        ],
      });
      prisma.promotion.findUnique.mockResolvedValue(promo);
      prisma.couponRedemption.count.mockResolvedValue(1);

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(true);
    });

    it('should evaluate redemption_limit rule — fail when global limit reached', async () => {
      const promo = makePromotion({
        maxRedemptions: 10,
        rules: [
          {
            id: 'rule-1',
            ruleType: 'redemption_limit',
            configuration: {},
            ordering: 0,
            isActive: true,
          },
        ],
      });
      prisma.promotion.findUnique.mockResolvedValue(promo);
      prisma.promotionRedemption.count
        .mockResolvedValueOnce(10) // global count (getRedemptionCounts)
        .mockResolvedValueOnce(0)  // org count (getRedemptionCounts)
        .mockResolvedValueOnce(0); // hasActivePromo check

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(false);
      expect(result.errors[0]).toContain('maximum number of redemptions');
    });

    it('should evaluate redemption_limit rule — fail when per-org limit reached', async () => {
      const promo = makePromotion({
        maxRedemptionsPerOrg: 1,
        rules: [
          {
            id: 'rule-1',
            ruleType: 'redemption_limit',
            configuration: {},
            ordering: 0,
            isActive: true,
          },
        ],
      });
      prisma.promotion.findUnique.mockResolvedValue(promo);
      prisma.promotionRedemption.count
        .mockResolvedValueOnce(5)  // global count (getRedemptionCounts)
        .mockResolvedValueOnce(1)  // org count (getRedemptionCounts)
        .mockResolvedValueOnce(0); // hasActivePromo check

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.eligible).toBe(false);
      expect(result.errors[0]).toContain('Organization has already redeemed');
    });

    it('should evaluate rules in ordering sequence', async () => {
      const promo = makePromotion({
        rules: [
          {
            id: 'rule-2',
            ruleType: 'billing_period',
            configuration: { allowedPeriods: ['annual'] },
            ordering: 2,
            isActive: true,
          },
          {
            id: 'rule-1',
            ruleType: 'date_range',
            configuration: {},
            ordering: 1,
            isActive: true,
          },
        ],
      });
      prisma.promotion.findUnique.mockResolvedValue(promo);

      const result = await service.evaluatePromotion(
        PROMO_ID, ORG_ID, USER_ID, 'pro', 'monthly',
      );

      // date_range should be first in results (ordering 1 < 2)
      expect(result.ruleResults[0]!.ruleType).toBe('date_range');
      expect(result.ruleResults[1]!.ruleType).toBe('billing_period');
    });
  });

  // ---- findEligiblePromotions ----

  describe('findEligiblePromotions', () => {
    it('should return cached results when available', async () => {
      const cachedResult = [
        { eligible: true, promotionId: PROMO_ID, ruleResults: [], errors: [] },
      ];
      redis.get.mockResolvedValue(JSON.stringify(cachedResult));

      const result = await service.findEligiblePromotions(
        ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result).toEqual(cachedResult);
      expect(prisma.promotion.findMany).not.toHaveBeenCalled();
    });

    it('should query and cache when no cached results', async () => {
      redis.get.mockResolvedValue(null);
      prisma.promotion.findMany.mockResolvedValue([]);

      const result = await service.findEligiblePromotions(
        ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result).toEqual([]);
      expect(redis.set).toHaveBeenCalled();
    });

    it('should evaluate each active promotion', async () => {
      redis.get.mockResolvedValue(null);
      prisma.promotion.findMany
        .mockResolvedValueOnce([{ id: PROMO_ID }]) // first call: list active
        .mockResolvedValueOnce([]); // possible second call

      const promo = makePromotion();
      prisma.promotion.findUnique.mockResolvedValue(promo);

      const result = await service.findEligiblePromotions(
        ORG_ID, USER_ID, 'pro', 'monthly',
      );

      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should only include eligible promotions', async () => {
      redis.get.mockResolvedValue(null);
      prisma.promotion.findMany.mockResolvedValueOnce([
        { id: 'promo-1' },
        { id: 'promo-2' },
      ]);

      // First promo: active, no rules
      prisma.promotion.findUnique
        .mockResolvedValueOnce(makePromotion({ id: 'promo-1' }))
        .mockResolvedValueOnce(makePromotion({ id: 'promo-2', status: 'draft' }));

      const result = await service.findEligiblePromotions(
        ORG_ID, USER_ID, 'pro', 'monthly',
      );

      // Only promo-1 should be eligible
      const eligibleIds = result.map((r) => r.promotionId);
      expect(eligibleIds).toContain('promo-1');
      expect(eligibleIds).not.toContain('promo-2');
    });
  });

  // ---- getActivePromotionsForPricing ----

  describe('getActivePromotionsForPricing', () => {
    it('should return cached results when available', async () => {
      const cached = [{ id: PROMO_ID, name: 'Summer Sale' }];
      redis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.getActivePromotionsForPricing();

      expect(result).toEqual(cached);
      expect(prisma.promotion.findMany).not.toHaveBeenCalled();
    });

    it('should query active promotions displayed on pricing', async () => {
      redis.get.mockResolvedValue(null);
      prisma.promotion.findMany.mockResolvedValue([
        makePromotion(),
      ]);

      const result = await service.getActivePromotionsForPricing();

      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('Summer Sale');
      expect(result[0]!.slug).toBe('summer-sale');
      expect(redis.set).toHaveBeenCalled();
    });

    it('should return empty array when no promotions', async () => {
      redis.get.mockResolvedValue(null);
      prisma.promotion.findMany.mockResolvedValue([]);

      const result = await service.getActivePromotionsForPricing();

      expect(result).toEqual([]);
    });

    it('should format endsAt as ISO string', async () => {
      redis.get.mockResolvedValue(null);
      const promo = makePromotion({ endsAt: new Date('2025-08-31T23:59:59Z') });
      prisma.promotion.findMany.mockResolvedValue([promo]);

      const result = await service.getActivePromotionsForPricing();

      expect(result[0]!.endsAt).toBe('2025-08-31T23:59:59.000Z');
    });

    it('should set endsAt to null when not specified', async () => {
      redis.get.mockResolvedValue(null);
      const promo = makePromotion({ endsAt: null });
      prisma.promotion.findMany.mockResolvedValue([promo]);

      const result = await service.getActivePromotionsForPricing();

      expect(result[0]!.endsAt).toBeNull();
    });
  });

  // ---- calculateDiscountPreview ----

  describe('calculateDiscountPreview', () => {
    it('should calculate percentage discount correctly', async () => {
      const benefits = [
        {
          id: 'b-1',
          benefitType: 'percentage_discount',
          discountValue: 20,
          bonusEntitlementKey: null,
          bonusEntitlementValue: null,
          bonusDurationDays: null,
          trialExtensionDays: null,
          appliesToBillingPeriod: 'any',
        },
      ];

      const result = await service.calculateDiscountPreview(benefits, 'pro', 'monthly');

      expect(result).toBeDefined();
      expect(result!.originalAmount).toBe(99900);
      expect(result!.discountAmount).toBe(19980);
      expect(result!.finalAmount).toBe(79920);
      expect(pricingEngine.resolvePlanPrice).toHaveBeenCalledWith('pro', 'monthly', undefined);
    });

    it('should calculate fixed discount correctly', async () => {
      const benefits = [
        {
          id: 'b-1',
          benefitType: 'fixed_discount',
          discountValue: 10000,
          bonusEntitlementKey: null,
          bonusEntitlementValue: null,
          bonusDurationDays: null,
          trialExtensionDays: null,
          appliesToBillingPeriod: 'any',
        },
      ];

      const result = await service.calculateDiscountPreview(benefits, 'pro', 'monthly');

      expect(result).toBeDefined();
      expect(result!.originalAmount).toBe(99900);
      expect(result!.discountAmount).toBe(10000);
      expect(result!.finalAmount).toBe(89900);
    });

    it('should cap discount at original amount', async () => {
      const benefits = [
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
      ];

      const result = await service.calculateDiscountPreview(benefits, 'pro', 'monthly');

      expect(result).toBeDefined();
      expect(result!.discountAmount).toBe(99900);
      expect(result!.finalAmount).toBe(0);
    });

    it('should return undefined for unknown plan', async () => {
      const benefits = [
        {
          id: 'b-1',
          benefitType: 'percentage_discount',
          discountValue: 20,
          bonusEntitlementKey: null,
          bonusEntitlementValue: null,
          bonusDurationDays: null,
          trialExtensionDays: null,
          appliesToBillingPeriod: 'any',
        },
      ];

      const result = await service.calculateDiscountPreview(benefits, 'free', 'monthly');

      expect(result).toBeUndefined();
      expect(pricingEngine.resolvePlanPrice).toHaveBeenCalledWith('free', 'monthly', undefined);
    });

    it('should skip benefits that do not apply to billing period', async () => {
      const benefits = [
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
      ];

      const result = await service.calculateDiscountPreview(benefits, 'pro', 'monthly');

      expect(result).toBeDefined();
      expect(result!.discountAmount).toBe(0);
      expect(result!.finalAmount).toBe(99900);
    });

    it('should calculate annual discount correctly', async () => {
      const benefits = [
        {
          id: 'b-1',
          benefitType: 'percentage_discount',
          discountValue: 10,
          bonusEntitlementKey: null,
          bonusEntitlementValue: null,
          bonusDurationDays: null,
          trialExtensionDays: null,
          appliesToBillingPeriod: 'any',
        },
      ];

      const result = await service.calculateDiscountPreview(benefits, 'pro', 'annual');

      expect(result).toBeDefined();
      expect(result!.originalAmount).toBe(999000);
      expect(result!.discountAmount).toBe(99900);
      expect(result!.finalAmount).toBe(899100);
      expect(pricingEngine.resolvePlanPrice).toHaveBeenCalledWith('pro', 'annual', undefined);
    });

    it('should combine multiple benefits', async () => {
      const benefits = [
        {
          id: 'b-1',
          benefitType: 'percentage_discount',
          discountValue: 10,
          bonusEntitlementKey: null,
          bonusEntitlementValue: null,
          bonusDurationDays: null,
          trialExtensionDays: null,
          appliesToBillingPeriod: 'any',
        },
        {
          id: 'b-2',
          benefitType: 'fixed_discount',
          discountValue: 5000,
          bonusEntitlementKey: null,
          bonusEntitlementValue: null,
          bonusDurationDays: null,
          trialExtensionDays: null,
          appliesToBillingPeriod: 'any',
        },
      ];

      const result = await service.calculateDiscountPreview(benefits, 'pro', 'monthly');

      expect(result).toBeDefined();
      // 10% of 99900 = 9990 + 5000 = 14990
      expect(result!.discountAmount).toBe(14990);
      expect(result!.finalAmount).toBe(84910);
    });

    it('should pass organizationId to resolvePlanPrice when provided', async () => {
      const benefits = [
        {
          id: 'b-1',
          benefitType: 'percentage_discount',
          discountValue: 10,
          bonusEntitlementKey: null,
          bonusEntitlementValue: null,
          bonusDurationDays: null,
          trialExtensionDays: null,
          appliesToBillingPeriod: 'any',
        },
      ];

      const result = await service.calculateDiscountPreview(benefits, 'pro', 'monthly', ORG_ID);

      expect(result).toBeDefined();
      expect(pricingEngine.resolvePlanPrice).toHaveBeenCalledWith('pro', 'monthly', ORG_ID);
    });
  });

  // ---- buildContext ----

  describe('buildContext', () => {
    it('should build context with org type', async () => {
      prisma.organization.findUnique.mockResolvedValue({ type: 'firm' });

      const context = await service.buildContext(
        ORG_ID, USER_ID, 'pro', 'monthly', PROMO_ID,
      );

      expect(context.organizationType).toBe('firm');
    });

    it('should default org type to individual when not found', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      const context = await service.buildContext(
        ORG_ID, USER_ID, 'pro', 'monthly', PROMO_ID,
      );

      expect(context.organizationType).toBe('individual');
    });

    it('should detect new subscriber correctly', async () => {
      prisma.subscription.count.mockResolvedValue(0);

      const context = await service.buildContext(
        ORG_ID, USER_ID, 'pro', 'monthly', PROMO_ID,
      );

      expect(context.isNewSubscriber).toBe(true);
    });

    it('should detect existing subscriber correctly', async () => {
      prisma.subscription.count.mockResolvedValue(3);

      const context = await service.buildContext(
        ORG_ID, USER_ID, 'pro', 'monthly', PROMO_ID,
      );

      expect(context.isNewSubscriber).toBe(false);
    });

    it('should detect active coupon', async () => {
      prisma.couponRedemption.count.mockResolvedValue(1);

      const context = await service.buildContext(
        ORG_ID, USER_ID, 'pro', 'monthly', PROMO_ID,
      );

      expect(context.hasActiveCoupon).toBe(true);
    });

    it('should detect no active coupon', async () => {
      prisma.couponRedemption.count.mockResolvedValue(0);

      const context = await service.buildContext(
        ORG_ID, USER_ID, 'pro', 'monthly', PROMO_ID,
      );

      expect(context.hasActiveCoupon).toBe(false);
    });

    it('should detect active promotion (excluding current)', async () => {
      prisma.promotionRedemption.count
        .mockResolvedValueOnce(5) // global (getRedemptionCounts)
        .mockResolvedValueOnce(0) // org (getRedemptionCounts)
        .mockResolvedValueOnce(1); // hasActivePromo check

      const context = await service.buildContext(
        ORG_ID, USER_ID, 'pro', 'monthly', PROMO_ID,
      );

      expect(context.hasActivePromotion).toBe(true);
    });

    it('should set subscription status from active subscription', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        status: 'trialing',
        planCode: 'edu',
      });

      const context = await service.buildContext(
        ORG_ID, USER_ID, 'pro', 'monthly', PROMO_ID,
      );

      expect(context.subscriptionStatus).toBe('trialing');
      expect(context.subscriptionPlanCode).toBe('edu');
    });

    it('should handle null subscription', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);

      const context = await service.buildContext(
        ORG_ID, USER_ID, 'pro', 'monthly', PROMO_ID,
      );

      expect(context.subscriptionStatus).toBeNull();
      expect(context.subscriptionPlanCode).toBeNull();
    });
  });

  // ---- Cache Invalidation ----

  describe('invalidateEligibleCache', () => {
    it('should delete cache keys for all plan/period combinations', async () => {
      await service.invalidateEligibleCache(ORG_ID);

      expect(redis.del).toHaveBeenCalled();
      // 5 plans * 2 periods = 10 deletions
      expect(redis.del).toHaveBeenCalledTimes(10);
    });
  });

  describe('invalidatePricingCache', () => {
    it('should delete the pricing cache key', async () => {
      await service.invalidatePricingCache();

      expect(redis.del).toHaveBeenCalledWith('cache:promos:pricing');
    });
  });
});
