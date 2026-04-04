import type {
  IPromotionRule,
  PromotionEvaluationContext,
  PromotionRecord,
  RuleEvaluationResult,
} from './promotion-rule.interface';

/**
 * Filters promotions by organization type (individual, firm, government, etc.).
 * Config: { allowedTypes?: string[], excludedTypes?: string[] }
 */
export class OrganizationTypeRule implements IPromotionRule {
  readonly ruleType = 'organization_type';

  evaluate(
    config: Record<string, unknown>,
    context: PromotionEvaluationContext,
    _promotion: PromotionRecord,
  ): RuleEvaluationResult {
    const { organizationType } = context;
    const allowedTypes = config['allowedTypes'] as string[] | undefined;
    const excludedTypes = config['excludedTypes'] as string[] | undefined;

    if (excludedTypes && Array.isArray(excludedTypes) && excludedTypes.includes(organizationType)) {
      return {
        ruleType: this.ruleType,
        passed: false,
        reason: `Organization type '${organizationType}' is excluded from this promotion`,
      };
    }

    if (allowedTypes && Array.isArray(allowedTypes) && allowedTypes.length > 0) {
      if (!allowedTypes.includes(organizationType)) {
        return {
          ruleType: this.ruleType,
          passed: false,
          reason: `Organization type '${organizationType}' is not eligible for this promotion`,
        };
      }
    }

    return { ruleType: this.ruleType, passed: true };
  }
}
