import { PlanEligibilityRule } from '../plan-eligibility.rule';
import type {
  PromotionEvaluationContext,
  PromotionRecord,
} from '../promotion-rule.interface';

describe('PlanEligibilityRule', () => {
  const rule = new PlanEligibilityRule();

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

  it('should have ruleType "plan_eligibility"', () => {
    expect(rule.ruleType).toBe('plan_eligibility');
  });

  it('should pass when no include or exclude lists', () => {
    const result = rule.evaluate({}, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });

  it('should pass when plan is in include list', () => {
    const config = { includePlans: ['pro', 'team'] };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });

  it('should fail when plan is not in include list', () => {
    const config = { includePlans: ['edu', 'team'] };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('not eligible');
  });

  it('should fail when plan is in exclude list', () => {
    const config = { excludePlans: ['pro', 'free'] };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('excluded');
  });

  it('should pass when plan is not in exclude list', () => {
    const config = { excludePlans: ['free', 'edu'] };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });

  it('should fail exclude before checking include', () => {
    const config = { includePlans: ['pro', 'team'], excludePlans: ['pro'] };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('excluded');
  });

  it('should pass with empty include list (no restriction)', () => {
    const config = { includePlans: [] };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });
});
