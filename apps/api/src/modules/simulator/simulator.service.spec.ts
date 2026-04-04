import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SimulatorService } from './simulator.service';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { ProrationService } from '../subscriptions/proration.service';
import { CouponService } from '../coupons/coupon.service';
import { PromotionRuleEngineService } from '../promotions/promotion-rule-engine.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('SimulatorService', () => {
  let service: SimulatorService;
  let pricingEngine: jest.Mocked<PricingEngineService>;
  let prorationService: jest.Mocked<ProrationService>;
  let couponService: jest.Mocked<CouponService>;
  let promotionRuleEngine: jest.Mocked<PromotionRuleEngineService>;
  let prisma: { coupon: { findUnique: jest.Mock }; promotion: { findUnique: jest.Mock } };

  beforeEach(async () => {
    pricingEngine = {
      calculatePriceBreakdown: jest.fn(),
      resolvePlanPrice: jest.fn(),
    } as unknown as jest.Mocked<PricingEngineService>;

    prorationService = {
      calculateProration: jest.fn(),
    } as unknown as jest.Mocked<ProrationService>;

    couponService = {
      validateCoupon: jest.fn(),
      findByCode: jest.fn(),
      calculateDiscount: jest.fn(),
    } as unknown as jest.Mocked<CouponService>;

    promotionRuleEngine = {
      evaluatePromotion: jest.fn(),
      calculateDiscountPreview: jest.fn(),
    } as unknown as jest.Mocked<PromotionRuleEngineService>;

    prisma = {
      coupon: { findUnique: jest.fn() },
      promotion: { findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimulatorService,
        { provide: PricingEngineService, useValue: pricingEngine },
        { provide: ProrationService, useValue: prorationService },
        { provide: CouponService, useValue: couponService },
        { provide: PromotionRuleEngineService, useValue: promotionRuleEngine },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SimulatorService>(SimulatorService);
  });

  // =========================================================================
  // 1. simulateTransition
  // =========================================================================
  describe('simulateTransition', () => {
    it('should return valid transition from active with REQUEST_CANCEL', () => {
      const result = service.simulateTransition({
        currentState: 'active',
        action: 'REQUEST_CANCEL',
      });

      expect(result.valid).toBe(true);
      expect(result.fromState).toBe('active');
      expect(result.toState).toBe('cancelling');
      expect(result.hasAccess).toBe(true); // cancelling grants access
      expect(result.sideEffects.length).toBeGreaterThan(0);
      expect(result.validActionsFromNewState.length).toBeGreaterThan(0);
      expect(result.error).toBeNull();
    });

    it('should return valid transition from provisioning to trialing', () => {
      const result = service.simulateTransition({
        currentState: 'provisioning',
        action: 'START_TRIAL',
      });

      expect(result.valid).toBe(true);
      expect(result.toState).toBe('trialing');
      expect(result.hasAccess).toBe(true);
    });

    it('should return invalid transition result for wrong action from state', () => {
      const result = service.simulateTransition({
        currentState: 'cancelled',
        action: 'RENEW',
      });

      expect(result.valid).toBe(false);
      expect(result.toState).toBeNull();
      expect(result.error).not.toBeNull();
      expect(result.validActionsFromNewState.length).toBeGreaterThan(0); // REACTIVATE, TERMINATE
    });

    it('should handle TERMINATE from any non-terminal state', () => {
      const result = service.simulateTransition({
        currentState: 'suspended',
        action: 'TERMINATE',
      });

      expect(result.valid).toBe(true);
      expect(result.toState).toBe('terminated');
      expect(result.hasAccess).toBe(false);
    });

    it('should report no access for terminal state', () => {
      const result = service.simulateTransition({
        currentState: 'active',
        action: 'CANCEL_IMMEDIATELY',
      });

      expect(result.valid).toBe(true);
      expect(result.toState).toBe('cancelled');
      expect(result.hasAccess).toBe(false);
    });

    it('should throw BadRequestException for invalid state string', () => {
      expect(() =>
        service.simulateTransition({
          currentState: 'nonexistent_state',
          action: 'ACTIVATE',
        }),
      ).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid action string', () => {
      expect(() =>
        service.simulateTransition({
          currentState: 'active',
          action: 'INVALID_ACTION',
        }),
      ).toThrow(BadRequestException);
    });

    it('should be case-insensitive for state (lowercase)', () => {
      const result = service.simulateTransition({
        currentState: 'ACTIVE',
        action: 'REQUEST_CANCEL',
      });

      // SubscriptionState values are lowercase, so 'ACTIVE' won't match as-is
      // parseState normalizes to lowercase
      expect(result.valid).toBe(true);
      expect(result.fromState).toBe('active');
    });

    it('should be case-insensitive for action (mixed case)', () => {
      const result = service.simulateTransition({
        currentState: 'active',
        action: 'request_cancel',
      });

      expect(result.valid).toBe(true);
      expect(result.toState).toBe('cancelling');
    });

    it('should include side effects in successful transition', () => {
      const result = service.simulateTransition({
        currentState: 'active',
        action: 'UPGRADE',
      });

      expect(result.valid).toBe(true);
      expect(result.toState).toBe('migrating');
      expect(result.sideEffects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'AUDIT_LOG' }),
          expect.objectContaining({ type: 'CREATE_MIGRATION_RECORD' }),
        ]),
      );
    });
  });

  // =========================================================================
  // 2. simulateLifecycle
  // =========================================================================
  describe('simulateLifecycle', () => {
    it('should simulate a full trial-to-cancel lifecycle', () => {
      const result = service.simulateLifecycle({
        startingState: 'provisioning',
        actions: ['START_TRIAL', 'CONVERT_TRIAL', 'REQUEST_CANCEL'],
      });

      expect(result.startingState).toBe('provisioning');
      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].toState).toBe('trialing');
      expect(result.steps[1].toState).toBe('active');
      expect(result.steps[2].toState).toBe('cancelling');
      expect(result.finalState).toBe('cancelling');
      expect(result.finalHasAccess).toBe(true);
      expect(result.totalSteps).toBe(3);
      expect(result.successfulSteps).toBe(3);
      expect(result.failedAtStep).toBeNull();
    });

    it('should stop at first invalid transition', () => {
      const result = service.simulateLifecycle({
        startingState: 'provisioning',
        actions: ['START_TRIAL', 'RENEW', 'CONVERT_TRIAL'],
      });

      expect(result.steps).toHaveLength(2); // stops after RENEW fails
      expect(result.steps[0].valid).toBe(true);
      expect(result.steps[1].valid).toBe(false);
      expect(result.steps[1].error).not.toBeNull();
      expect(result.finalState).toBe('trialing');
      expect(result.successfulSteps).toBe(1);
      expect(result.failedAtStep).toBe(2);
    });

    it('should handle single action lifecycle', () => {
      const result = service.simulateLifecycle({
        startingState: 'active',
        actions: ['TERMINATE'],
      });

      expect(result.steps).toHaveLength(1);
      expect(result.finalState).toBe('terminated');
      expect(result.finalHasAccess).toBe(false);
      expect(result.successfulSteps).toBe(1);
      expect(result.failedAtStep).toBeNull();
    });

    it('should handle failure on first step', () => {
      const result = service.simulateLifecycle({
        startingState: 'active',
        actions: ['START_TRIAL'],
      });

      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].valid).toBe(false);
      expect(result.finalState).toBe('active');
      expect(result.successfulSteps).toBe(0);
      expect(result.failedAtStep).toBe(1);
    });

    it('should track step numbers correctly', () => {
      const result = service.simulateLifecycle({
        startingState: 'provisioning',
        actions: ['ACTIVATE', 'RENEW'],
      });

      expect(result.steps[0].step).toBe(1);
      expect(result.steps[1].step).toBe(2);
    });

    it('should handle self-transition (ACTIVE -> RENEW -> ACTIVE)', () => {
      const result = service.simulateLifecycle({
        startingState: 'active',
        actions: ['RENEW', 'RENEW'],
      });

      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].fromState).toBe('active');
      expect(result.steps[0].toState).toBe('active');
      expect(result.steps[1].fromState).toBe('active');
      expect(result.steps[1].toState).toBe('active');
      expect(result.finalState).toBe('active');
      expect(result.successfulSteps).toBe(2);
    });

    it('should throw for invalid starting state', () => {
      expect(() =>
        service.simulateLifecycle({
          startingState: 'bogus',
          actions: ['ACTIVATE'],
        }),
      ).toThrow(BadRequestException);
    });

    it('should throw for invalid action in list', () => {
      expect(() =>
        service.simulateLifecycle({
          startingState: 'active',
          actions: ['BOGUS_ACTION'],
        }),
      ).toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // 3. simulatePricing
  // =========================================================================
  describe('simulatePricing', () => {
    const mockBreakdown = {
      basePriceAmount: 99900,
      couponId: null,
      couponCode: null,
      couponDiscountAmount: 0,
      promotionId: null,
      promotionDiscountAmount: 0,
      totalDiscountAmount: 0,
      finalAmount: 99900,
      currency: 'PHP',
      planCode: 'pro',
      billingPeriod: 'monthly',
      planName: 'Pro',
      planId: null,
      discountsStacked: false,
      lineItems: [],
      calculatedAt: '2026-03-24T00:00:00.000Z',
    };

    it('should delegate to pricing engine and add simulatedAt', async () => {
      pricingEngine.calculatePriceBreakdown.mockResolvedValue(mockBreakdown);

      const result = await service.simulatePricing({
        organizationId: '550e8400-e29b-41d4-a716-446655440000',
        planCode: 'pro',
        billingPeriod: 'monthly',
      });

      expect(pricingEngine.calculatePriceBreakdown).toHaveBeenCalledWith({
        organizationId: '550e8400-e29b-41d4-a716-446655440000',
        userId: '00000000-0000-0000-0000-000000000000',
        planCode: 'pro',
        billingPeriod: 'monthly',
        couponCode: undefined,
        promotionId: undefined,
      });
      expect(result.basePriceAmount).toBe(99900);
      expect(result.simulatedAt).toBeDefined();
    });

    it('should pass couponCode and promotionId when provided', async () => {
      pricingEngine.calculatePriceBreakdown.mockResolvedValue({
        ...mockBreakdown,
        couponCode: 'LAUNCH2026',
        couponDiscountAmount: 10000,
        totalDiscountAmount: 10000,
        finalAmount: 89900,
      });

      await service.simulatePricing({
        organizationId: '550e8400-e29b-41d4-a716-446655440000',
        planCode: 'pro',
        billingPeriod: 'monthly',
        couponCode: 'LAUNCH2026',
        promotionId: '550e8400-e29b-41d4-a716-446655440001',
      });

      expect(pricingEngine.calculatePriceBreakdown).toHaveBeenCalledWith(
        expect.objectContaining({
          couponCode: 'LAUNCH2026',
          promotionId: '550e8400-e29b-41d4-a716-446655440001',
        }),
      );
    });

    it('should propagate pricing engine errors', async () => {
      pricingEngine.calculatePriceBreakdown.mockRejectedValue(
        new BadRequestException('Plan not found'),
      );

      await expect(
        service.simulatePricing({
          organizationId: '550e8400-e29b-41d4-a716-446655440000',
          planCode: 'nonexistent',
          billingPeriod: 'monthly',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should use system user ID for all pricing calls', async () => {
      pricingEngine.calculatePriceBreakdown.mockResolvedValue(mockBreakdown);

      await service.simulatePricing({
        organizationId: '550e8400-e29b-41d4-a716-446655440000',
        planCode: 'pro',
        billingPeriod: 'monthly',
      });

      expect(pricingEngine.calculatePriceBreakdown).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: '00000000-0000-0000-0000-000000000000',
        }),
      );
    });
  });

  // =========================================================================
  // 4. simulateProration
  // =========================================================================
  describe('simulateProration', () => {
    const mockProration = {
      creditAmount: 16650,
      chargeAmount: 41625,
      netAmount: 24975,
      currency: 'PHP',
      daysRemaining: 15,
      totalDays: 30,
      currentDailyRate: 3330,
      newDailyRate: 8325,
    };

    it('should delegate to proration service and return enriched result', async () => {
      prorationService.calculateProration.mockResolvedValue(mockProration);

      const result = await service.simulateProration({
        currentPlanCode: 'pro',
        newPlanCode: 'team',
        billingPeriod: 'monthly',
        periodStart: '2026-03-01T00:00:00.000Z',
        periodEnd: '2026-04-01T00:00:00.000Z',
        effectiveDate: '2026-03-15T00:00:00.000Z',
      });

      expect(result.currentPlanCode).toBe('pro');
      expect(result.newPlanCode).toBe('team');
      expect(result.creditAmount).toBe(16650);
      expect(result.chargeAmount).toBe(41625);
      expect(result.netAmount).toBe(24975);
      expect(result.daysRemaining).toBe(15);
      expect(result.totalDays).toBe(30);
      expect(result.effectiveDate).toBe('2026-03-15T00:00:00.000Z');
    });

    it('should use current date when effectiveDate is not provided', async () => {
      prorationService.calculateProration.mockResolvedValue(mockProration);

      const before = new Date();
      const result = await service.simulateProration({
        currentPlanCode: 'pro',
        newPlanCode: 'team',
        billingPeriod: 'monthly',
        periodStart: '2026-03-01T00:00:00.000Z',
        periodEnd: '2026-04-01T00:00:00.000Z',
      });
      const after = new Date();

      const effectiveDate = new Date(result.effectiveDate);
      expect(effectiveDate.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(effectiveDate.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should pass system user ID as organizationId', async () => {
      prorationService.calculateProration.mockResolvedValue(mockProration);

      await service.simulateProration({
        currentPlanCode: 'edu',
        newPlanCode: 'pro',
        billingPeriod: 'annual',
        periodStart: '2026-01-01T00:00:00.000Z',
        periodEnd: '2027-01-01T00:00:00.000Z',
      });

      expect(prorationService.calculateProration).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: '00000000-0000-0000-0000-000000000000',
        }),
      );
    });

    it('should handle downgrade (negative net amount)', async () => {
      prorationService.calculateProration.mockResolvedValue({
        ...mockProration,
        creditAmount: 41625,
        chargeAmount: 16650,
        netAmount: -24975,
      });

      const result = await service.simulateProration({
        currentPlanCode: 'team',
        newPlanCode: 'pro',
        billingPeriod: 'monthly',
        periodStart: '2026-03-01T00:00:00.000Z',
        periodEnd: '2026-04-01T00:00:00.000Z',
      });

      expect(result.netAmount).toBe(-24975);
    });

    it('should propagate proration service errors', async () => {
      prorationService.calculateProration.mockRejectedValue(
        new BadRequestException('Invalid period dates'),
      );

      await expect(
        service.simulateProration({
          currentPlanCode: 'pro',
          newPlanCode: 'team',
          billingPeriod: 'monthly',
          periodStart: '2026-04-01T00:00:00.000Z',
          periodEnd: '2026-03-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // 5. simulateCoupon
  // =========================================================================
  describe('simulateCoupon', () => {
    it('should do full org-specific validation when organizationId provided', async () => {
      couponService.validateCoupon.mockResolvedValue({
        valid: true,
        coupon: {
          id: 'coupon-1',
          name: 'Launch Promo',
          code: 'LAUNCH2026',
          discountType: 'percentage' as never,
          discountValue: 20,
        } as never,
        errors: [],
        discountPreview: {
          originalAmount: 99900,
          discountAmount: 19980,
          finalAmount: 79920,
          discountType: 'percentage' as never,
          discountValue: 20,
          currency: 'PHP',
        },
      });

      const result = await service.simulateCoupon({
        couponCode: 'LAUNCH2026',
        planCode: 'pro',
        billingPeriod: 'monthly',
        organizationId: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(couponService.validateCoupon).toHaveBeenCalledWith(
        'LAUNCH2026',
        '550e8400-e29b-41d4-a716-446655440000',
        '00000000-0000-0000-0000-000000000000',
        'pro',
        'monthly',
      );
      expect(result.valid).toBe(true);
      expect(result.couponId).toBe('coupon-1');
      expect(result.couponName).toBe('Launch Promo');
      expect(result.discountPreview).toBeDefined();
      expect(result.discountPreview!.discountAmount).toBe(19980);
    });

    it('should return validation errors for invalid coupon with org context', async () => {
      couponService.validateCoupon.mockResolvedValue({
        valid: false,
        errors: ['Coupon has expired', 'Max redemptions reached'],
      });

      const result = await service.simulateCoupon({
        couponCode: 'EXPIRED',
        planCode: 'pro',
        billingPeriod: 'monthly',
        organizationId: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.couponId).toBeNull();
    });

    it('should use findByCode + calculateDiscount when no organizationId', async () => {
      couponService.findByCode.mockResolvedValue({
        id: 'coupon-2',
        name: 'No-Org Coupon',
        code: 'NOORG',
        discountType: 'fixed_amount',
        discountValue: 10000,
        currency: 'PHP',
      } as never);

      couponService.calculateDiscount.mockResolvedValue({
        originalAmount: 99900,
        discountAmount: 10000,
        finalAmount: 89900,
      });

      const result = await service.simulateCoupon({
        couponCode: 'NOORG',
        planCode: 'pro',
        billingPeriod: 'monthly',
      });

      expect(couponService.validateCoupon).not.toHaveBeenCalled();
      expect(couponService.findByCode).toHaveBeenCalledWith('NOORG');
      expect(result.valid).toBe(true);
      expect(result.couponId).toBe('coupon-2');
      expect(result.discountPreview!.discountAmount).toBe(10000);
    });

    it('should return not found when coupon code does not exist (no org)', async () => {
      couponService.findByCode.mockResolvedValue(null);

      const result = await service.simulateCoupon({
        couponCode: 'NONEXISTENT',
        planCode: 'pro',
        billingPeriod: 'monthly',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Coupon code not found');
      expect(result.couponId).toBeNull();
      expect(result.discountPreview).toBeNull();
    });

    it('should handle coupon with null discount preview in org validation', async () => {
      couponService.validateCoupon.mockResolvedValue({
        valid: true,
        coupon: {
          id: 'coupon-3',
          name: 'Bonus Coupon',
          discountType: 'bonus_credit',
          discountValue: 500,
        } as never,
        errors: [],
      });

      const result = await service.simulateCoupon({
        couponCode: 'BONUS',
        planCode: 'pro',
        billingPeriod: 'monthly',
        organizationId: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(result.valid).toBe(true);
      expect(result.discountPreview).toBeNull();
    });
  });

  // =========================================================================
  // 6. simulatePromotion
  // =========================================================================
  describe('simulatePromotion', () => {
    it('should delegate to promotion rule engine and return result', async () => {
      promotionRuleEngine.evaluatePromotion.mockResolvedValue({
        eligible: true,
        ruleResults: [
          { ruleType: 'date_range', passed: true },
          { ruleType: 'new_subscriber', passed: true },
        ],
        errors: [],
        discountPreview: {
          originalAmount: 99900,
          discountAmount: 29970,
          finalAmount: 69930,
          discountType: 'percentage_discount',
          discountValue: 30,
          currency: 'PHP',
        },
      });

      const result = await service.simulatePromotion({
        promotionId: 'promo-1',
        organizationId: '550e8400-e29b-41d4-a716-446655440000',
        planCode: 'pro',
        billingPeriod: 'monthly',
      });

      expect(promotionRuleEngine.evaluatePromotion).toHaveBeenCalledWith(
        'promo-1',
        '550e8400-e29b-41d4-a716-446655440000',
        '00000000-0000-0000-0000-000000000000',
        'pro',
        'monthly',
      );
      expect(result.eligible).toBe(true);
      expect(result.ruleResults).toHaveLength(2);
      expect(result.discountPreview).toBeDefined();
    });

    it('should return ineligible result with errors', async () => {
      promotionRuleEngine.evaluatePromotion.mockResolvedValue({
        eligible: false,
        ruleResults: [
          { ruleType: 'date_range', passed: false, reason: 'Promotion has not started yet' },
        ],
        errors: ['Promotion has not started yet'],
      });

      const result = await service.simulatePromotion({
        promotionId: 'promo-2',
        organizationId: '550e8400-e29b-41d4-a716-446655440000',
        planCode: 'pro',
        billingPeriod: 'monthly',
      });

      expect(result.eligible).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.discountPreview).toBeNull();
    });

    it('should handle promotion not found error', async () => {
      promotionRuleEngine.evaluatePromotion.mockRejectedValue(
        new BadRequestException('Promotion not found'),
      );

      await expect(
        service.simulatePromotion({
          promotionId: 'nonexistent',
          organizationId: '550e8400-e29b-41d4-a716-446655440000',
          planCode: 'pro',
          billingPeriod: 'monthly',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should pass through all rule results', async () => {
      promotionRuleEngine.evaluatePromotion.mockResolvedValue({
        eligible: false,
        ruleResults: [
          { ruleType: 'date_range', passed: true },
          { ruleType: 'new_subscriber', passed: false, reason: 'Not a new subscriber' },
          { ruleType: 'billing_period', passed: true },
          { ruleType: 'redemption_limit', passed: false, reason: 'Max redemptions reached' },
        ],
        errors: ['Not a new subscriber', 'Max redemptions reached'],
      });

      const result = await service.simulatePromotion({
        promotionId: 'promo-3',
        organizationId: '550e8400-e29b-41d4-a716-446655440000',
        planCode: 'pro',
        billingPeriod: 'annual',
      });

      expect(result.ruleResults).toHaveLength(4);
      expect(result.ruleResults.filter((r) => !r.passed)).toHaveLength(2);
    });
  });

  // =========================================================================
  // 7. simulateRevenueImpact
  // =========================================================================
  describe('simulateRevenueImpact', () => {
    // --- Validation ---
    it('should throw if neither couponId nor promotionId provided', async () => {
      await expect(
        service.simulateRevenueImpact({
          plans: [{ planCode: 'pro', billingPeriod: 'monthly' }],
        }),
      ).rejects.toThrow('Exactly one of couponId or promotionId is required');
    });

    it('should throw if both couponId and promotionId provided', async () => {
      await expect(
        service.simulateRevenueImpact({
          couponId: 'coupon-1',
          promotionId: 'promo-1',
          plans: [{ planCode: 'pro', billingPeriod: 'monthly' }],
        }),
      ).rejects.toThrow('Provide only one of couponId or promotionId, not both');
    });

    // --- Coupon revenue impact ---
    it('should calculate revenue impact for a coupon across plans', async () => {
      prisma.coupon.findUnique.mockResolvedValue({
        id: 'coupon-1',
        name: 'Launch Promo',
        discountType: 'percentage',
        discountValue: 20,
        currency: 'PHP',
      });

      pricingEngine.resolvePlanPrice
        .mockResolvedValueOnce({ amount: 99900, planName: 'Pro', planId: null, currency: 'PHP', source: 'hardcoded' as const })
        .mockResolvedValueOnce({ amount: 249900, planName: 'Team', planId: null, currency: 'PHP', source: 'hardcoded' as const });

      couponService.calculateDiscount
        .mockResolvedValueOnce({ originalAmount: 99900, discountAmount: 19980, finalAmount: 79920 })
        .mockResolvedValueOnce({ originalAmount: 249900, discountAmount: 49980, finalAmount: 199920 });

      const result = await service.simulateRevenueImpact({
        couponId: 'coupon-1',
        plans: [
          { planCode: 'pro', billingPeriod: 'monthly' },
          { planCode: 'team', billingPeriod: 'monthly' },
        ],
      });

      expect(result.sourceType).toBe('coupon');
      expect(result.sourceId).toBe('coupon-1');
      expect(result.sourceName).toBe('Launch Promo');
      expect(result.plans).toHaveLength(2);
      expect(result.totalBaseRevenue).toBe(349800);
      expect(result.totalDiscountedRevenue).toBe(279840);
      expect(result.totalDiscountAmount).toBe(69960);
      expect(result.currency).toBe('PHP');
      expect(result.simulatedAt).toBeDefined();
    });

    it('should throw if coupon not found', async () => {
      prisma.coupon.findUnique.mockResolvedValue(null);

      await expect(
        service.simulateRevenueImpact({
          couponId: 'nonexistent',
          plans: [{ planCode: 'pro', billingPeriod: 'monthly' }],
        }),
      ).rejects.toThrow('Coupon with ID nonexistent not found');
    });

    it('should calculate discount percentage correctly', async () => {
      prisma.coupon.findUnique.mockResolvedValue({
        id: 'coupon-1',
        name: 'Half Off',
        discountType: 'percentage',
        discountValue: 50,
        currency: 'PHP',
      });

      pricingEngine.resolvePlanPrice.mockResolvedValue({
        amount: 100000,
        planName: 'Pro',
        planId: null,
        currency: 'PHP',
        source: 'hardcoded' as const,
      });

      couponService.calculateDiscount.mockResolvedValue({
        originalAmount: 100000,
        discountAmount: 50000,
        finalAmount: 50000,
      });

      const result = await service.simulateRevenueImpact({
        couponId: 'coupon-1',
        plans: [{ planCode: 'pro', billingPeriod: 'monthly' }],
      });

      expect(result.plans[0].discountPercentage).toBe(50);
      expect(result.averageDiscountPercentage).toBe(50);
    });

    it('should handle zero base price gracefully', async () => {
      prisma.coupon.findUnique.mockResolvedValue({
        id: 'coupon-free',
        name: 'Free Plan Coupon',
        discountType: 'percentage',
        discountValue: 10,
        currency: 'PHP',
      });

      pricingEngine.resolvePlanPrice.mockResolvedValue({
        amount: 0,
        planName: 'Free',
        planId: null,
        currency: 'PHP',
        source: 'hardcoded' as const,
      });

      couponService.calculateDiscount.mockResolvedValue({
        originalAmount: 0,
        discountAmount: 0,
        finalAmount: 0,
      });

      const result = await service.simulateRevenueImpact({
        couponId: 'coupon-free',
        plans: [{ planCode: 'free', billingPeriod: 'monthly' }],
      });

      expect(result.plans[0].discountPercentage).toBe(0);
      expect(result.averageDiscountPercentage).toBe(0);
    });

    // --- Promotion revenue impact ---
    it('should calculate revenue impact for a promotion across plans', async () => {
      prisma.promotion.findUnique.mockResolvedValue({
        id: 'promo-1',
        name: 'Summer Sale',
        benefits: [
          { benefitType: 'percentage_discount', discountValue: 25, appliesToBillingPeriod: 'all' },
        ],
      });

      pricingEngine.resolvePlanPrice
        .mockResolvedValueOnce({ amount: 99900, planName: 'Pro', planId: null, currency: 'PHP', source: 'hardcoded' as const })
        .mockResolvedValueOnce({ amount: 999000, planName: 'Pro', planId: null, currency: 'PHP', source: 'hardcoded' as const });

      promotionRuleEngine.calculateDiscountPreview
        .mockResolvedValueOnce({
          originalAmount: 99900,
          discountAmount: 24975,
          finalAmount: 74925,
          discountType: 'percentage_discount',
          discountValue: 25,
          currency: 'PHP',
        })
        .mockResolvedValueOnce({
          originalAmount: 999000,
          discountAmount: 249750,
          finalAmount: 749250,
          discountType: 'percentage_discount',
          discountValue: 25,
          currency: 'PHP',
        });

      const result = await service.simulateRevenueImpact({
        promotionId: 'promo-1',
        plans: [
          { planCode: 'pro', billingPeriod: 'monthly' },
          { planCode: 'pro', billingPeriod: 'annual' },
        ],
      });

      expect(result.sourceType).toBe('promotion');
      expect(result.sourceId).toBe('promo-1');
      expect(result.sourceName).toBe('Summer Sale');
      expect(result.plans).toHaveLength(2);
      expect(result.totalBaseRevenue).toBe(1098900);
      expect(result.totalDiscountAmount).toBe(274725);
    });

    it('should throw if promotion not found', async () => {
      prisma.promotion.findUnique.mockResolvedValue(null);

      await expect(
        service.simulateRevenueImpact({
          promotionId: 'nonexistent',
          plans: [{ planCode: 'pro', billingPeriod: 'monthly' }],
        }),
      ).rejects.toThrow('Promotion with ID nonexistent not found');
    });

    it('should handle promotion with no discount preview (bonus_credit type)', async () => {
      prisma.promotion.findUnique.mockResolvedValue({
        id: 'promo-bonus',
        name: 'Bonus Promo',
        benefits: [
          { benefitType: 'bonus_credit', bonusEntitlementKey: 'ai_queries', bonusEntitlementValue: 100 },
        ],
      });

      pricingEngine.resolvePlanPrice.mockResolvedValue({
        amount: 99900,
        planName: 'Pro',
        planId: null,
        currency: 'PHP',
        source: 'hardcoded' as const,
      });

      promotionRuleEngine.calculateDiscountPreview.mockResolvedValue(undefined);

      const result = await service.simulateRevenueImpact({
        promotionId: 'promo-bonus',
        plans: [{ planCode: 'pro', billingPeriod: 'monthly' }],
      });

      expect(result.plans[0].discountAmount).toBe(0);
      expect(result.plans[0].finalAmount).toBe(99900);
      expect(result.totalDiscountAmount).toBe(0);
    });

    it('should cap final amount at zero (never negative)', async () => {
      prisma.promotion.findUnique.mockResolvedValue({
        id: 'promo-big',
        name: 'Over-Discount Promo',
        benefits: [{ benefitType: 'fixed_discount', discountValue: 200000 }],
      });

      pricingEngine.resolvePlanPrice.mockResolvedValue({
        amount: 99900,
        planName: 'Pro',
        planId: null,
        currency: 'PHP',
        source: 'hardcoded' as const,
      });

      promotionRuleEngine.calculateDiscountPreview.mockResolvedValue({
        originalAmount: 99900,
        discountAmount: 200000,
        finalAmount: -100100,
        discountType: 'fixed_discount',
        discountValue: 200000,
        currency: 'PHP',
      });

      const result = await service.simulateRevenueImpact({
        promotionId: 'promo-big',
        plans: [{ planCode: 'pro', billingPeriod: 'monthly' }],
      });

      expect(result.plans[0].finalAmount).toBe(0);
    });
  });
});
