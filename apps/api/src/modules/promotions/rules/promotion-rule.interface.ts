// ==========================================================================
// Promotion Rule Engine — Interfaces & Context Types
// ==========================================================================

/** Result of evaluating a single rule */
export interface RuleEvaluationResult {
  ruleType: string;
  passed: boolean;
  reason?: string;
}

/** Pre-fetched context passed to every rule evaluator */
export interface PromotionEvaluationContext {
  /** Current timestamp for date checks */
  now: Date;

  /** Organization being evaluated */
  organizationId: string;
  organizationType: string;

  /** User applying */
  userId: string;

  /** Target plan and billing period */
  planCode: string;
  billingPeriod: string;

  /** Current subscription state (null if no active subscription) */
  subscriptionStatus: string | null;
  subscriptionPlanCode: string | null;

  /** Whether this org has ever had a paid subscription */
  isNewSubscriber: boolean;

  /** Current redemption counts for the promotion being evaluated */
  globalRedemptionCount: number;
  orgRedemptionCount: number;

  /** Active coupon/promo reservations for stacking checks */
  hasActiveCoupon: boolean;
  hasActivePromotion: boolean;
}

/** Shape of a Promotion row from Prisma (minimal fields needed by rules) */
export interface PromotionRecord {
  id: string;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  maxRedemptionsPerOrg: number;
  currentRedemptions: number;
  isStackableWithCoupons: boolean;
  isStackableWithPromos: boolean;
}

/**
 * Interface that all promotion rules must implement.
 * Rules are pure functions — no DI, no DB calls.
 * All data is pre-fetched into PromotionEvaluationContext by the engine.
 */
export interface IPromotionRule {
  readonly ruleType: string;

  evaluate(
    config: Record<string, unknown>,
    context: PromotionEvaluationContext,
    promotion: PromotionRecord,
  ): RuleEvaluationResult;
}
