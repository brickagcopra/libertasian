import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { getRule } from './rules/rule-registry';
import type {
  PromotionEvaluationContext,
  PromotionRecord,
  RuleEvaluationResult,
} from './rules/promotion-rule.interface';

// ---- Constants ----

/** Cache TTL for eligible promotions (seconds) */
const ELIGIBLE_PROMOS_CACHE_TTL = 120; // 2 minutes

/** Cache TTL for pricing page promotions (seconds) */
const PRICING_PROMOS_CACHE_TTL = 300; // 5 minutes

/** Cache key prefix for eligible promotions */
const ELIGIBLE_PROMOS_CACHE_PREFIX = 'cache:promos:eligible:';

/** Cache key for pricing page promotions */
const PRICING_PROMOS_CACHE_KEY = 'cache:promos:pricing';

// ---- Types ----

export interface PromotionEligibilityResult {
  eligible: boolean;
  promotionId: string;
  ruleResults: RuleEvaluationResult[];
  errors: string[];
  discountPreview?: DiscountPreviewResult;
}

export interface DiscountPreviewResult {
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  discountType: string;
  discountValue: number;
  currency: string;
}

/** Shape of a full Promotion with rules/benefits from Prisma */
interface PromotionWithDetails {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  promotionType: string;
  status: string;
  priority: number;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  maxRedemptionsPerOrg: number;
  currentRedemptions: number;
  isStackableWithCoupons: boolean;
  isStackableWithPromos: boolean;
  isDisplayedOnPricing: boolean;
  metadataJson: unknown;
  createdAt: Date;
  rules: Array<{
    id: string;
    ruleType: string;
    configuration: unknown;
    ordering: number;
    isActive: boolean;
  }>;
  benefits: Array<{
    id: string;
    benefitType: string;
    discountValue: number | null;
    bonusEntitlementKey: string | null;
    bonusEntitlementValue: number | null;
    bonusDurationDays: number | null;
    trialExtensionDays: number | null;
    appliesToBillingPeriod: string;
  }>;
}

/** Shape for pricing page */
export interface ActivePromotionForPricing {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  promotionType: string;
  benefits: PromotionWithDetails['benefits'];
  endsAt: string | null;
}

@Injectable()
export class PromotionRuleEngineService {
  private readonly logger = new Logger(PromotionRuleEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(forwardRef(() => PricingEngineService))
    private readonly pricingEngine: PricingEngineService,
  ) {}

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Evaluate a single promotion's eligibility for a given org/user/plan.
   * Returns all rule results with error accumulation (does not short-circuit).
   */
  async evaluatePromotion(
    promotionId: string,
    organizationId: string,
    userId: string,
    planCode: string,
    billingPeriod: string,
  ): Promise<PromotionEligibilityResult> {
    const promotion = await this.fetchPromotionWithDetails(promotionId);
    if (!promotion) {
      return {
        eligible: false,
        promotionId,
        ruleResults: [],
        errors: ['Promotion not found'],
      };
    }

    if (promotion.status !== 'active') {
      return {
        eligible: false,
        promotionId,
        ruleResults: [],
        errors: [`Promotion is not active (status: ${promotion.status})`],
      };
    }

    // Check plan rules (include/exclude)
    const planRuleError = await this.checkPlanRules(promotionId, planCode);
    if (planRuleError) {
      return {
        eligible: false,
        promotionId,
        ruleResults: [],
        errors: [planRuleError],
      };
    }

    // Build context with all pre-fetched data
    const context = await this.buildContext(
      organizationId,
      userId,
      planCode,
      billingPeriod,
      promotionId,
    );

    const promotionRecord: PromotionRecord = {
      id: promotion.id,
      startsAt: promotion.startsAt,
      endsAt: promotion.endsAt,
      maxRedemptions: promotion.maxRedemptions,
      maxRedemptionsPerOrg: promotion.maxRedemptionsPerOrg,
      currentRedemptions: promotion.currentRedemptions,
      isStackableWithCoupons: promotion.isStackableWithCoupons,
      isStackableWithPromos: promotion.isStackableWithPromos,
    };

    // Evaluate all active rules (error accumulation — no short-circuit)
    const activeRules = promotion.rules
      .filter((r) => r.isActive)
      .sort((a, b) => a.ordering - b.ordering);

    const ruleResults: RuleEvaluationResult[] = [];
    const errors: string[] = [];

    for (const ruleRow of activeRules) {
      const ruleImpl = getRule(ruleRow.ruleType);
      if (!ruleImpl) {
        this.logger.warn(`Unknown rule type: ${ruleRow.ruleType} for promotion ${promotionId}`);
        ruleResults.push({
          ruleType: ruleRow.ruleType,
          passed: false,
          reason: `Unknown rule type: ${ruleRow.ruleType}`,
        });
        errors.push(`Unknown rule type: ${ruleRow.ruleType}`);
        continue;
      }

      const config = (ruleRow.configuration ?? {}) as Record<string, unknown>;
      const result = ruleImpl.evaluate(config, context, promotionRecord);
      ruleResults.push(result);

      if (!result.passed && result.reason) {
        errors.push(result.reason);
      }
    }

    const eligible = errors.length === 0;

    // Calculate discount preview if eligible
    let discountPreview: DiscountPreviewResult | undefined;
    if (eligible) {
      discountPreview = await this.calculateDiscountPreview(promotion.benefits, planCode, billingPeriod, organizationId);
    }

    return {
      eligible,
      promotionId,
      ruleResults,
      errors,
      discountPreview,
    };
  }

