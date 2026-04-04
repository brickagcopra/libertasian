import { StackingRule } from '../stacking.rule';
import type {
  PromotionEvaluationContext,
  PromotionRecord,
} from '../promotion-rule.interface';

describe('StackingRule', () => {
  const rule = new StackingRule();

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

  it('should have ruleType "stacking"', () => {
    expect(rule.ruleType).toBe('stacking');
  });

  it('should pass when no active coupon or promo', () => {
    const result = rule.evaluate({}, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });

  it('should fail when has active coupon and not stackable', () => {
    const context = { ...baseContext, hasActiveCoupon: true };
    const result = rule.evaluate({}, context, basePromotion);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('coupon');
  });

  it('should pass when has active coupon and is stackable with coupons', () => {
    const context = { ...baseContext, hasActiveCoupon: true };
    const promo = { ...basePromotion, isStackableWithCoupons: true };
    const result = rule.evaluate({}, context, promo);
    expect(result.passed).toBe(true);
  });

  it('should fail when has active promo and not stackable', () => {
    const context = { ...baseContext, hasActivePromotion: true };
    const result = rule.evaluate({}, context, basePromotion);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('another active promotion');
  });

  it('should pass when has active promo and is stackable with promos', () => {
    const context = { ...baseContext, hasActivePromotion: true };
    const promo = { ...basePromotion, isStackableWithPromos: true };
    const result = rule.evaluate({}, context, promo);
    expect(result.passed).toBe(true);
  });
});
