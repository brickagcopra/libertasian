import type {
  IPromotionRule,
  PromotionEvaluationContext,
  PromotionRecord,
  RuleEvaluationResult,
} from './promotion-rule.interface';

/**
 * Filters by current subscription status.
 * Config: { allowedStatuses?: string[], excludedStatuses?: string[] }
 */
export class SubscriptionStatusRule implements IPromotionRule {
  readonly ruleType = 'subscription_status';

  evaluate(
    config: Record<string, unknown>,
    context: PromotionEvaluationContext,
    _promotion: PromotionRecord,
  ): RuleEvaluationResult {
    const { subscriptionStatus } = context;
    const allowedStatuses = config['allowedStatuses'] as string[] | undefined;
    const excludedStatuses = config['excludedStatuses'] as string[] | undefined;

    if (!subscriptionStatus) {
      return {
        ruleType: this.ruleType,
        passed: false,
        reason: 'No active subscription found',
      };
    }

    if (
      excludedStatuses &&
      Array.isArray(excludedStatuses) &&
      excludedStatuses.includes(subscriptionStatus)
    ) {
      return {
        ruleType: this.ruleType,
        passed: false,
        reason: `Subscription status '${subscriptionStatus}' is excluded from this promotion`,
      };
    }

    if (allowedStatuses && Array.isArray(allowedStatuses) && allowedStatuses.length > 0) {
      if (!allowedStatuses.includes(subscriptionStatus)) {
        return {
          ruleType: this.ruleType,
          passed: false,
          reason: `Subscription status '${subscriptionStatus}' is not eligible for this promotion`,
        };
      }
    }

    return { ruleType: this.ruleType, passed: true };
  }
}
