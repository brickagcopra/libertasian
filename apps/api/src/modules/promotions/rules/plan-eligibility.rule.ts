import type {
  IPromotionRule,
  PromotionEvaluationContext,
  PromotionRecord,
  RuleEvaluationResult,
} from './promotion-rule.interface';

/**
 * Checks if the target plan is in the include list (if specified)
 * and not in the exclude list.
 * Config: { includePlans?: string[], excludePlans?: string[] }
 */
export class PlanEligibilityRule implements IPromotionRule {
  readonly ruleType = 'plan_eligibility';

  evaluate(
    config: Record<string, unknown>,
    context: PromotionEvaluationContext,
    _promotion: PromotionRecord,
  ): RuleEvaluationResult {
    const { planCode } = context;
    const includePlans = config['includePlans'] as string[] | undefined;
    const excludePlans = config['excludePlans'] as string[] | undefined;

    if (excludePlans && Array.isArray(excludePlans) && excludePlans.includes(planCode)) {
      return {
        ruleType: this.ruleType,
        passed: false,
        reason: `Plan '${planCode}' is excluded from this promotion`,
      };
    }

    if (includePlans && Array.isArray(includePlans) && includePlans.length > 0) {
      if (!includePlans.includes(planCode)) {
        return {
          ruleType: this.ruleType,
          passed: false,
          reason: `Plan '${planCode}' is not eligible for this promotion`,
        };
      }
    }

    return { ruleType: this.ruleType, passed: true };
  }
}
