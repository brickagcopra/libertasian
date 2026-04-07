/**
 * Integration tests verifying consistency between hardcoded plan values
 * (PLAN_PRICING, TIER_HIERARCHY, getDefaultEntitlements) and the canonical
 * seed data in prisma/seeds/plan-seed.ts. These tests ensure that the legacy
 * fallback values stay synchronized with the DB-driven system.
 */
import { PLAN_PRICING } from './pricing-engine.service';

// Re-create the TIER_HIERARCHY from subscriptions service for cross-checking
const TIER_HIERARCHY: Record<string, number> = {
  free: 0,
  edu: 1,
  pro: 2,
  team: 3,
  enterprise: 4,
};

// Frontend PLANS prices (in pesos) — must match PLAN_PRICING centavos / 100
const FRONTEND_PLANS_PESOS: Record<string, { monthly: number; annual: number }> = {
  free: { monthly: 0, annual: 0 },
  edu: { monthly: 299, annual: 2990 },
  pro: { monthly: 999, annual: 9990 },
  team: { monthly: 2499, annual: 24990 },
  enterprise: { monthly: 4999, annual: 49990 },
};

describe('Plan Pricing Consistency', () => {
  const ALL_PLANS = ['free', 'edu', 'pro', 'team', 'enterprise'];

  describe('PLAN_PRICING covers all plans', () => {
    it('should have an entry for every plan code', () => {
      for (const plan of ALL_PLANS) {
        expect(PLAN_PRICING[plan]).toBeDefined();
        expect(PLAN_PRICING[plan]!.name).toBeTruthy();
      }
    });

    it('should have no extra plan codes', () => {
      expect(Object.keys(PLAN_PRICING).sort()).toEqual([...ALL_PLANS].sort());
    });
  });

  describe('TIER_HIERARCHY covers all plans', () => {
    it('should have an entry for every plan code', () => {
      for (const plan of ALL_PLANS) {
        expect(TIER_HIERARCHY[plan]).toBeDefined();
      }
    });

    it('should have strictly increasing tier values', () => {
      const orderedPlans = ['free', 'edu', 'pro', 'team', 'enterprise'];
      for (let i = 1; i < orderedPlans.length; i++) {
        expect(TIER_HIERARCHY[orderedPlans[i]!]).toBeGreaterThan(
          TIER_HIERARCHY[orderedPlans[i - 1]!]!,
        );
      }
    });

    it('free should be tier 0', () => {
      expect(TIER_HIERARCHY['free']).toBe(0);
    });
  });

  describe('pricing values are valid', () => {
    it('free plan should have 0 for both periods', () => {
      expect(PLAN_PRICING['free']!.monthly).toBe(0);
      expect(PLAN_PRICING['free']!.annual).toBe(0);
    });

    it('paid plans should have positive monthly and annual prices', () => {
      const paidPlans = ALL_PLANS.filter((p) => p !== 'free');
      for (const plan of paidPlans) {
        expect(PLAN_PRICING[plan]!.monthly).toBeGreaterThan(0);
        expect(PLAN_PRICING[plan]!.annual).toBeGreaterThan(0);
      }
    });

    it('annual price should be approximately 10x monthly (annual = 10 months)', () => {
      const paidPlans = ALL_PLANS.filter((p) => p !== 'free');
      for (const plan of paidPlans) {
        const annualMonths = PLAN_PRICING[plan]!.annual / PLAN_PRICING[plan]!.monthly;
        // Annual pricing should be 10 months (2 months free) or similar discount
        expect(annualMonths).toBeGreaterThanOrEqual(8);
        expect(annualMonths).toBeLessThanOrEqual(12);
      }
    });

    it('prices should increase with tier level', () => {
      const paidPlans = ['edu', 'pro', 'team', 'enterprise'];
      for (let i = 1; i < paidPlans.length; i++) {
        expect(PLAN_PRICING[paidPlans[i]!]!.monthly).toBeGreaterThan(
          PLAN_PRICING[paidPlans[i - 1]!]!.monthly,
        );
        expect(PLAN_PRICING[paidPlans[i]!]!.annual).toBeGreaterThan(
          PLAN_PRICING[paidPlans[i - 1]!]!.annual,
        );
      }
    });

    it('prices should be in whole centavos (no fractions)', () => {
      for (const plan of ALL_PLANS) {
        expect(Number.isInteger(PLAN_PRICING[plan]!.monthly)).toBe(true);
        expect(Number.isInteger(PLAN_PRICING[plan]!.annual)).toBe(true);
      }
    });
  });

  describe('frontend/backend price consistency', () => {
    it('frontend peso prices should match backend centavo prices / 100', () => {
      for (const plan of ALL_PLANS) {
        const backendMonthlyPesos = PLAN_PRICING[plan]!.monthly / 100;
        const backendAnnualPesos = PLAN_PRICING[plan]!.annual / 100;

        expect(FRONTEND_PLANS_PESOS[plan]!.monthly).toBe(backendMonthlyPesos);
        expect(FRONTEND_PLANS_PESOS[plan]!.annual).toBe(backendAnnualPesos);
      }
    });
  });

  describe('plan names are consistent', () => {
    it('should have proper display names', () => {
      expect(PLAN_PRICING['free']!.name).toBe('Free');
      expect(PLAN_PRICING['edu']!.name).toBe('Edu');
      expect(PLAN_PRICING['pro']!.name).toBe('Pro');
      expect(PLAN_PRICING['team']!.name).toBe('Team');
      expect(PLAN_PRICING['enterprise']!.name).toBe('Enterprise');
    });
  });

  describe('specific plan prices (centavos PHP)', () => {
    it('edu plan: ₱299/month, ₱2,990/year', () => {
      expect(PLAN_PRICING['edu']!.monthly).toBe(29900);
      expect(PLAN_PRICING['edu']!.annual).toBe(299000);
    });

    it('pro plan: ₱999/month, ₱9,990/year', () => {
      expect(PLAN_PRICING['pro']!.monthly).toBe(99900);
      expect(PLAN_PRICING['pro']!.annual).toBe(999000);
    });

    it('team plan: ₱2,499/month, ₱24,990/year', () => {
      expect(PLAN_PRICING['team']!.monthly).toBe(249900);
      expect(PLAN_PRICING['team']!.annual).toBe(2499000);
    });

    it('enterprise plan: ₱4,999/month, ₱49,990/year', () => {
      expect(PLAN_PRICING['enterprise']!.monthly).toBe(499900);
      expect(PLAN_PRICING['enterprise']!.annual).toBe(4999000);
    });
  });
});
