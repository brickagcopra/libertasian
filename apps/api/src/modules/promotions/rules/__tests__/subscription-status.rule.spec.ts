import { SubscriptionStatusRule } from '../subscription-status.rule';
import type {
  PromotionEvaluationContext,
  PromotionRecord,
} from '../promotion-rule.interface';

describe('SubscriptionStatusRule', () => {
  const rule = new SubscriptionStatusRule();

  const baseContext: PromotionEvaluationContext = {
    now: new Date('2025-06-15T12:00:00Z'),
    organizationId: 'org-1',
    organizationType: 'individual',
    userId: 'user-1',
    planCode: 'pro',
    billingPeriod: 'monthly',
    subscriptionStatus: 'active',
    subscriptionPlanCode: 'pro',
    isNewSubscriber: false,
    globalRedemptionCount: 0,
    orgRedemptionCount: 0,
    hasActiveCoupon: false,
    hasActivePromotion: false,
  };

  const basePromotion: PromotionRecord = {
    id: 'promo-1',
    startsAt: null,
    endsAt: null,
    maxRedemptions: null,
    maxRedemptionsPerOrg: 1,
    currentRedemptions: 0,
    isStackableWithCoupons: false,
    isStackableWithPromos: false,
  };

  it('should have ruleType "subscription_status"', () => {
    expect(rule.ruleType).toBe('subscription_status');
  });

  it('should pass when no allowed or excluded statuses', () => {
    const result = rule.evaluate({}, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });

  it('should pass when status is in allowed list', () => {
    const config = { allowedStatuses: ['active', 'trialing'] };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });

  it('should fail when status is not in allowed list', () => {
    const config = { allowedStatuses: ['trialing', 'past_due'] };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('not eligible');
  });

  it('should fail when status is in excluded list', () => {
    const config = { excludedStatuses: ['active', 'canceled'] };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('excluded');
  });

  it('should pass when status is not in excluded list', () => {
    const config = { excludedStatuses: ['canceled', 'expired'] };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });

  it('should fail when subscriptionStatus is null', () => {
    const context = { ...baseContext, subscriptionStatus: null };
    const config = { allowedStatuses: ['active'] };
    const result = rule.evaluate(config, context, basePromotion);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('No active subscription');
  });

  it('should fail when subscriptionStatus is null even with no config', () => {
    const context = { ...baseContext, subscriptionStatus: null };
    const result = rule.evaluate({}, context, basePromotion);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('No active subscription');
  });
});
