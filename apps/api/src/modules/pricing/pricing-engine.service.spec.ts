import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { CouponService } from '../coupons/coupon.service';
import { FeatureFlagService } from '../feature-flags/feature-flags.service';
import { PlansService } from '../plans/plans.service';
import { PromotionRuleEngineService } from '../promotions/promotion-rule-engine.service';
import {
  type CalculateBreakdownInput,
  PLAN_PRICING,
  PricingEngineService,
} from './pricing-engine.service';

describe('PricingEngineService', () => {
  let service: PricingEngineService;
  let prismaService: jest.Mocked<PrismaService>;
  let featureFlagService: jest.Mocked<FeatureFlagService>;
  let plansService: jest.Mocked<PlansService>;
  let couponService: jest.Mocked<CouponService>;
  let promotionRuleEngine: jest.Mocked<PromotionRuleEngineService>;

  const baseInput: CalculateBreakdownInput = {
    organizationId: 'org-1',
    userId: 'user-1',
    planCode: 'pro',
    billingPeriod: 'monthly',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricingEngineService,
        {
          provide: PrismaService,
          useValue: {
            promotion: { findUnique: jest.fn() },
          },
        },
        {
          provide: FeatureFlagService,
          useValue: { isEnabled: jest.fn() },
        },
        {
          provide: PlansService,
          useValue: { findByCode: jest.fn() },
        },
        {
          provide: CouponService,
          useValue: { validateCoupon: jest.fn() },
        },
        {
          provide: PromotionRuleEngineService,
          useValue: { evaluatePromotion: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<PricingEngineService>(PricingEngineService);
    prismaService = module.get(PrismaService);
    featureFlagService = module.get(FeatureFlagService);
    plansService = module.get(PlansService);
    couponService = module.get(CouponService);
    promotionRuleEngine = module.get(PromotionRuleEngineService);

    // Default: feature flag off (hardcoded prices)
    (featureFlagService.isEnabled as jest.Mock).mockResolvedValue(false);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ====================================================================
  // resolvePlanPrice
  // ====================================================================

  describe('resolvePlanPrice', () => {
    it('returns hardcoded price when feature flag is off', async () => {
      (featureFlagService.isEnabled as jest.Mock).mockResolvedValue(false);

      const result = await service.resolvePlanPrice('pro', 'monthly', 'org-1');

      expect(result).toEqual({
        amount: 99900,
        planName: 'Pro',
        planId: null,
        currency: 'PHP',
        source: 'hardcoded',
      });
      expect(plansService.findByCode).not.toHaveBeenCalled();
    });

    it('returns DB price when feature flag is on', async () => {
      (featureFlagService.isEnabled as jest.Mock).mockResolvedValue(true);
      (plansService.findByCode as jest.Mock).mockResolvedValue({
        id: 'plan-uuid-1',
        code: 'pro',
        name: 'Pro',
        displayName: 'Professional',
        prices: [
          {
            billingInterval: 'monthly',
            amount: 89900,
            isActive: true,
            currency: 'PHP',
          },
          {
            billingInterval: 'annual',
            amount: 899000,
            isActive: true,
            currency: 'PHP',
          },
        ],
      });

      const result = await service.resolvePlanPrice('pro', 'monthly', 'org-1');

      expect(result).toEqual({
        amount: 89900,
        planName: 'Professional',
        planId: 'plan-uuid-1',
        currency: 'PHP',
        source: 'database',
      });
    });

    it('falls back to hardcoded when DB plan not found (error)', async () => {
      (featureFlagService.isEnabled as jest.Mock).mockResolvedValue(true);
      (plansService.findByCode as jest.Mock).mockRejectedValue(
        new Error('Plan not found'),
      );

      const result = await service.resolvePlanPrice('pro', 'monthly', 'org-1');

      expect(result).toEqual({
        amount: 99900,
        planName: 'Pro',
        planId: null,
        currency: 'PHP',
        source: 'hardcoded',
      });
    });

    it('falls back to hardcoded when no active price for interval', async () => {
      (featureFlagService.isEnabled as jest.Mock).mockResolvedValue(true);
      (plansService.findByCode as jest.Mock).mockResolvedValue({
        id: 'plan-uuid-1',
        code: 'pro',
        name: 'Pro',
        displayName: 'Professional',
        prices: [
          {
            billingInterval: 'annual',
            amount: 899000,
            isActive: true,
            currency: 'PHP',
          },
          // no active monthly price
        ],
      });

      const result = await service.resolvePlanPrice('pro', 'monthly', 'org-1');

      expect(result.source).toBe('hardcoded');
      expect(result.amount).toBe(99900);
    });

    it('returns 0 for free plan', async () => {
      const result = await service.resolvePlanPrice(
        'free',
        'monthly',
        'org-1',
      );

      expect(result.amount).toBe(0);
      expect(result.planName).toBe('Free');
      expect(result.source).toBe('hardcoded');
    });

    it('throws BadRequestException for invalid plan code', async () => {
      await expect(
        service.resolvePlanPrice('nonexistent', 'monthly', 'org-1'),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.resolvePlanPrice('nonexistent', 'monthly', 'org-1'),
      ).rejects.toThrow('Invalid plan code: nonexistent');
    });

    it('returns hardcoded when organizationId is not provided', async () => {
      const result = await service.resolvePlanPrice('pro', 'monthly');

      expect(featureFlagService.isEnabled).not.toHaveBeenCalled();
      expect(result.source).toBe('hardcoded');
      expect(result.amount).toBe(99900);
    });
  });

  // ====================================================================
  // calculatePriceBreakdown
  // ====================================================================

  describe('calculatePriceBreakdown', () => {
    it('returns base price only when no coupon or promotion', async () => {
      const result = await service.calculatePriceBreakdown(baseInput);

      expect(result.basePriceAmount).toBe(99900);
      expect(result.couponDiscountAmount).toBe(0);
      expect(result.promotionDiscountAmount).toBe(0);
      expect(result.totalDiscountAmount).toBe(0);
      expect(result.finalAmount).toBe(99900);
      expect(result.couponId).toBeNull();
      expect(result.couponCode).toBeNull();
      expect(result.promotionId).toBeNull();
      expect(result.discountsStacked).toBe(false);
      expect(result.currency).toBe('PHP');
      expect(result.planCode).toBe('pro');
      expect(result.billingPeriod).toBe('monthly');
    });

    it('applies coupon discount correctly', async () => {
      (couponService.validateCoupon as jest.Mock).mockResolvedValue({
        valid: true,
        coupon: {
          id: 'coupon-1',
          code: 'SAVE20',
          discountType: 'percentage',
          discountValue: 20,
        },
        errors: [],
        discountPreview: {
          originalAmount: 99900,
          discountAmount: 19980,
          finalAmount: 79920,
          discountType: 'percentage',
          discountValue: 20,
          currency: 'PHP',
        },
      });

      const result = await service.calculatePriceBreakdown({
        ...baseInput,
        couponCode: 'SAVE20',
      });

      expect(result.couponId).toBe('coupon-1');
      expect(result.couponCode).toBe('SAVE20');
      expect(result.couponDiscountAmount).toBe(19980);
      expect(result.totalDiscountAmount).toBe(19980);
      expect(result.finalAmount).toBe(99900 - 19980);
    });

    it('applies promotion discount correctly', async () => {
      (promotionRuleEngine.evaluatePromotion as jest.Mock).mockResolvedValue({
        eligible: true,
        promotionId: 'promo-1',
        ruleResults: [],
        errors: [],
        discountPreview: {
          originalAmount: 99900,
          discountAmount: 15000,
          finalAmount: 84900,
          discountType: 'fixed_discount',
          discountValue: 15000,
          currency: 'PHP',
        },
      });

      (prismaService.promotion.findUnique as jest.Mock).mockResolvedValue({
        isStackableWithCoupons: false,
      });

      const result = await service.calculatePriceBreakdown({
        ...baseInput,
        promotionId: 'promo-1',
      });

      expect(result.promotionId).toBe('promo-1');
      expect(result.promotionDiscountAmount).toBe(15000);
      expect(result.totalDiscountAmount).toBe(15000);
      expect(result.finalAmount).toBe(99900 - 15000);
    });

    it('stacks coupon + promotion when stackable', async () => {
      (couponService.validateCoupon as jest.Mock).mockResolvedValue({
        valid: true,
        coupon: {
          id: 'coupon-1',
          code: 'STACK10',
          discountType: 'percentage',
          discountValue: 10,
        },
        errors: [],
        discountPreview: {
          originalAmount: 99900,
          discountAmount: 9990,
          finalAmount: 89910,
          discountType: 'percentage',
          discountValue: 10,
          currency: 'PHP',
        },
      });

      (promotionRuleEngine.evaluatePromotion as jest.Mock).mockResolvedValue({
        eligible: true,
        promotionId: 'promo-1',
        ruleResults: [],
        errors: [],
        discountPreview: {
          originalAmount: 99900,
          discountAmount: 15000,
          finalAmount: 84900,
          discountType: 'fixed_discount',
          discountValue: 15000,
          currency: 'PHP',
        },
      });

      (prismaService.promotion.findUnique as jest.Mock).mockResolvedValue({
        isStackableWithCoupons: true,
      });

      const result = await service.calculatePriceBreakdown({
        ...baseInput,
        couponCode: 'STACK10',
        promotionId: 'promo-1',
      });

      expect(result.discountsStacked).toBe(true);
      expect(result.couponDiscountAmount).toBe(9990);
      expect(result.promotionDiscountAmount).toBe(15000);
      expect(result.totalDiscountAmount).toBe(9990 + 15000);
      expect(result.finalAmount).toBe(99900 - (9990 + 15000));
    });

    it('uses larger discount when not stackable (coupon wins)', async () => {
      (couponService.validateCoupon as jest.Mock).mockResolvedValue({
        valid: true,
        coupon: {
          id: 'coupon-1',
          code: 'BIG50',
          discountType: 'fixed_amount',
          discountValue: 50000,
        },
        errors: [],
        discountPreview: {
          originalAmount: 99900,
          discountAmount: 50000,
          finalAmount: 49900,
          discountType: 'fixed_amount',
          discountValue: 50000,
          currency: 'PHP',
        },
      });

      (promotionRuleEngine.evaluatePromotion as jest.Mock).mockResolvedValue({
        eligible: true,
        promotionId: 'promo-1',
        ruleResults: [],
        errors: [],
        discountPreview: {
          originalAmount: 99900,
          discountAmount: 10000,
          finalAmount: 89900,
          discountType: 'fixed_discount',
          discountValue: 10000,
          currency: 'PHP',
        },
      });

      (prismaService.promotion.findUnique as jest.Mock).mockResolvedValue({
        isStackableWithCoupons: false,
      });

      const result = await service.calculatePriceBreakdown({
        ...baseInput,
        couponCode: 'BIG50',
        promotionId: 'promo-1',
      });

      expect(result.discountsStacked).toBe(false);
      expect(result.totalDiscountAmount).toBe(50000);
      // Coupon wins, so promotion discount is zeroed out
      expect(result.couponDiscountAmount).toBe(50000);
      expect(result.promotionDiscountAmount).toBe(0);
      expect(result.couponId).toBe('coupon-1');
      expect(result.promotionId).toBeNull();
    });

    it('uses larger discount when not stackable (promotion wins)', async () => {
      (couponService.validateCoupon as jest.Mock).mockResolvedValue({
        valid: true,
        coupon: {
          id: 'coupon-1',
          code: 'SMALL5',
          discountType: 'fixed_amount',
          discountValue: 5000,
        },
        errors: [],
        discountPreview: {
          originalAmount: 99900,
          discountAmount: 5000,
          finalAmount: 94900,
          discountType: 'fixed_amount',
          discountValue: 5000,
          currency: 'PHP',
        },
      });

      (promotionRuleEngine.evaluatePromotion as jest.Mock).mockResolvedValue({
        eligible: true,
        promotionId: 'promo-1',
        ruleResults: [],
        errors: [],
        discountPreview: {
          originalAmount: 99900,
          discountAmount: 30000,
          finalAmount: 69900,
          discountType: 'fixed_discount',
          discountValue: 30000,
          currency: 'PHP',
        },
      });

      (prismaService.promotion.findUnique as jest.Mock).mockResolvedValue({
        isStackableWithCoupons: false,
      });

      const result = await service.calculatePriceBreakdown({
        ...baseInput,
        couponCode: 'SMALL5',
        promotionId: 'promo-1',
      });

      expect(result.discountsStacked).toBe(false);
      expect(result.totalDiscountAmount).toBe(30000);
      // Promotion wins, so coupon discount is zeroed out
      expect(result.couponDiscountAmount).toBe(0);
      expect(result.promotionDiscountAmount).toBe(30000);
      expect(result.couponId).toBeNull();
      expect(result.promotionId).toBe('promo-1');
    });

    it('caps total discount at base price when stacking', async () => {
      // Coupon gives 60000 off, promotion gives 60000 off, but base is only 99900
      (couponService.validateCoupon as jest.Mock).mockResolvedValue({
        valid: true,
        coupon: {
          id: 'coupon-1',
          code: 'HUGE60K',
          discountType: 'fixed_amount',
          discountValue: 60000,
        },
        errors: [],
        discountPreview: {
          originalAmount: 99900,
          discountAmount: 60000,
          finalAmount: 39900,
          discountType: 'fixed_amount',
          discountValue: 60000,
          currency: 'PHP',
        },
      });

      (promotionRuleEngine.evaluatePromotion as jest.Mock).mockResolvedValue({
        eligible: true,
        promotionId: 'promo-1',
        ruleResults: [],
        errors: [],
        discountPreview: {
          originalAmount: 99900,
          discountAmount: 60000,
          finalAmount: 39900,
          discountType: 'fixed_discount',
          discountValue: 60000,
          currency: 'PHP',
        },
      });

      (prismaService.promotion.findUnique as jest.Mock).mockResolvedValue({
        isStackableWithCoupons: true,
      });

      const result = await service.calculatePriceBreakdown({
        ...baseInput,
        couponCode: 'HUGE60K',
        promotionId: 'promo-1',
      });

      // 60000 + 60000 = 120000, but capped at base price 99900
      expect(result.totalDiscountAmount).toBe(99900);
      expect(result.finalAmount).toBe(0);
    });

    it('ignores invalid coupon code (warns, no discount)', async () => {
      (couponService.validateCoupon as jest.Mock).mockResolvedValue({
        valid: false,
        coupon: null,
        errors: ['Coupon expired'],
        discountPreview: null,
      });

      const result = await service.calculatePriceBreakdown({
        ...baseInput,
        couponCode: 'EXPIRED_CODE',
      });

      expect(result.couponId).toBeNull();
      expect(result.couponCode).toBeNull();
      expect(result.couponDiscountAmount).toBe(0);
      expect(result.totalDiscountAmount).toBe(0);
      expect(result.finalAmount).toBe(99900);
    });

    it('ignores ineligible promotion (warns, no discount)', async () => {
      (promotionRuleEngine.evaluatePromotion as jest.Mock).mockResolvedValue({
        eligible: false,
        promotionId: 'promo-1',
        ruleResults: [
          { ruleType: 'date_range', passed: false, reason: 'Promotion ended' },
        ],
        errors: ['Promotion ended'],
        discountPreview: null,
      });

      const result = await service.calculatePriceBreakdown({
        ...baseInput,
        promotionId: 'promo-1',
      });

      expect(result.promotionId).toBeNull();
      expect(result.promotionDiscountAmount).toBe(0);
      expect(result.totalDiscountAmount).toBe(0);
      expect(result.finalAmount).toBe(99900);
    });

    it('creates correct lineItems array with base price only', async () => {
      const result = await service.calculatePriceBreakdown(baseInput);

      expect(result.lineItems).toHaveLength(1);
      expect(result.lineItems[0]).toMatchObject({
        type: 'base_price',
        label: 'Pro Plan — Monthly',
        amount: 99900,
        referenceCode: 'pro',
        metadata: { source: 'hardcoded' },
      });
    });

    it('creates correct lineItems array with coupon and promotion', async () => {
      (couponService.validateCoupon as jest.Mock).mockResolvedValue({
        valid: true,
        coupon: {
          id: 'coupon-1',
          code: 'SAVE10',
          discountType: 'percentage',
          discountValue: 10,
        },
        errors: [],
        discountPreview: {
          originalAmount: 99900,
          discountAmount: 9990,
          finalAmount: 89910,
          discountType: 'percentage',
          discountValue: 10,
          currency: 'PHP',
        },
      });

      (promotionRuleEngine.evaluatePromotion as jest.Mock).mockResolvedValue({
        eligible: true,
        promotionId: 'promo-1',
        ruleResults: [],
        errors: [],
        discountPreview: {
          originalAmount: 99900,
          discountAmount: 5000,
          finalAmount: 94900,
          discountType: 'fixed_discount',
          discountValue: 5000,
          currency: 'PHP',
        },
      });

      (prismaService.promotion.findUnique as jest.Mock).mockResolvedValue({
        isStackableWithCoupons: true,
      });

      const result = await service.calculatePriceBreakdown({
        ...baseInput,
        couponCode: 'SAVE10',
        promotionId: 'promo-1',
      });

      expect(result.lineItems).toHaveLength(3);

      expect(result.lineItems[0]).toMatchObject({
        type: 'base_price',
        amount: 99900,
      });
      expect(result.lineItems[1]).toMatchObject({
        type: 'coupon_discount',
        label: 'Coupon: SAVE10',
        amount: -9990,
        referenceId: 'coupon-1',
        referenceCode: 'SAVE10',
      });
      expect(result.lineItems[2]).toMatchObject({
        type: 'promotion_discount',
        label: 'Promotion discount',
        amount: -5000,
        referenceId: 'promo-1',
      });
    });

    it('sets discountsStacked flag appropriately', async () => {
      // Case 1: only coupon => false
      (couponService.validateCoupon as jest.Mock).mockResolvedValue({
        valid: true,
        coupon: {
          id: 'coupon-1',
          code: 'SAVE10',
          discountType: 'percentage',
          discountValue: 10,
        },
        errors: [],
        discountPreview: {
          originalAmount: 99900,
          discountAmount: 9990,
          finalAmount: 89910,
          discountType: 'percentage',
          discountValue: 10,
          currency: 'PHP',
        },
      });

      const resultCouponOnly = await service.calculatePriceBreakdown({
        ...baseInput,
        couponCode: 'SAVE10',
      });
      expect(resultCouponOnly.discountsStacked).toBe(false);

      // Case 2: coupon + promotion, stackable => true
      (promotionRuleEngine.evaluatePromotion as jest.Mock).mockResolvedValue({
        eligible: true,
        promotionId: 'promo-1',
        ruleResults: [],
        errors: [],
        discountPreview: {
          originalAmount: 99900,
          discountAmount: 5000,
          finalAmount: 94900,
          discountType: 'fixed_discount',
          discountValue: 5000,
          currency: 'PHP',
        },
      });

      (prismaService.promotion.findUnique as jest.Mock).mockResolvedValue({
        isStackableWithCoupons: true,
      });

      const resultStacked = await service.calculatePriceBreakdown({
        ...baseInput,
        couponCode: 'SAVE10',
        promotionId: 'promo-1',
      });
      expect(resultStacked.discountsStacked).toBe(true);

      // Case 3: coupon + promotion, not stackable => false
      (prismaService.promotion.findUnique as jest.Mock).mockResolvedValue({
        isStackableWithCoupons: false,
      });

      const resultNotStacked = await service.calculatePriceBreakdown({
        ...baseInput,
        couponCode: 'SAVE10',
        promotionId: 'promo-1',
      });
      expect(resultNotStacked.discountsStacked).toBe(false);
    });
  });

  // ====================================================================
  // getHardcodedPrice
  // ====================================================================

  describe('getHardcodedPrice', () => {
    it('returns correct prices for all plans', () => {
      expect(service.getHardcodedPrice('free', 'monthly')).toBe(0);
      expect(service.getHardcodedPrice('free', 'annual')).toBe(0);
      expect(service.getHardcodedPrice('edu', 'monthly')).toBe(29900);
      expect(service.getHardcodedPrice('edu', 'annual')).toBe(299000);
      expect(service.getHardcodedPrice('pro', 'monthly')).toBe(99900);
      expect(service.getHardcodedPrice('pro', 'annual')).toBe(999000);
      expect(service.getHardcodedPrice('team', 'monthly')).toBe(249900);
      expect(service.getHardcodedPrice('team', 'annual')).toBe(2499000);
      expect(service.getHardcodedPrice('enterprise', 'monthly')).toBe(499900);
      expect(service.getHardcodedPrice('enterprise', 'annual')).toBe(4999000);
    });

    it('returns null for invalid plan code', () => {
      expect(service.getHardcodedPrice('nonexistent', 'monthly')).toBeNull();
      expect(service.getHardcodedPrice('', 'annual')).toBeNull();
      expect(service.getHardcodedPrice('platinum', 'monthly')).toBeNull();
    });
  });

  // ====================================================================
  // getHardcodedPlanName
  // ====================================================================

  describe('getHardcodedPlanName', () => {
    it('returns correct names for all plans', () => {
      expect(service.getHardcodedPlanName('free')).toBe('Free');
      expect(service.getHardcodedPlanName('edu')).toBe('Edu');
      expect(service.getHardcodedPlanName('pro')).toBe('Pro');
      expect(service.getHardcodedPlanName('team')).toBe('Team');
      expect(service.getHardcodedPlanName('enterprise')).toBe('Enterprise');
    });

    it('returns the plan code itself for unknown plans', () => {
      expect(service.getHardcodedPlanName('nonexistent')).toBe('nonexistent');
      expect(service.getHardcodedPlanName('custom')).toBe('custom');
    });
  });
});
