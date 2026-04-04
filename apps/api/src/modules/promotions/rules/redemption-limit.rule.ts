import type {
  IPromotionRule,
  PromotionEvaluationContext,
  PromotionRecord,
  RuleEvaluationResult,
} from './promotion-rule.interface';

/**
 * Checks global and per-organization redemption limits.
 * Config: {} (uses promotion limits directly)
 */
export class RedemptionLimitRule implements IPromotionRule {
  readonly ruleType = 'redemption_limit';

  evaluate(
    _config: Record<string, unknown>,
    context: PromotionEvaluationContext,
    promotion: PromotionRecord,
  ): RuleEvaluationResult {
    if (
      promotion.maxRedemptions !== null &&
      context.globalRedemptionCount >= promotion.maxRedemptions
    ) {
      return {
        ruleType: this.ruleType,
        passed: false,
        reason: 'Promotion has reached its maximum number of redemptions',
      };
    }

    if (context.orgRedemptionCount >= promotion.maxRedemptionsPerOrg) {
      return {
        ruleType: this.ruleType,
        passed: false,
        reason: 'Organization has already redeemed this promotion the maximum number of times',
      };
    }

    return { ruleType: this.ruleType, passed: true };
  }
}