  /**
   * Find all active promotions that the given org/user is eligible for.
   * Results sorted by priority desc. Cached for 2 minutes.
   */
  async findEligiblePromotions(
    organizationId: string,
    userId: string,
    planCode: string,
    billingPeriod: string,
  ): Promise<PromotionEligibilityResult[]> {
    const cacheKey = `${ELIGIBLE_PROMOS_CACHE_PREFIX}${organizationId}:${planCode}:${billingPeriod}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as PromotionEligibilityResult[];
      } catch {
        // Corrupted cache, continue with fresh query
      }
    }

    // Fetch all active promotions sorted by priority desc
    const activePromotions = await this.prisma.promotion.findMany({
      where: { status: 'active' },
      orderBy: { priority: 'desc' },
      select: { id: true },
    });

    const results: PromotionEligibilityResult[] = [];

    for (const promo of activePromotions) {
      const result = await this.evaluatePromotion(
        promo.id,
        organizationId,
        userId,
        planCode,
        billingPeriod,
      );
      if (result.eligible) {
        results.push(result);
      }
    }

    await this.redis.set(cacheKey, JSON.stringify(results), ELIGIBLE_PROMOS_CACHE_TTL);

    return results;
  }

  /**
   * Get all active promotions that are flagged for display on the pricing page.
   * Cached for 5 minutes.
   */
  async getActivePromotionsForPricing(): Promise<ActivePromotionForPricing[]> {
    const cached = await this.redis.get(PRICING_PROMOS_CACHE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached) as ActivePromotionForPricing[];
      } catch {
        // Corrupted cache, continue with fresh query
      }
    }

    const promotions = await this.prisma.promotion.findMany({
      where: {
        status: 'active',
        isDisplayedOnPricing: true,
      },
      orderBy: { priority: 'desc' },
      include: {
        benefits: true,
      },
    });

    const result: ActivePromotionForPricing[] = promotions.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      promotionType: p.promotionType,
      benefits: p.benefits.map((b) => ({
        id: b.id,
        benefitType: b.benefitType,
        discountValue: b.discountValue,
        bonusEntitlementKey: b.bonusEntitlementKey,
        bonusEntitlementValue: b.bonusEntitlementValue,
        bonusDurationDays: b.bonusDurationDays,
        trialExtensionDays: b.trialExtensionDays,
        appliesToBillingPeriod: b.appliesToBillingPeriod,
      })),
      endsAt: p.endsAt?.toISOString() ?? null,
    }));

    await this.redis.set(PRICING_PROMOS_CACHE_KEY, JSON.stringify(result), PRICING_PROMOS_CACHE_TTL);

    return result;
  }

  /**
   * Calculate the discount preview for a set of benefits against a plan/period.
   * Mirrors CouponService.calculateDiscount with centavos/Math.round.
   */
  async calculateDiscountPreview(
    benefits: PromotionWithDetails['benefits'],
    planCode: string,
    billingPeriod: string,
    organizationId?: string,
  ): Promise<DiscountPreviewResult | undefined> {
    let originalAmount: number;
    let currency = 'PHP';
    try {
      const resolved = await this.pricingEngine.resolvePlanPrice(planCode, billingPeriod, organizationId);
      originalAmount = resolved.amount;
      currency = resolved.currency;
    } catch (err) {
      this.logger.warn(
        `Discount-preview price resolution failed for planCode=${planCode} billingPeriod=${billingPeriod} (no preview returned): ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
    let totalDiscount = 0;
    let primaryDiscountType = 'none';
    let primaryDiscountValue = 0;

    for (const benefit of benefits) {
      // Skip benefits that don't apply to this billing period
      if (
        benefit.appliesToBillingPeriod !== 'any' &&
        benefit.appliesToBillingPeriod !== billingPeriod
      ) {
        continue;
      }

      if (benefit.benefitType === 'percentage_discount' && benefit.discountValue) {
        const discount = Math.round((originalAmount * benefit.discountValue) / 100);
        totalDiscount += discount;
        primaryDiscountType = 'percentage_discount';
        primaryDiscountValue = benefit.discountValue;
      } else if (benefit.benefitType === 'fixed_discount' && benefit.discountValue) {
        totalDiscount += benefit.discountValue;
        primaryDiscountType = 'fixed_discount';
        primaryDiscountValue = benefit.discountValue;
      }
    }

    // Cap discount at original amount
    totalDiscount = Math.min(totalDiscount, originalAmount);

    return {
      originalAmount,
      discountAmount: totalDiscount,
      finalAmount: originalAmount - totalDiscount,
      discountType: primaryDiscountType,
      discountValue: primaryDiscountValue,
      currency,
    };
  }

