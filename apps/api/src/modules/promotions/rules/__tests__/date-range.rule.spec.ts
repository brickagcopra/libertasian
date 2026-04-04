import { DateRangeRule } from '../date-range.rule';
import type {
  PromotionEvaluationContext,
  PromotionRecord,
} from '../promotion-rule.interface';

describe('DateRangeRule', () => {
  const rule = new DateRangeRule();

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
    startsAt: new Date('2025-06-01T00:00:00Z'),
    endsAt: new Date('2025-06-30T23:59:59Z'),
    maxRedemptions: null,
    maxRedemptionsPerOrg: 1,
    currentRedemptions: 0,
    isStackableWithCoupons: false,
    isStackableWithPromos: false,
  };

  it('should have ruleType "date_range"', () => {
    expect(rule.ruleType).toBe('date_range');
  });

  it('should pass when now is within startsAt and endsAt', () => {
    const result = rule.evaluate({}, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });

  it('should fail when now is before startsAt', () => {
    const context = { ...baseContext, now: new Date('2025-05-15T12:00:00Z') };
    const result = rule.evaluate({}, context, basePromotion);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('not started yet');
  });

  it('should fail when now is after endsAt', () => {
    const context = { ...baseContext, now: new Date('2025-07-15T12:00:00Z') };
    const result = rule.evaluate({}, context, basePromotion);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('expired');
  });

  it('should pass when startsAt is null (no start restriction)', () => {
    const promo = { ...basePromotion, startsAt: null };
    const result = rule.evaluate({}, baseContext, promo);
    expect(result.passed).toBe(true);
  });

  it('should pass when endsAt is null (no end restriction)', () => {
    const promo = { ...basePromotion, endsAt: null };
    const result = rule.evaluate({}, baseContext, promo);
    expect(result.passed).toBe(true);
  });

  it('should pass when both startsAt and endsAt are null', () => {
    const promo = { ...basePromotion, startsAt: null, endsAt: null };
    const result = rule.evaluate({}, baseContext, promo);
    expect(result.passed).toBe(true);
  });

  it('should pass when now equals startsAt exactly', () => {
    const context = { ...baseContext, now: new Date('2025-06-01T00:00:00Z') };
    const result = rule.evaluate({}, context, basePromotion);
    expect(result.passed).toBe(true);
  });
});
