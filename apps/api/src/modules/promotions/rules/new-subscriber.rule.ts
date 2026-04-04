import type {
  IPromotionRule,
  PromotionEvaluationContext,
  PromotionRecord,
  RuleEvaluationResult,
} from './promotion-rule.interface';

/**
 * Restricts promotion to first-time subscribers only.
 * Config: { requireNewSubscriber: boolean }
 */
export class NewSubscriberRule implements IPromotionRule {
  readonly ruleType = 'new_subscriber';

  evaluate(
    config: Record<string, unknown>,
    context: PromotionEvaluationContext,
    _promotion: PromotionRecord,
  ): RuleEvaluationResult {
    const requireNewSubscriber = config['requireNewSubscriber'] as boolean | undefined;

    if (requireNewSubscriber && !context.isNewSubscriber) {
      return {
        ruleType: this.ruleType,
        passed: false,
        reason: 'Promotion is only available to new subscribers',
      };
    }

    return { ruleType: this.ruleType, passed: true };
  }
}
