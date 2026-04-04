import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';

import type { PriceBreakdown, PriceLineItem, ResolvedPlanPrice } from '@libertasian/types';
import { PrismaService } from '../../prisma/prisma.service';
import { FeatureFlagService } from '../feature-flags/feature-flags.service';
import { PlansService } from '../plans/plans.service';
import { CouponService } from '../coupons/coupon.service';
import { PromotionRuleEngineService } from '../promotions/promotion-rule-engine.service';

/**
 * LEGACY FALLBACK — Canonical plan pricing in centavos (PHP).
 * Used only when feature flag `billing.db_plans` is disabled or DB lookup fails.
 * Prefer DB-driven pricing via PlansService + PlanPrice table.
 * Must stay in sync with `prisma/seeds/plan-seed.ts` values.
 */
export const PLAN_PRICING: Record<
  string,
  { monthly: number; annual: number; name: string }
> = {
  free: { monthly: 0, annual: 0, name: 'Free' },
  edu: { monthly: 29900, annual: 299000, name: 'Edu' },
  pro: { monthly: 99900, annual: 999000, name: 'Pro' },
  team: { monthly: 249900, annual: 2499000, name: 'Team' },
  enterprise: { monthly: 499900, annual: 4999000, name: 'Enterprise' },
};

// ---- Input type for calculatePriceBreakdown ----

export interface CalculateBreakdownInput {
  organizationId: string;
  userId: string;
  planCode: string;
  billingPeriod: string;
  couponCode?: string;
  promotionId?: string;
}

@Injectable()
export class PricingEngineService {
  private readonly logger = new Logger(PricingEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly featureFlagService: FeatureFlagService,
    private readonly plansService: PlansService,
    @Inject(forwardRef(() => CouponService))
    private readonly couponService: CouponService,
    private readonly promotionRuleEngine: PromotionRuleEngineService,
  ) {}

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Resolve the plan price from DB (when feature flag is on) or hardcoded fallback.
   */
  async resolvePlanPrice(
    planCode: string,
    billingPeriod: string,
    organizationId?: string,
  ): Promise<ResolvedPlanPrice> {
    const useDbPlans = organizationId
      ? await this.featureFlagService.isEnabled(
          'billing.db_plans',
          organizationId,
          planCode,
        )
      : false;

    if (useDbPlans) {
      try {
        const plan = await this.plansService.findByCode(planCode);
        const interval = billingPeriod === 'annual' ? 'annual' : 'monthly';
        const price = plan.prices.find(
          (p) => p.billingInterval === interval && p.isActive,
        );

        if (price) {
          return {
            amount: price.amount,
            planName: plan.displayName ?? plan.name,
            planId: plan.id,
            currency: price.currency,
            source: 'database',
          };
        }

        this.logger.warn(
          `No active DB price for ${planCode}/${interval}, falling back to hardcoded`,
        );
      } catch {
        this.logger.warn(
          `DB plan resolution failed for "${planCode}", falling back to hardcoded pricing`,
        );
      }
    }

    // Hardcoded fallback
    const amount = this.getHardcodedPrice(planCode, billingPeriod);
    const name = this.getHardcodedPlanName(planCode);

    if (amount === null) {
      throw new BadRequestException(`Invalid plan code: ${planCode}`);
    }

    return {
      amount,
      planName: name,
      planId: null,
      currency: 'PHP',
      source: 'hardcoded',
    };
  }

