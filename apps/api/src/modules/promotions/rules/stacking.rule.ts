import type {
  IPromotionRule,
  PromotionEvaluationContext,
  PromotionRecord,
  RuleEvaluationResult,
} from './promotion-rule.interface';

/**
 * Checks whether the promotion can stack with active coupons/other promotions.
 * Config: {} (uses promotion stacking flags directly)
 */
export class StackingRule implements IPromotionRule {
  readonly ruleType = 'stacking';

  evaluate(
    _config: Record<string, unknown>,
    context: PromotionEvaluationContext,
    promotion: PromotionRecord,
  ): RuleEvaluationResult {
    if (context.hasActiveCoupon && !promotion.isStackableWithCoupons) {
      return {
        ruleType: this.ruleType,
        passed: false,
        reason: 'Promotion cannot be combined with an active coupon',
      };
    }

    if (context.hasActivePromotion && !promotion.isStackableWithPromos) {
      return {
        ruleType: this.ruleType,
        passed: false,
        reason: 'Promotion cannot be combined with another active promotion',
      };
    }

    return { ruleType: this.ruleType, passed: true };
  }
}
