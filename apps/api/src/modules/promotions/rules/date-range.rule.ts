import type {
  IPromotionRule,
  PromotionEvaluationContext,
  PromotionRecord,
  RuleEvaluationResult,
} from './promotion-rule.interface';

/**
 * Validates that the current time is within the promotion's startsAt/endsAt window.
 * Config: {} (uses promotion dates directly)
 */
export class DateRangeRule implements IPromotionRule {
  readonly ruleType = 'date_range';

  evaluate(
    _config: Record<string, unknown>,
    context: PromotionEvaluationContext,
    promotion: PromotionRecord,
  ): RuleEvaluationResult {
    const { now } = context;

    if (promotion.startsAt && now < promotion.startsAt) {
      return { ruleType: this.ruleType, passed: false, reason: 'Promotion has not started yet' };
    }

    if (promotion.endsAt && now > promotion.endsAt) {
      return { ruleType: this.ruleType, passed: false, reason: 'Promotion has expired' };
    }

    return { ruleType: this.ruleType, passed: true };
  }
}
