import type { IPromotionRule } from './promotion-rule.interface';
import { DateRangeRule } from './date-range.rule';
import { PlanEligibilityRule } from './plan-eligibility.rule';
import { OrganizationTypeRule } from './organization-type.rule';
import { SubscriptionStatusRule } from './subscription-status.rule';
import { RedemptionLimitRule } from './redemption-limit.rule';
import { NewSubscriberRule } from './new-subscriber.rule';
import { BillingPeriodRule } from './billing-period.rule';
import { MinimumTierRule } from './minimum-tier.rule';
import { StackingRule } from './stacking.rule';

/**
 * Registry mapping rule type strings to rule instances.
 * Extension point: add new rules here to make them available to the engine.
 */
const RULE_REGISTRY: ReadonlyMap<string, IPromotionRule> = new Map<string, IPromotionRule>([
  ['date_range', new DateRangeRule()],
  ['plan_eligibility', new PlanEligibilityRule()],
  ['organization_type', new OrganizationTypeRule()],
  ['subscription_status', new SubscriptionStatusRule()],
  ['redemption_limit', new RedemptionLimitRule()],
  ['new_subscriber', new NewSubscriberRule()],
  ['billing_period', new BillingPeriodRule()],
  ['minimum_tier', new MinimumTierRule()],
  ['stacking', new StackingRule()],
]);

/** Get a rule instance by type string. Returns undefined if not registered. */
export function getRule(ruleType: string): IPromotionRule | undefined {
  return RULE_REGISTRY.get(ruleType);
}

/** Get all registered rule types. */
export function getRegisteredRuleTypes(): string[] {
  return Array.from(RULE_REGISTRY.keys());
}

/** Check if a rule type is registered. */
export function isRuleTypeRegistered(ruleType: string): boolean {
  return RULE_REGISTRY.has(ruleType);
}
