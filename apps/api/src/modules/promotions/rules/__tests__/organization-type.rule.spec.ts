import { OrganizationTypeRule } from '../organization-type.rule';
import type {
  PromotionEvaluationContext,
  PromotionRecord,
} from '../promotion-rule.interface';

describe('OrganizationTypeRule', () => {
  const rule = new OrganizationTypeRule();

  const baseContext: PromotionEvaluationContext = {
    now: new Date('2025-06-15T12:00:00Z'),
    organizationId: 'org-1',
    organizationType: 'firm',
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

  it('should have ruleType "organization_type"', () => {
    expect(rule.ruleType).toBe('organization_type');
  });

  it('should pass when no allowed or excluded types', () => {
    const result = rule.evaluate({}, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });

  it('should pass when org type is in allowed list', () => {
    const config = { allowedTypes: ['firm', 'government'] };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });

  it('should fail when org type is not in allowed list', () => {
    const config = { allowedTypes: ['government', 'individual'] };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('not eligible');
  });

  it('should fail when org type is in excluded list', () => {
    const config = { excludedTypes: ['firm'] };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('excluded');
  });

  it('should pass when org type is not in excluded list', () => {
    const config = { excludedTypes: ['government'] };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });

  it('should fail excluded before checking allowed', () => {
    const config = { allowedTypes: ['firm'], excludedTypes: ['firm'] };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('excluded');
  });

  it('should pass with empty allowed list (no restriction)', () => {
    const config = { allowedTypes: [] };
    const result = rule.evaluate(config, baseContext, basePromotion);
    expect(result.passed).toBe(true);
  });
});