  /**
   * Orchestrate full price calculation: base price + coupon + promotion + stacking.
   */
  async calculatePriceBreakdown(
    input: CalculateBreakdownInput,
  ): Promise<PriceBreakdown> {
    const {
      organizationId,
      userId,
      planCode,
      billingPeriod,
      couponCode,
      promotionId,
    } = input;

    // 1. Resolve base price
    const resolved = await this.resolvePlanPrice(
      planCode,
      billingPeriod,
      organizationId,
    );

    const lineItems: PriceLineItem[] = [
      {
        type: 'base_price',
        label: `${resolved.planName} Plan — ${billingPeriod === 'annual' ? 'Annual' : 'Monthly'}`,
        amount: resolved.amount,
        referenceId: resolved.planId,
        referenceCode: planCode,
        metadata: { source: resolved.source },
      },
    ];

    // 2. Calculate coupon discount
    let couponId: string | null = null;
    let appliedCouponCode: string | null = null;
    let couponDiscountAmount = 0;

    if (couponCode) {
      const validation = await this.couponService.validateCoupon(
        couponCode,
        organizationId,
        userId,
        planCode,
        billingPeriod,
      );

      if (validation.valid && validation.discountPreview) {
        couponId = validation.coupon!.id;
        appliedCouponCode = validation.coupon!.code;
        couponDiscountAmount = validation.discountPreview.discountAmount;

        lineItems.push({
          type: 'coupon_discount',
          label: `Coupon: ${appliedCouponCode}`,
          amount: -couponDiscountAmount,
          referenceId: couponId,
          referenceCode: appliedCouponCode,
          metadata: {
            discountType: validation.coupon!.discountType,
            discountValue: validation.coupon!.discountValue,
          },
        });
      } else {
        this.logger.warn(
          `Coupon "${couponCode}" invalid for checkout: ${validation.errors.join('; ')}`,
        );
      }
    }

    // 3. Calculate promotion discount
    let appliedPromotionId: string | null = null;
    let promotionDiscountAmount = 0;
    let isStackableWithCoupons = false;

    if (promotionId) {
      const eligibility = await this.promotionRuleEngine.evaluatePromotion(
        promotionId,
        organizationId,
        userId,
        planCode,
        billingPeriod,
      );

      if (eligibility.eligible && eligibility.discountPreview) {
        appliedPromotionId = promotionId;
        promotionDiscountAmount = eligibility.discountPreview.discountAmount;

        // Fetch the stacking flag
        const promo = await this.prisma.promotion.findUnique({
          where: { id: promotionId },
          select: { isStackableWithCoupons: true },
        });
        isStackableWithCoupons = promo?.isStackableWithCoupons ?? false;

        lineItems.push({
          type: 'promotion_discount',
          label: `Promotion discount`,
          amount: -promotionDiscountAmount,
          referenceId: appliedPromotionId,
          referenceCode: null,
          metadata: {
            discountType: eligibility.discountPreview.discountType,
            discountValue: eligibility.discountPreview.discountValue,
          },
        });
      } else {
        this.logger.warn(
          `Promotion "${promotionId}" ineligible for checkout: ${eligibility.errors.join('; ')}`,
        );
      }
    }

    // 4. Stacking logic
    let totalDiscountAmount: number;
    let discountsStacked: boolean;

    if (couponDiscountAmount > 0 && promotionDiscountAmount > 0) {
      if (isStackableWithCoupons) {
        // Stack: sum both, cap at base price
        totalDiscountAmount = Math.min(
          couponDiscountAmount + promotionDiscountAmount,
          resolved.amount,
        );
        discountsStacked = true;
      } else {
        // Not stackable: take the larger discount
        if (couponDiscountAmount >= promotionDiscountAmount) {
          totalDiscountAmount = couponDiscountAmount;
          promotionDiscountAmount = 0;
          discountsStacked = false;
        } else {
          totalDiscountAmount = promotionDiscountAmount;
          couponDiscountAmount = 0;
          discountsStacked = false;
        }
      }
    } else {
      totalDiscountAmount = couponDiscountAmount + promotionDiscountAmount;
      discountsStacked = false;
    }

    const finalAmount = Math.max(0, resolved.amount - totalDiscountAmount);

    return {
      basePriceAmount: resolved.amount,
      couponId: couponDiscountAmount > 0 ? couponId : null,
      couponCode: couponDiscountAmount > 0 ? appliedCouponCode : null,
      couponDiscountAmount,
      promotionId: promotionDiscountAmount > 0 ? appliedPromotionId : null,
      promotionDiscountAmount,
      totalDiscountAmount,
      finalAmount,
      currency: resolved.currency,
      planCode,
      billingPeriod,
      planName: resolved.planName,
      planId: resolved.planId,
      discountsStacked,
      lineItems,
      calculatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get the hardcoded price in centavos for a plan + billing period.
   * Returns null if plan code is invalid.
   */
  getHardcodedPrice(planCode: string, billingPeriod: string): number | null {
    const pricing = PLAN_PRICING[planCode];
    if (!pricing) {
      return null;
    }
    return billingPeriod === 'annual' ? pricing.annual : pricing.monthly;
  }

  /**
   * Get the hardcoded display name for a plan.
   */
  getHardcodedPlanName(planCode: string): string {
    return PLAN_PRICING[planCode]?.name ?? planCode;
  }
}
