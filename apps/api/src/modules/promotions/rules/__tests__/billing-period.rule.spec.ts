import { BillingPeriodRule } from '../billing-period.rule';
import type {
  PromotionEvaluationContext,
  PromotionRecord,
} from '../promotion-rule.interface';

describe('BillingPeriodRule', () => {
  const rule = new BillingPeriodRule();

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

  it('should have ruleType "billing_period"', () => {
    expect(rule.ruleType).toBe('billing_period');
  });

  it('should pass when no allowedPeriods config', () => {
    const result = rule.evaluate({}, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });

  it('should pass when billing period is in allowed list', () => {
    const config = { allowedPeriods: ['monthly', 'annual'] };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });

  it('should fail when billing period is not in allowed list', () => {
    const config = { allowedPeriods: ['annual'] };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('not eligible');
  });

  it('should pass annual billing period when allowed', () => {
    const config = { allowedPeriods: ['annual'] };
    const context = { ...baseContext, billingPeriod: 'annual' };
    const result = rule.evaluate(config, context, basePromotion);
    expect(result.passed).toBe(true);
  });

  it('should pass with empty allowedPeriods (no restriction)', () => {
    const config = { allowedPeriods: [] };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });
});
