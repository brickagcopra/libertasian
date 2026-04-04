import type {
  IPromotionRule,
  PromotionEvaluationContext,
  PromotionRecord,
  RuleEvaluationResult,
} from './promotion-rule.interface';

/** Tier hierarchy: higher index = higher tier */
const TIER_HIERARCHY: Record<string, number> = {
  free: 0,
  edu: 1,
  pro: 2,
  team: 3,
  enterprise: 4,
};

/**
 * Requires the target plan to be at or above a minimum tier.
 * Config: { minimumTier: string }
 */
export class MinimumTierRule implements IPromotionRule {
  readonly ruleType = 'minimum_tier';

  evaluate(
    config: Record<string, unknown>,
    context: PromotionEvaluationContext,
    _promotion: PromotionRecord,
  ): RuleEvaluationResult {
    const minimumTier = config['minimumTier'] as string | undefined;

    if (!minimumTier) {
      return { ruleType: this.ruleType, passed: true };
    }

    const planRank = TIER_HIERARCHY[context.planCode] ?? -1;
    const minRank = TIER_HIERARCHY[minimumTier] ?? 0;

    if (planRank < minRank) {
      return {
        ruleType: this.ruleType,
        passed: false,
        reason: `Plan '${context.planCode}' does not meet the minimum tier '${minimumTier}'`,
      };
    }

    return { ruleType: this.ruleType, passed: true };
  }
}
