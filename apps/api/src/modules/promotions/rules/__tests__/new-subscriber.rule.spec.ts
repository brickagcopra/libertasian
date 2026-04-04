import { NewSubscriberRule } from '../new-subscriber.rule';
import type {
  PromotionEvaluationContext,
  PromotionRecord,
} from '../promotion-rule.interface';

describe('NewSubscriberRule', () => {
  const rule = new NewSubscriberRule();

  const baseContext: PromotionEvaluationContext = {
    now: new Date('2025-06-15T12:00:00Z'),
    organizationId: 'org-1',
    organizationType: 'individual',
    userId: 'user-1',
    planCode: 'pro',
    billingPeriod: 'monthly',
    subscriptionStatus: null,
    subscriptionPlanCode: null,
    isNewSubscriber: true,
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

  it('should have ruleType "new_subscriber"', () => {
    expect(rule.ruleType).toBe('new_subscriber');
  });

  it('should pass when requireNewSubscriber is true and user is new', () => {
    const config = { requireNewSubscriber: true };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });

  it('should fail when requireNewSubscriber is true and user is not new', () => {
    const config = { requireNewSubscriber: true };
    const context = { ...baseContext, isNewSubscriber: false };
    const result = rule.evaluate(config, context, basePromotion);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('new subscribers');
  });

  it('should pass when requireNewSubscriber is false', () => {
    const config = { requireNewSubscriber: false };
    const context = { ...baseContext, isNewSubscriber: false };
    const result = rule.evaluate(config, context, basePromotion);
    expect(result.passed).toBe(true);
  });
});
