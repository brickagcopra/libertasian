import type {
  IPromotionRule,
  PromotionEvaluationContext,
  PromotionRecord,
  RuleEvaluationResult,
} from './promotion-rule.interface';

/**
 * Filters promotion by billing period (monthly/annual).
 * Config: { allowedPeriods: string[] }
 */
export class BillingPeriodRule implements IPromotionRule {
  readonly ruleType = 'billing_period';

  evaluate(
    config: Record<string, unknown>,
    context: PromotionEvaluationContext,
    _promotion: PromotionRecord,
  ): RuleEvaluationResult {
    const allowedPeriods = config['allowedPeriods'] as string[] | undefined;

    if (allowedPeriods && Array.isArray(allowedPeriods) && allowedPeriods.length > 0) {
      if (!allowedPeriods.includes(context.billingPeriod)) {
        return {
          ruleType: this.ruleType,
          passed: false,
          reason: `Billing period '${context.billingPeriod}' is not eligible for this promotion`,
        };
      }
    }

    return { ruleType: this.ruleType, passed: true };
  }
}
