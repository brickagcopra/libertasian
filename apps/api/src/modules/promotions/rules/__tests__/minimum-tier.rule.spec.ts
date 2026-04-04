import { MinimumTierRule } from '../minimum-tier.rule';
import type {
  PromotionEvaluationContext,
  PromotionRecord,
} from '../promotion-rule.interface';

describe('MinimumTierRule', () => {
  const rule = new MinimumTierRule();

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

  it('should have ruleType "minimum_tier"', () => {
    expect(rule.ruleType).toBe('minimum_tier');
  });

  it('should pass when no minimumTier config', () => {
    const result = rule.evaluate({}, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });

  it('should pass when plan meets minimum tier', () => {
    const config = { minimumTier: 'edu' };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });

  it('should pass when plan equals minimum tier', () => {
    const config = { minimumTier: 'pro' };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });

  it('should fail when plan is below minimum tier', () => {
    const config = { minimumTier: 'team' };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('does not meet the minimum tier');
  });

  it('should fail for free plan with edu minimum', () => {
    const config = { minimumTier: 'edu' };
    const context = { ...baseContext, planCode: 'free' };
    const result = rule.evaluate(config, context, basePromotion);
    expect(result.passed).toBe(false);
  });
});