  // ------------------------------------------------------------------
  // Internal Helpers
  // ------------------------------------------------------------------

  /** Build the evaluation context by pre-fetching all needed data. */
  async buildContext(
    organizationId: string,
    userId: string,
    planCode: string,
    billingPeriod: string,
    promotionId: string,
  ): Promise<PromotionEvaluationContext> {
    // Parallel fetch all needed data
    const [org, subscription, redemptionCounts, hasActiveCoupon, hasActivePromo, subHistory] =
      await Promise.all([
        this.prisma.organization.findUnique({
          where: { id: organizationId },
          select: { type: true },
        }),
        this.prisma.subscription.findFirst({
          where: { organizationId, status: { in: ['active', 'trialing', 'past_due'] } },
          select: { status: true, planCode: true },
          orderBy: { createdAt: 'desc' },
        }),
        this.getRedemptionCounts(promotionId, organizationId),
        this.prisma.couponRedemption
          .count({
            where: {
              organizationId,
              status: { in: ['reserved', 'redeemed'] },
            },
          })
          .then((c) => c > 0),
        this.prisma.promotionRedemption
          .count({
            where: {
              organizationId,
              status: 'applied',
              promotionId: { not: promotionId },
            },
          })
          .then((c) => c > 0),
        // Check if org has ever had a paid subscription (for new subscriber check)
        this.prisma.subscription.count({
          where: {
            organizationId,
            planCode: { notIn: ['free'] },
            status: { in: ['active', 'canceled', 'expired'] },
          },
        }),
      ]);

    return {
      now: new Date(),
      organizationId,
      organizationType: org?.type ?? 'individual',
      userId,
      planCode,
      billingPeriod,
      subscriptionStatus: subscription?.status ?? null,
      subscriptionPlanCode: subscription?.planCode ?? null,
      isNewSubscriber: subHistory === 0,
      globalRedemptionCount: redemptionCounts.global,
      orgRedemptionCount: redemptionCounts.org,
      hasActiveCoupon,
      hasActivePromotion: hasActivePromo,
    };
  }

  /** Get global and per-org redemption counts for a promotion. */
  private async getRedemptionCounts(
    promotionId: string,
    organizationId: string,
  ): Promise<{ global: number; org: number }> {
    const [global, org] = await Promise.all([
      this.prisma.promotionRedemption.count({
        where: { promotionId, status: 'applied' },
      }),
      this.prisma.promotionRedemption.count({
        where: { promotionId, organizationId, status: 'applied' },
      }),
    ]);
    return { global, org };
  }

  /** Check PromotionPlanRule include/exclude rules. Returns error message or null. */
  private async checkPlanRules(promotionId: string, planCode: string): Promise<string | null> {
    const planRules = await this.prisma.promotionPlanRule.findMany({
      where: { promotionId },
    });

    if (planRules.length === 0) {
      return null; // No plan restrictions
    }

    const includeRules = planRules.filter((r) => r.ruleType === 'include');
    const excludeRules = planRules.filter((r) => r.ruleType === 'exclude');

    // If there are exclude rules and the plan is in the list, reject
    if (excludeRules.some((r) => r.planCode === planCode)) {
      return `Plan '${planCode}' is excluded from this promotion`;
    }

    // If there are include rules, the plan must be in the list
    if (includeRules.length > 0 && !includeRules.some((r) => r.planCode === planCode)) {
      return `Plan '${planCode}' is not eligible for this promotion`;
    }

    return null;
  }

  /** Fetch promotion with rules and benefits. */
  private async fetchPromotionWithDetails(
    promotionId: string,
  ): Promise<PromotionWithDetails | null> {
    return this.prisma.promotion.findUnique({
      where: { id: promotionId },
      include: {
        rules: {
          orderBy: { ordering: 'asc' },
        },
        benefits: true,
      },
    });
  }

  /** Invalidate eligible promotions cache for an organization. */
  async invalidateEligibleCache(organizationId: string): Promise<void> {
    // Delete known cache patterns
    const patterns = ['monthly', 'annual'];
    const planCodes = ['free', 'edu', 'pro', 'team', 'enterprise'];

    for (const plan of planCodes) {
      for (const period of patterns) {
        await this.redis.del(`${ELIGIBLE_PROMOS_CACHE_PREFIX}${organizationId}:${plan}:${period}`);
      }
    }
  }

  /** Invalidate pricing page cache. */
  async invalidatePricingCache(): Promise<void> {
    await this.redis.del(PRICING_PROMOS_CACHE_KEY);
  }
}
