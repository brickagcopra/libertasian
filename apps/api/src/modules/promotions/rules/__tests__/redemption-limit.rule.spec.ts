import { RedemptionLimitRule } from '../redemption-limit.rule';
import type {
  PromotionEvaluationContext,
  PromotionRecord,
} from '../promotion-rule.interface';

describe('RedemptionLimitRule', () => {
  const rule = new RedemptionLimitRule();

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
    maxRedemptions: 100,
    maxRedemptionsPerOrg: 1,
    currentRedemptions: 0,
    isStackableWithCoupons: false,
    isStackableWithPromos: false,
  };

  it('should have ruleType "redemption_limit"', () => {
    expect(rule.ruleType).toBe('redemption_limit');
  });

  it('should pass when under both limits', () => {
    const result = rule.evaluate({}, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });

  it('should fail when global redemption limit reached', () => {
    const context = { ...baseContext, globalRedemptionCount: 100 };
    const result = rule.evaluate({}, context, basePromotion);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('maximum number of redemptions');
  });

  it('should fail when per-org redemption limit reached', () => {
    const context = { ...baseContext, orgRedemptionCount: 1 };
    const result = rule.evaluate({}, context, basePromotion);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('Organization has already redeemed');
  });

  it('should pass when maxRedemptions is null (unlimited)', () => {
    const promo = { ...basePromotion, maxRedemptions: null };
    const context = { ...baseContext, globalRedemptionCount: 999999 };
    const result = rule.evaluate({}, context, promo);
    expect(result.passed).toBe(true);
  });

  it('should pass when under both limits with multiple allowed per org', () => {
    const promo = { ...basePromotion, maxRedemptionsPerOrg: 5 };
    const context = { ...baseContext, orgRedemptionCount: 3 };
    const result = rule.evaluate({}, context, promo);
    expect(result.passed).toBe(true);
  });
});
