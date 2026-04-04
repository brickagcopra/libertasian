import { Test, TestingModule } from '@nestjs/testing';

import { PricingEngineService } from '../pricing/pricing-engine.service';
import { ProrationService, type ProrationInput } from './proration.service';

/** Hardcoded plan prices (centavos) matching PricingEngineService defaults. */
const PLAN_PRICES: Record<string, { monthly: number; annual: number; name: string }> = {
  free: { monthly: 0, annual: 0, name: 'Free' },
  edu: { monthly: 29900, annual: 299000, name: 'Edu' },
  pro: { monthly: 99900, annual: 999000, name: 'Pro' },
  team: { monthly: 249900, annual: 2499000, name: 'Team' },
  enterprise: { monthly: 499900, annual: 4999000, name: 'Enterprise' },
};

function defaultResolvePlanPrice(planCode: string, billingPeriod: string, _organizationId?: string) {
  const plan = PLAN_PRICES[planCode];
  const amount = plan
    ? billingPeriod === 'annual' ? plan.annual : plan.monthly
    : 0;
  return Promise.resolve({
    amount,
    planName: plan?.name ?? planCode,
    planId: null,
    currency: 'PHP',
    source: 'hardcoded' as const,
  });
}

describe('ProrationService', () => {
  let service: ProrationService;
  let pricingEngineService: jest.Mocked<PricingEngineService>;

  const now = new Date('2026-03-01T00:00:00Z');
  const monthEnd = new Date('2026-03-31T00:00:00Z');
  const yearEnd = new Date('2027-03-01T00:00:00Z');

  const baseInput: ProrationInput = {
    organizationId: 'org-1',
    currentPlanCode: 'pro',
    newPlanCode: 'team',
    billingPeriod: 'monthly',
    currentPeriodStart: now,
    currentPeriodEnd: monthEnd,
    effectiveDate: now, // pin effective date so tests are deterministic
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProrationService,
        {
          provide: PricingEngineService,
          useValue: { resolvePlanPrice: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ProrationService>(ProrationService);
    pricingEngineService = module.get(PricingEngineService);

    // Default: return hardcoded prices based on plan code and billing period
    (pricingEngineService.resolvePlanPrice as jest.Mock).mockImplementation(defaultResolvePlanPrice);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ====================================================================
  // Basic Proration Calculations
  // ====================================================================

  describe('basic proration calculations', () => {
    it('calculates upgrade proration for monthly billing (pro → team)', async () => {
      const result = await service.calculateProration(baseInput);

      expect(result.currency).toBe('PHP');
      expect(result.totalDays).toBe(30); // Mar 1 → Mar 31 = 30 days
      expect(result.daysRemaining).toBe(30); // effective date = now = Mar 1, so full period
      // pro monthly = 99900, team monthly = 249900
      expect(result.creditAmount).toBe(99900); // full credit since full period remaining
      expect(result.chargeAmount).toBe(249900);
      expect(result.netAmount).toBe(150000); // 249900 - 99900
    });

    it('calculates mid-cycle proration (15 days remaining)', async () => {
      const effectiveDate = new Date('2026-03-16T00:00:00Z'); // 15 days remaining
      const result = await service.calculateProration({
        ...baseInput,
        effectiveDate,
      });

      expect(result.daysRemaining).toBe(15);
      expect(result.totalDays).toBe(30);
      // credit = floor(99900 * 15 / 30) = 49950
      expect(result.creditAmount).toBe(49950);
      // charge = floor(249900 * 15 / 30) = 124950
      expect(result.chargeAmount).toBe(124950);
      expect(result.netAmount).toBe(75000);
    });

    it('calculates annual billing proration', async () => {
      const result = await service.calculateProration({
        ...baseInput,
        billingPeriod: 'annual',
        currentPeriodEnd: yearEnd,
        effectiveDate: now,
      });

      // pro annual = 999000, team annual = 2499000
      expect(result.currency).toBe('PHP');
      expect(result.totalDays).toBeGreaterThan(360);
      expect(result.creditAmount).toBeGreaterThan(0);
      expect(result.chargeAmount).toBeGreaterThan(0);
      expect(result.netAmount).toBe(result.chargeAmount - result.creditAmount);
    });

    it('calculates downgrade proration (team → edu)', async () => {
      const result = await service.calculateProration({
        ...baseInput,
        currentPlanCode: 'team',
        newPlanCode: 'edu',
      });

      // team monthly = 249900, edu monthly = 29900
      expect(result.creditAmount).toBeGreaterThan(result.chargeAmount);
      expect(result.netAmount).toBeLessThan(0); // net is negative for downgrade
    });

    it('returns zero amounts when downgrading to free', async () => {
      const result = await service.calculateProration({
        ...baseInput,
        currentPlanCode: 'edu',
        newPlanCode: 'free',
      });

      expect(result.chargeAmount).toBe(0);
      expect(result.netAmount).toBeLessThan(0); // negative = credit to user
    });

    it('returns zero credit when upgrading from free', async () => {
      const result = await service.calculateProration({
        ...baseInput,
        currentPlanCode: 'free',
        newPlanCode: 'pro',
      });

      expect(result.creditAmount).toBe(0);
      expect(result.netAmount).toBe(result.chargeAmount);
    });
  });

  // ====================================================================
  // Edge Cases
  // ====================================================================

  describe('edge cases', () => {
    it('handles zero days remaining (effective date == period end)', async () => {
      const result = await service.calculateProration({
        ...baseInput,
        effectiveDate: monthEnd,
      });

      expect(result.daysRemaining).toBe(0);
      expect(result.creditAmount).toBe(0);
      expect(result.chargeAmount).toBe(0);
      expect(result.netAmount).toBe(0);
    });

    it('handles effective date after period end (clamps to 0)', async () => {
      const pastEnd = new Date('2026-04-05T00:00:00Z');
      const result = await service.calculateProration({
        ...baseInput,
        effectiveDate: pastEnd,
      });

      expect(result.daysRemaining).toBe(0);
      expect(result.creditAmount).toBe(0);
      expect(result.chargeAmount).toBe(0);
    });

    it('returns 0 for unknown plan codes', async () => {
      const result = await service.calculateProration({
        ...baseInput,
        currentPlanCode: 'nonexistent',
        newPlanCode: 'pro',
      });

      expect(result.creditAmount).toBe(0);
      expect(result.chargeAmount).toBeGreaterThan(0);
    });

    it('calculates daily rates correctly', async () => {
      const result = await service.calculateProration(baseInput);

      // pro monthly = 99900 / 30 days = 3330 per day
      expect(result.currentDailyRate).toBe(Math.floor(99900 / 30));
      // team monthly = 249900 / 30 days = 8330 per day
      expect(result.newDailyRate).toBe(Math.floor(249900 / 30));
    });

    it('ensures totalDays is at least 1 (prevents division by zero)', async () => {
      const result = await service.calculateProration({
        ...baseInput,
        currentPeriodStart: now,
        currentPeriodEnd: now, // same date
      });

      expect(result.totalDays).toBe(1);
    });
  });

  // ====================================================================
  // DB-Driven Price Resolution
  // ====================================================================

  describe('price resolution via PricingEngineService', () => {
    it('uses custom prices from resolvePlanPrice', async () => {
      (pricingEngineService.resolvePlanPrice as jest.Mock).mockImplementation(
        (planCode: string) => {
          if (planCode === 'pro') {
            return Promise.resolve({ amount: 79900, planName: 'Pro Custom', planId: 'plan-1', currency: 'PHP', source: 'database' });
          }
          if (planCode === 'team') {
            return Promise.resolve({ amount: 199900, planName: 'Team Custom', planId: 'plan-2', currency: 'PHP', source: 'database' });
          }
          return defaultResolvePlanPrice(planCode, 'monthly');
        },
      );

      const result = await service.calculateProration(baseInput);

      // credit from custom price: floor(79900 * 30/30) = 79900
      expect(result.creditAmount).toBe(79900);
      // charge from custom price: floor(199900 * 30/30) = 199900
      expect(result.chargeAmount).toBe(199900);
    });

    it('handles resolvePlanPrice throwing error', async () => {
      (pricingEngineService.resolvePlanPrice as jest.Mock).mockRejectedValue(
        new Error('Plan not found'),
      );

      await expect(service.calculateProration(baseInput)).rejects.toThrow(
        'Plan not found',
      );
    });

    it('calls resolvePlanPrice with correct parameters', async () => {
      await service.calculateProration(baseInput);

      expect(pricingEngineService.resolvePlanPrice).toHaveBeenCalledTimes(2);
      expect(pricingEngineService.resolvePlanPrice).toHaveBeenCalledWith('pro', 'monthly', 'org-1');
      expect(pricingEngineService.resolvePlanPrice).toHaveBeenCalledWith('team', 'monthly', 'org-1');
    });
  });

  // ====================================================================
  // Enterprise Plan Pricing
  // ====================================================================

  describe('enterprise plan pricing', () => {
    it('handles enterprise monthly pricing', async () => {
      const result = await service.calculateProration({
        ...baseInput,
        currentPlanCode: 'team',
        newPlanCode: 'enterprise',
      });

      // team=249900, enterprise=499900
      expect(result.netAmount).toBeGreaterThan(0);
    });

    it('handles enterprise annual pricing', async () => {
      const result = await service.calculateProration({
        ...baseInput,
        currentPlanCode: 'team',
        newPlanCode: 'enterprise',
        billingPeriod: 'annual',
        currentPeriodEnd: yearEnd,
      });

      // team annual=2499000, enterprise annual=4999000
      expect(result.netAmount).toBeGreaterThan(0);
    });
  });
});
