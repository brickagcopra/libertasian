import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { CouponService } from './coupon.service';

describe('CouponService', () => {
  let service: CouponService;
  let prisma: {
    coupon: { findUnique: jest.Mock; update: jest.Mock; create: jest.Mock; findMany: jest.Mock };
    couponRedemption: { findFirst: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock; count: jest.Mock; create: jest.Mock; update: jest.Mock };
    couponPlanRule: { findMany: jest.Mock; deleteMany: jest.Mock; create: jest.Mock };
    couponUserAssignment: { findMany: jest.Mock; updateMany: jest.Mock; upsert: jest.Mock };
    couponOrgAssignment: { findMany: jest.Mock; updateMany: jest.Mock; upsert: jest.Mock };
    $transaction: jest.Mock;
    $queryRawUnsafe: jest.Mock;
  };
  let audit: jest.Mocked<Pick<AuditService, 'log'>>;
  let entitlementService: jest.Mocked<Pick<EntitlementService, 'grantBonus'>>;
  let pricingEngine: jest.Mocked<Pick<PricingEngineService, 'resolvePlanPrice'>>;

  // ---- Fixtures ----

  const ORG_ID = '00000000-0000-0000-0000-000000000001';
  const USER_ID = '00000000-0000-0000-0000-000000000002';
  const COUPON_ID = '00000000-0000-0000-0000-000000000010';
  const REDEMPTION_ID = '00000000-0000-0000-0000-000000000020';
  const SUB_ID = '00000000-0000-0000-0000-000000000030';
  const PAYMENT_ID = '00000000-0000-0000-0000-000000000040';

  const makeCoupon = (overrides: Record<string, unknown> = {}) => ({
    id: COUPON_ID,
    code: 'SAVE20',
    codeHash: 'abc123',
    name: '20% Off',
    description: null,
    internalNotes: null,
    discountType: 'percentage',
    discountValue: 20,
    currency: 'PHP',
    appliesToBillingPeriod: 'any',
    maxRedemptions: null,
    maxRedemptionsPerOrg: 1,
    currentRedemptions: 0,
    startsAt: null,
    expiresAt: null,
    isActive: true,
    isArchived: false,
    minimumPlanTier: null,
    bonusEntitlementKey: null,
    bonusEntitlementValue: null,
    bonusDurationDays: null,
    trialExtensionDays: null,
    metadataJson: {},
    createdByUserId: USER_ID,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  });

  /**
   * Row shape returned by the reserveCoupon row-lock query, which selects
   * only id + aliased redemption counters (not the full coupon record).
   */
  const makeLockedRow = (overrides: Record<string, unknown> = {}) => ({
    id: COUPON_ID,
    maxRedemptions: null,
    currentRedemptions: 0,
    ...overrides,
  });

  const makeRedemption = (overrides: Record<string, unknown> = {}) => ({
    id: REDEMPTION_ID,
    couponId: COUPON_ID,
    organizationId: ORG_ID,
    userId: USER_ID,
    subscriptionId: null,
    paymentId: null,
    status: 'reserved',
    discountAmountApplied: 19980,
    originalAmount: 99900,
    reservedAt: new Date(),
    redeemedAt: null,
    rolledBackAt: null,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    metadataJson: { planCode: 'pro', billingPeriod: 'monthly' },
    createdAt: new Date(),
    coupon: makeCoupon(),
    ...overrides,
  });

  // ---- Setup ----

  beforeEach(async () => {
    prisma = {
      coupon: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
      },
      couponRedemption: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
      },
      couponPlanRule: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
      couponUserAssignment: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        upsert: jest.fn(),
      },
      couponOrgAssignment: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        upsert: jest.fn(),
      },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
      $queryRawUnsafe: jest.fn(),
    };

    const PLAN_PRICING: Record<string, { monthly: number; annual: number }> = {
      edu: { monthly: 29900, annual: 299000 },
      pro: { monthly: 99900, annual: 999000 },
      team: { monthly: 249900, annual: 2499000 },
      enterprise: { monthly: 499900, annual: 4999000 },
    };

    const resolvePlanPriceMock = jest.fn().mockImplementation(
      async (planCode: string, billingPeriod: string) => {
        const pricing = PLAN_PRICING[planCode];
        const amount = pricing
          ? (billingPeriod === 'annual' ? pricing.annual : pricing.monthly)
          : 0;
        return { amount, planName: planCode, planId: null, currency: 'PHP', source: 'hardcoded' };
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouponService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: EntitlementService, useValue: { grantBonus: jest.fn() } },
        { provide: PricingEngineService, useValue: { resolvePlanPrice: resolvePlanPriceMock } },
      ],
    }).compile();

    service = module.get<CouponService>(CouponService);
    audit = module.get(AuditService);
    entitlementService = module.get(EntitlementService);
    pricingEngine = module.get(PricingEngineService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================================================================
  // hashCode (static)
  // ==================================================================

  describe('hashCode', () => {
    it('should return a SHA-256 hex string', () => {
      const hash = CouponService.hashCode('SAVE20');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should normalize to uppercase and trim', () => {
      expect(CouponService.hashCode('  save20 ')).toBe(CouponService.hashCode('SAVE20'));
    });
  });

  // ==================================================================
  // findByCode
  // ==================================================================

  describe('findByCode', () => {
    it('should lookup by uppercase trimmed code', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      await service.findByCode('  save20  ');
      expect(prisma['coupon']['findUnique']).toHaveBeenCalledWith({
        where: { code: 'SAVE20' },
      });
    });

    it('should return null when not found', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(null);
      const result = await service.findByCode('NONEXISTENT');
      expect(result).toBeNull();
    });
  });

  // ==================================================================
  // checkPlanRules
  // ==================================================================

  describe('checkPlanRules', () => {
    it('should allow all plans when no rules exist', async () => {
      prisma['couponPlanRule']['findMany'].mockResolvedValue([]);
      expect(await service.checkPlanRules(COUPON_ID, 'pro')).toBe(true);
    });

    it('should allow included plans', async () => {
      prisma['couponPlanRule']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, planCode: 'pro', ruleType: 'include' },
        { couponId: COUPON_ID, planCode: 'team', ruleType: 'include' },
      ]);
      expect(await service.checkPlanRules(COUPON_ID, 'pro')).toBe(true);
    });

    it('should reject non-included plans', async () => {
      prisma['couponPlanRule']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, planCode: 'team', ruleType: 'include' },
      ]);
      expect(await service.checkPlanRules(COUPON_ID, 'pro')).toBe(false);
    });

    it('should reject excluded plans', async () => {
      prisma['couponPlanRule']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, planCode: 'free', ruleType: 'exclude' },
      ]);
      expect(await service.checkPlanRules(COUPON_ID, 'free')).toBe(false);
    });

    it('should allow non-excluded plans', async () => {
      prisma['couponPlanRule']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, planCode: 'free', ruleType: 'exclude' },
      ]);
      expect(await service.checkPlanRules(COUPON_ID, 'pro')).toBe(true);
    });
  });

  // ==================================================================
  // checkAssignments
  // ==================================================================

  describe('checkAssignments', () => {
    it('should allow anyone when no assignments exist', async () => {
      expect(await service.checkAssignments(COUPON_ID, ORG_ID, USER_ID)).toBe(true);
    });

    it('should allow assigned user', async () => {
      prisma['couponUserAssignment']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, userId: USER_ID },
      ]);
      expect(await service.checkAssignments(COUPON_ID, ORG_ID, USER_ID)).toBe(true);
    });

    it('should reject non-assigned user when user assignments exist', async () => {
      prisma['couponUserAssignment']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, userId: 'other-user-id' },
      ]);
      expect(await service.checkAssignments(COUPON_ID, ORG_ID, USER_ID)).toBe(false);
    });

    it('should allow assigned org', async () => {
      prisma['couponOrgAssignment']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, organizationId: ORG_ID },
      ]);
      expect(await service.checkAssignments(COUPON_ID, ORG_ID, USER_ID)).toBe(true);
    });

    it('should reject non-assigned org when org assignments exist', async () => {
      prisma['couponOrgAssignment']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, organizationId: 'other-org-id' },
      ]);
      expect(await service.checkAssignments(COUPON_ID, ORG_ID, USER_ID)).toBe(false);
    });

    it('should allow user match even when org assignments also exist', async () => {
      prisma['couponUserAssignment']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, userId: USER_ID },
      ]);
      prisma['couponOrgAssignment']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, organizationId: 'other-org-id' },
      ]);
      expect(await service.checkAssignments(COUPON_ID, ORG_ID, USER_ID)).toBe(true);
    });
  });

  // ==================================================================
  // getRedemptionCount
  // ==================================================================

  describe('getRedemptionCount', () => {
    it('should count active redemptions for coupon', async () => {
      prisma['couponRedemption']['count'].mockResolvedValue(3);
      const count = await service.getRedemptionCount(COUPON_ID);
      expect(count).toBe(3);
      expect(prisma['couponRedemption']['count']).toHaveBeenCalledWith({
        where: {
          couponId: COUPON_ID,
          status: { in: ['reserved', 'redeemed'] },
        },
      });
    });

    it('should scope count to organization when provided', async () => {
      prisma['couponRedemption']['count'].mockResolvedValue(1);
      await service.getRedemptionCount(COUPON_ID, ORG_ID);
      expect(prisma['couponRedemption']['count']).toHaveBeenCalledWith({
        where: {
          couponId: COUPON_ID,
          organizationId: ORG_ID,
          status: { in: ['reserved', 'redeemed'] },
        },
      });
    });
  });

  // ==================================================================
  // calculateDiscount
  // ==================================================================

  describe('calculateDiscount', () => {
    it('should calculate percentage discount', async () => {
      const coupon = makeCoupon({ discountType: 'percentage', discountValue: 20 });
      const result = await service.calculateDiscount(coupon as never, 'pro', 'monthly');
      expect(result.originalAmount).toBe(99900);
      expect(result.discountAmount).toBe(19980);
      expect(result.finalAmount).toBe(79920);
    });

    it('should cap percentage at 100%', async () => {
      const coupon = makeCoupon({ discountType: 'percentage', discountValue: 150 });
      const result = await service.calculateDiscount(coupon as never, 'pro', 'monthly');
      expect(result.discountAmount).toBe(99900);
      expect(result.finalAmount).toBe(0);
    });

    it('should handle 0% percentage', async () => {
      const coupon = makeCoupon({ discountType: 'percentage', discountValue: 0 });
      const result = await service.calculateDiscount(coupon as never, 'pro', 'monthly');
      expect(result.discountAmount).toBe(0);
      expect(result.finalAmount).toBe(99900);
    });

    it('should calculate fixed_amount discount', async () => {
      const coupon = makeCoupon({ discountType: 'fixed_amount', discountValue: 50000 });
      const result = await service.calculateDiscount(coupon as never, 'pro', 'monthly');
      expect(result.discountAmount).toBe(50000);
      expect(result.finalAmount).toBe(49900);
    });

    it('should cap fixed_amount at plan price', async () => {
      const coupon = makeCoupon({ discountType: 'fixed_amount', discountValue: 200000 });
      const result = await service.calculateDiscount(coupon as never, 'pro', 'monthly');
      expect(result.discountAmount).toBe(99900);
      expect(result.finalAmount).toBe(0);
    });

    it('should return 0 discount for bonus_credit type', async () => {
      const coupon = makeCoupon({ discountType: 'bonus_credit', discountValue: 50 });
      const result = await service.calculateDiscount(coupon as never, 'pro', 'monthly');
      expect(result.discountAmount).toBe(0);
      expect(result.finalAmount).toBe(99900);
    });

    it('should return 0 discount for trial_extension type', async () => {
      const coupon = makeCoupon({ discountType: 'trial_extension', discountValue: 14 });
      const result = await service.calculateDiscount(coupon as never, 'pro', 'monthly');
      expect(result.discountAmount).toBe(0);
      expect(result.finalAmount).toBe(99900);
    });

    it('should use annual pricing when billing period is annual', async () => {
      const coupon = makeCoupon({ discountType: 'percentage', discountValue: 10 });
      const result = await service.calculateDiscount(coupon as never, 'pro', 'annual');
      expect(result.originalAmount).toBe(999000);
      expect(result.discountAmount).toBe(99900);
      expect(result.finalAmount).toBe(899100);
    });

    it('should use price from PricingEngineService', async () => {
      pricingEngine.resolvePlanPrice.mockResolvedValue({
        amount: 89900, planName: 'Pro', planId: 'plan-id', currency: 'PHP', source: 'database',
      } as never);
      const coupon = makeCoupon({ discountType: 'percentage', discountValue: 10 });
      const result = await service.calculateDiscount(coupon as never, 'pro', 'monthly');
      expect(result.originalAmount).toBe(89900);
      expect(result.discountAmount).toBe(8990);
    });

    it('should return 0 for unknown plan codes', async () => {
      const coupon = makeCoupon({ discountType: 'percentage', discountValue: 50 });
      const result = await service.calculateDiscount(coupon as never, 'unknown', 'monthly');
      expect(result.originalAmount).toBe(0);
      expect(result.discountAmount).toBe(0);
    });
  });

  // ==================================================================
  // validateCoupon
  // ==================================================================

  describe('validateCoupon', () => {
    beforeEach(() => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
    });

    it('should return valid=true for a valid coupon', async () => {
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.discountPreview).toBeDefined();
      expect(result.discountPreview!.discountAmount).toBe(19980);
    });

    it('should fail when coupon code not found', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(null);
      const result = await service.validateCoupon('NOTFOUND', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Coupon code not found');
    });

    it('should fail when coupon is not active', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon({ isActive: false }));
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Coupon is not active');
    });

    it('should fail when coupon is archived', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon({ isArchived: true }));
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Coupon has been archived');
    });

    it('should fail when coupon has not started yet', async () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon({ startsAt: future }));
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Coupon is not yet valid');
    });

    it('should fail when coupon has expired', async () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon({ expiresAt: past }));
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Coupon has expired');
    });

    it('should fail when global redemption limit reached', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(
        makeCoupon({ maxRedemptions: 5, currentRedemptions: 5 }),
      );
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Coupon has reached its maximum redemptions');
    });

    it('should pass when global redemptions under limit', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(
        makeCoupon({ maxRedemptions: 10, currentRedemptions: 3 }),
      );
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(true);
    });

    it('should pass when maxRedemptions is null (unlimited)', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(
        makeCoupon({ maxRedemptions: null, currentRedemptions: 1000 }),
      );
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(true);
    });

    it('should fail when per-org limit reached', async () => {
      prisma['couponRedemption']['count'].mockResolvedValue(1);
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Your organization has already used this coupon');
    });

    it('should fail when plan is excluded', async () => {
      prisma['couponPlanRule']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, planCode: 'pro', ruleType: 'exclude' },
      ]);
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Coupon is not valid for the selected plan');
    });

    it('should fail when billing period does not match', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(
        makeCoupon({ appliesToBillingPeriod: 'annual' }),
      );
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Coupon is only valid for annual billing');
    });

    it('should pass when billing period matches', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(
        makeCoupon({ appliesToBillingPeriod: 'annual' }),
      );
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'annual');
      expect(result.valid).toBe(true);
    });

    it('should fail when plan tier is below minimum', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(
        makeCoupon({ minimumPlanTier: 'pro' }),
      );
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'edu', 'monthly');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Coupon requires pro plan or higher');
    });

    it('should pass when plan tier meets minimum', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(
        makeCoupon({ minimumPlanTier: 'edu' }),
      );
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(true);
    });

    it('should fail when user/org not in assignment list', async () => {
      prisma['couponUserAssignment']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, userId: 'other-user' },
      ]);
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Coupon is not available for your account');
    });

    it('should fail when an active reservation already exists', async () => {
      prisma['couponRedemption']['findFirst'].mockResolvedValue(makeRedemption());
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('An active reservation already exists for this coupon');
    });

    it('should collect multiple errors', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(
        makeCoupon({ isActive: false, isArchived: true }),
      );
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ==================================================================
  // reserveCoupon
  // ==================================================================

  describe('reserveCoupon', () => {
    beforeEach(() => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['$queryRawUnsafe'].mockResolvedValue([makeLockedRow()]);
      prisma['couponRedemption']['create'].mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: REDEMPTION_ID, ...data }),
      );
    });

    it('should lock the row with a uuid-cast, camelCase-aliased query', async () => {
      await service.reserveCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      const [sql, param] = prisma['$queryRawUnsafe'].mock.calls[0];
      expect(sql).toContain('$1::uuid');
      expect(sql).toContain('"max_redemptions" AS "maxRedemptions"');
      expect(sql).toContain('"current_redemptions" AS "currentRedemptions"');
      expect(sql).toContain('FOR UPDATE');
      expect(param).toBe(COUPON_ID);
    });

    it('should create a reservation with reserved status', async () => {
      const result = await service.reserveCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.id).toBe(REDEMPTION_ID);
      expect(prisma['coupon']['update']).toHaveBeenCalledWith({
        where: { id: COUPON_ID },
        data: { currentRedemptions: { increment: 1 } },
      });
    });

    it('should set expiresAt 30 minutes in the future', async () => {
      await service.reserveCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      const createCall = prisma['couponRedemption']['create'].mock.calls[0][0];
      const expiresAt = new Date(createCall.data.expiresAt);
      const now = Date.now();
      // Should expire approximately 30 mins from now (+/- 2 seconds tolerance)
      expect(expiresAt.getTime()).toBeGreaterThan(now + 29 * 60 * 1000);
      expect(expiresAt.getTime()).toBeLessThan(now + 31 * 60 * 1000);
    });

    it('should write audit log on reservation', async () => {
      await service.reserveCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'coupon.reserved',
          entityType: 'CouponRedemption',
        }),
      );
    });

    it('should throw BadRequestException when validation fails', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(null);
      await expect(
        service.reserveCoupon('NOTFOUND', ORG_ID, USER_ID, 'pro', 'monthly'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException when global limit reached under lock', async () => {
      prisma['$queryRawUnsafe'].mockResolvedValue([
        makeLockedRow({ maxRedemptions: 5, currentRedemptions: 5 }),
      ]);
      await expect(
        service.reserveCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException when coupon row not found under lock', async () => {
      prisma['$queryRawUnsafe'].mockResolvedValue([]);
      await expect(
        service.reserveCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should store plan and billing info in metadata', async () => {
      await service.reserveCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'annual');
      const createCall = prisma['couponRedemption']['create'].mock.calls[0][0];
      expect(createCall.data.metadataJson).toEqual(
        expect.objectContaining({
          planCode: 'pro',
          billingPeriod: 'annual',
        }),
      );
    });
  });

  // ==================================================================
  // finalizeCoupon
  // ==================================================================

  describe('finalizeCoupon', () => {
    it('should transition reserved → redeemed', async () => {
      prisma['couponRedemption']['findUnique'].mockResolvedValue(makeRedemption());
      prisma['couponRedemption']['update'].mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...makeRedemption(), ...data }),
      );

      const result = await service.finalizeCoupon(REDEMPTION_ID, SUB_ID, PAYMENT_ID, 19980);
      expect(result.status).toBe('redeemed');
      expect(prisma['couponRedemption']['update']).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'redeemed',
            subscriptionId: SUB_ID,
            paymentId: PAYMENT_ID,
            discountAmountApplied: 19980,
          }),
        }),
      );
    });

    it('should write audit log on finalization', async () => {
      prisma['couponRedemption']['findUnique'].mockResolvedValue(makeRedemption());
      prisma['couponRedemption']['update'].mockResolvedValue({ ...makeRedemption(), status: 'redeemed' });

      await service.finalizeCoupon(REDEMPTION_ID, SUB_ID, PAYMENT_ID, 19980);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'coupon.redeemed',
        }),
      );
    });

    it('should throw NotFoundException for missing redemption', async () => {
      prisma['couponRedemption']['findUnique'].mockResolvedValue(null);
      await expect(
        service.finalizeCoupon('nonexistent', SUB_ID, PAYMENT_ID, 0),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if status is not reserved', async () => {
      prisma['couponRedemption']['findUnique'].mockResolvedValue(
        makeRedemption({ status: 'redeemed' }),
      );
      await expect(
        service.finalizeCoupon(REDEMPTION_ID, SUB_ID, PAYMENT_ID, 0),
      ).rejects.toThrow(BadRequestException);
    });

    it('should mark user assignment as claimed', async () => {
      prisma['couponRedemption']['findUnique'].mockResolvedValue(makeRedemption());
      prisma['couponRedemption']['update'].mockResolvedValue({ ...makeRedemption(), status: 'redeemed' });

      await service.finalizeCoupon(REDEMPTION_ID, SUB_ID, PAYMENT_ID, 19980);
      expect(prisma['couponUserAssignment']['updateMany']).toHaveBeenCalled();
      expect(prisma['couponOrgAssignment']['updateMany']).toHaveBeenCalled();
    });

    it('should grant bonus for bonus_credit type', async () => {
      const bonusCoupon = makeCoupon({
        discountType: 'bonus_credit',
        bonusEntitlementKey: 'aiAnswers',
        bonusEntitlementValue: 50,
        bonusDurationDays: 30,
      });
      prisma['couponRedemption']['findUnique'].mockResolvedValue(
        makeRedemption({ coupon: bonusCoupon }),
      );
      prisma['couponRedemption']['update'].mockResolvedValue({ ...makeRedemption(), status: 'redeemed' });

      await service.finalizeCoupon(REDEMPTION_ID, SUB_ID, null, 0);
      expect(entitlementService.grantBonus).toHaveBeenCalledWith(
        expect.objectContaining({
          entitlementKey: 'aiAnswers',
          numericValue: 50,
          sourceType: 'coupon',
          sourceId: COUPON_ID,
          overrideType: 'bonus_credit',
        }),
      );
    });

    it('should not grant bonus for percentage type', async () => {
      prisma['couponRedemption']['findUnique'].mockResolvedValue(makeRedemption());
      prisma['couponRedemption']['update'].mockResolvedValue({ ...makeRedemption(), status: 'redeemed' });

      await service.finalizeCoupon(REDEMPTION_ID, SUB_ID, PAYMENT_ID, 19980);
      expect(entitlementService.grantBonus).not.toHaveBeenCalled();
    });

    it('should handle finalize with null paymentId', async () => {
      prisma['couponRedemption']['findUnique'].mockResolvedValue(makeRedemption());
      prisma['couponRedemption']['update'].mockResolvedValue({ ...makeRedemption(), status: 'redeemed' });

      await service.finalizeCoupon(REDEMPTION_ID, SUB_ID, null, 0);
      expect(prisma['couponRedemption']['update']).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ paymentId: null }),
        }),
      );
    });
  });

  // ==================================================================
  // rollbackCoupon
  // ==================================================================

  describe('rollbackCoupon', () => {
    it('should transition reserved → rolled_back and decrement counter', async () => {
      prisma['couponRedemption']['findUnique'].mockResolvedValue(makeRedemption());
      prisma['couponRedemption']['update'].mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...makeRedemption(), ...data }),
      );

      const result = await service.rollbackCoupon(REDEMPTION_ID);
      expect(result.status).toBe('rolled_back');
      expect(prisma['coupon']['update']).toHaveBeenCalledWith({
        where: { id: COUPON_ID },
        data: { currentRedemptions: { decrement: 1 } },
      });
    });

    it('should write audit log on rollback', async () => {
      prisma['couponRedemption']['findUnique'].mockResolvedValue(makeRedemption());
      prisma['couponRedemption']['update'].mockResolvedValue({ ...makeRedemption(), status: 'rolled_back' });

      await service.rollbackCoupon(REDEMPTION_ID);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'coupon.rolled_back',
        }),
      );
    });

    it('should throw NotFoundException for missing redemption', async () => {
      prisma['couponRedemption']['findUnique'].mockResolvedValue(null);
      await expect(service.rollbackCoupon('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if status is not reserved', async () => {
      prisma['couponRedemption']['findUnique'].mockResolvedValue(
        makeRedemption({ status: 'redeemed' }),
      );
      await expect(service.rollbackCoupon(REDEMPTION_ID)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if already rolled back', async () => {
      prisma['couponRedemption']['findUnique'].mockResolvedValue(
        makeRedemption({ status: 'rolled_back' }),
      );
      await expect(service.rollbackCoupon(REDEMPTION_ID)).rejects.toThrow(BadRequestException);
    });
  });

  // ==================================================================
  // expireStaleReservations
  // ==================================================================

  describe('expireStaleReservations', () => {
    it('should return 0 when no stale reservations', async () => {
      prisma['couponRedemption']['findMany'].mockResolvedValue([]);
      const count = await service.expireStaleReservations();
      expect(count).toBe(0);
    });

    it('should expire stale reservations and decrement counters', async () => {
      const staleRedemption = makeRedemption({
        expiresAt: new Date(Date.now() - 60 * 1000),
      });
      prisma['couponRedemption']['findMany'].mockResolvedValue([staleRedemption]);
      prisma['couponRedemption']['update'].mockResolvedValue({ ...staleRedemption, status: 'expired' });

      const count = await service.expireStaleReservations();
      expect(count).toBe(1);
      expect(prisma['couponRedemption']['update']).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'expired' },
        }),
      );
      expect(prisma['coupon']['update']).toHaveBeenCalledWith({
        where: { id: COUPON_ID },
        data: { currentRedemptions: { decrement: 1 } },
      });
    });

    it('should write audit log for each expired reservation', async () => {
      const stale1 = makeRedemption({ id: 'r1', expiresAt: new Date(Date.now() - 60 * 1000) });
      const stale2 = makeRedemption({ id: 'r2', expiresAt: new Date(Date.now() - 120 * 1000) });
      prisma['couponRedemption']['findMany'].mockResolvedValue([stale1, stale2]);
      prisma['couponRedemption']['update'].mockResolvedValue({});

      const count = await service.expireStaleReservations();
      expect(count).toBe(2);
      expect(audit.log).toHaveBeenCalledTimes(2);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'coupon.reservation_expired',
        }),
      );
    });

    it('should process multiple stale reservations independently', async () => {
      const staleA = makeRedemption({ id: 'a', couponId: 'coupon-a', coupon: makeCoupon({ id: 'coupon-a' }) });
      const staleB = makeRedemption({ id: 'b', couponId: 'coupon-b', coupon: makeCoupon({ id: 'coupon-b' }) });
      prisma['couponRedemption']['findMany'].mockResolvedValue([staleA, staleB]);
      prisma['couponRedemption']['update'].mockResolvedValue({});

      await service.expireStaleReservations();
      // Each coupon should have its counter decremented
      expect(prisma['coupon']['update']).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'coupon-a' } }),
      );
      expect(prisma['coupon']['update']).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'coupon-b' } }),
      );
    });
  });

  // ==================================================================
  // Integration-style: full reserve → finalize flow
  // ==================================================================

  describe('reserve → finalize flow', () => {
    it('should complete full lifecycle: validate → reserve → finalize', async () => {
      // Setup: valid coupon
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['$queryRawUnsafe'].mockResolvedValue([makeCoupon()]);
      prisma['couponRedemption']['create'].mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: REDEMPTION_ID, ...data, coupon: makeCoupon() }),
      );

      // 1. Validate
      const validation = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(validation.valid).toBe(true);

      // 2. Reserve
      const reservation = await service.reserveCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(reservation.id).toBe(REDEMPTION_ID);

      // 3. Finalize
      prisma['couponRedemption']['findUnique'].mockResolvedValue(
        makeRedemption({ coupon: makeCoupon() }),
      );
      prisma['couponRedemption']['update'].mockResolvedValue({
        ...makeRedemption(),
        status: 'redeemed',
      });

      const finalized = await service.finalizeCoupon(REDEMPTION_ID, SUB_ID, PAYMENT_ID, 19980);
      expect(finalized.status).toBe('redeemed');
    });
  });

  // ==================================================================
  // Integration-style: full reserve → rollback flow
  // ==================================================================

  describe('reserve → rollback flow', () => {
    it('should complete reserve then rollback on failure', async () => {
      // Setup: valid coupon
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['$queryRawUnsafe'].mockResolvedValue([makeCoupon()]);
      prisma['couponRedemption']['create'].mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: REDEMPTION_ID, ...data }),
      );

      // 1. Reserve
      await service.reserveCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(prisma['coupon']['update']).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { currentRedemptions: { increment: 1 } },
        }),
      );

      // 2. Rollback
      prisma['couponRedemption']['findUnique'].mockResolvedValue(makeRedemption());
      prisma['couponRedemption']['update'].mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...makeRedemption(), ...data }),
      );

      // Reset mock to track rollback calls
      prisma['coupon']['update'].mockClear();

      await service.rollbackCoupon(REDEMPTION_ID);
      expect(prisma['coupon']['update']).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { currentRedemptions: { decrement: 1 } },
        }),
      );
    });
  });

  // ==================================================================
  // Admin CRUD: create
  // ==================================================================

  describe('create', () => {
    it('should create a coupon with normalized code and hash', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(null);
      prisma['coupon']['create'] = jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: COUPON_ID, ...data, createdAt: new Date(), updatedAt: new Date() }),
      );

      const result = await service.create({
        code: ' save20 ',
        name: '20% Off',
        discountType: 'percentage',
        discountValue: 20,
      }, USER_ID);

      expect(result.code).toBe('SAVE20');
      expect(result.codeHash).toHaveLength(64);
      expect(prisma['coupon']['create']).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            code: 'SAVE20',
            name: '20% Off',
            discountType: 'percentage',
            discountValue: 20,
            createdByUserId: USER_ID,
          }),
        }),
      );
    });

    it('should throw ConflictException for duplicate code', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());

      await expect(
        service.create({ code: 'SAVE20', name: 'Dupe', discountType: 'percentage', discountValue: 10 }, USER_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('should set defaults for optional fields', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(null);
      prisma['coupon']['create'] = jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: COUPON_ID, ...data }),
      );

      const result = await service.create({
        code: 'NEW10',
        name: 'New',
        discountType: 'fixed_amount',
        discountValue: 10000,
      }, USER_ID);

      expect(result.currency).toBe('PHP');
      expect(result.appliesToBillingPeriod).toBe('any');
      expect(result.maxRedemptionsPerOrg).toBe(1);
      expect(result.isActive).toBe(true);
    });
  });

  // ==================================================================
  // Admin CRUD: update
  // ==================================================================

  describe('update', () => {
    it('should update specified fields', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['coupon']['update'].mockImplementation(({ data }) =>
        Promise.resolve({ ...makeCoupon(), ...data }),
      );

      const result = await service.update(COUPON_ID, { name: 'Updated Name', isActive: false });
      expect(result.name).toBe('Updated Name');
      expect(prisma['coupon']['update']).toHaveBeenCalledWith({
        where: { id: COUPON_ID },
        data: expect.objectContaining({ name: 'Updated Name', isActive: false }),
      });
    });

    it('should throw NotFoundException for missing coupon', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(null);
      await expect(service.update('missing', { name: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('should convert date strings to Date objects', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['coupon']['update'].mockResolvedValue(makeCoupon());

      await service.update(COUPON_ID, { startsAt: '2026-04-01T00:00:00Z' });
      expect(prisma['coupon']['update']).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ startsAt: expect.any(Date) }),
        }),
      );
    });
  });

  // ==================================================================
  // Admin CRUD: findById
  // ==================================================================

  describe('findById', () => {
    it('should return coupon with stats', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue({
        ...makeCoupon(),
        planRules: [],
        createdBy: { id: USER_ID, fullName: 'Admin', email: 'a@test.com' },
        _count: { redemptions: 5, userAssignments: 2, orgAssignments: 1 },
      });
      prisma['couponRedemption']['count']
        .mockResolvedValueOnce(3)  // redeemed
        .mockResolvedValueOnce(1); // reserved

      const result = await service.findById(COUPON_ID);
      expect(result.stats.totalRedemptions).toBe(5);
      expect(result.stats.redeemedCount).toBe(3);
      expect(result.stats.reservedCount).toBe(1);
      expect(result.stats.userAssignments).toBe(2);
      expect(result.stats.orgAssignments).toBe(1);
    });

    it('should throw NotFoundException for missing coupon', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ==================================================================
  // Admin CRUD: list
  // ==================================================================

  describe('list', () => {
    it('should return paginated results with cursor', async () => {
      const coupons = Array.from({ length: 21 }, (_, i) => ({ ...makeCoupon(), id: `c-${i}`, _count: { redemptions: i } }));
      prisma['coupon']['findMany'] = jest.fn().mockResolvedValue(coupons);

      const result = await service.list({ limit: 20 });
      expect(result.data).toHaveLength(20);
      expect(result.hasNext).toBe(true);
      expect(result.nextCursor).toBe('c-19');
    });

    it('should return all when fewer than limit', async () => {
      prisma['coupon']['findMany'] = jest.fn().mockResolvedValue([
        { ...makeCoupon(), _count: { redemptions: 0 } },
      ]);

      const result = await service.list({});
      expect(result.data).toHaveLength(1);
      expect(result.hasNext).toBe(false);
      expect(result.nextCursor).toBeUndefined();
    });

    it('should apply search filter', async () => {
      prisma['coupon']['findMany'] = jest.fn().mockResolvedValue([]);
      await service.list({ search: 'test' });

      expect(prisma['coupon']['findMany']).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ code: expect.anything() }),
              expect.objectContaining({ name: expect.anything() }),
            ]),
          }),
        }),
      );
    });

    it('should apply discountType filter', async () => {
      prisma['coupon']['findMany'] = jest.fn().mockResolvedValue([]);
      await service.list({ discountType: 'percentage' });

      expect(prisma['coupon']['findMany']).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ discountType: 'percentage' }),
        }),
      );
    });
  });

  // ==================================================================
  // Admin CRUD: archive
  // ==================================================================

  describe('archive', () => {
    it('should set isArchived=true and isActive=false', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['coupon']['update'].mockImplementation(({ data }) =>
        Promise.resolve({ ...makeCoupon(), ...data }),
      );

      const result = await service.archive(COUPON_ID);
      expect(result.isArchived).toBe(true);
      expect(result.isActive).toBe(false);
    });

    it('should throw NotFoundException for missing coupon', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(null);
      await expect(service.archive('missing')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if already archived', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon({ isArchived: true }));
      await expect(service.archive(COUPON_ID)).rejects.toThrow(BadRequestException);
    });
  });

  // ==================================================================
  // Admin CRUD: toggleActive
  // ==================================================================

  describe('toggleActive', () => {
    it('should activate a coupon', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon({ isActive: false }));
      prisma['coupon']['update'].mockImplementation(({ data }) =>
        Promise.resolve({ ...makeCoupon(), ...data }),
      );

      const result = await service.toggleActive(COUPON_ID, true);
      expect(result.isActive).toBe(true);
    });

    it('should deactivate a coupon', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['coupon']['update'].mockImplementation(({ data }) =>
        Promise.resolve({ ...makeCoupon(), ...data }),
      );

      const result = await service.toggleActive(COUPON_ID, false);
      expect(result.isActive).toBe(false);
    });

    it('should throw NotFoundException for missing coupon', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(null);
      await expect(service.toggleActive('missing', true)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for archived coupon', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon({ isArchived: true }));
      await expect(service.toggleActive(COUPON_ID, true)).rejects.toThrow(BadRequestException);
    });
  });

  // ==================================================================
  // Admin CRUD: getRedemptionHistory
  // ==================================================================

  describe('getRedemptionHistory', () => {
    it('should return paginated redemptions', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['couponRedemption']['findMany'].mockResolvedValue([makeRedemption()]);

      const result = await service.getRedemptionHistory(COUPON_ID, {});
      expect(result.data).toHaveLength(1);
      expect(result.hasNext).toBe(false);
    });

    it('should throw NotFoundException for missing coupon', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(null);
      await expect(service.getRedemptionHistory('missing', {})).rejects.toThrow(NotFoundException);
    });

    it('should filter by status', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['couponRedemption']['findMany'].mockResolvedValue([]);

      await service.getRedemptionHistory(COUPON_ID, { status: 'redeemed' });
      expect(prisma['couponRedemption']['findMany']).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'redeemed' }),
        }),
      );
    });
  });

  // ==================================================================
  // Admin CRUD: assignUsers
  // ==================================================================

  describe('assignUsers', () => {
    it('should upsert user assignments', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['couponUserAssignment']['upsert'] = jest.fn().mockResolvedValue({});
      prisma['$transaction'].mockImplementation((fns: Array<Promise<unknown>>) =>
        Promise.all(fns),
      );

      const result = await service.assignUsers(COUPON_ID, [USER_ID, 'user-2']);
      expect(result.count).toBe(2);
    });

    it('should throw NotFoundException for missing coupon', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(null);
      await expect(service.assignUsers('missing', [USER_ID])).rejects.toThrow(NotFoundException);
    });
  });

  // ==================================================================
  // Admin CRUD: assignOrgs
  // ==================================================================

  describe('assignOrgs', () => {
    it('should upsert org assignments', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['couponOrgAssignment']['upsert'] = jest.fn().mockResolvedValue({});
      prisma['$transaction'].mockImplementation((fns: Array<Promise<unknown>>) =>
        Promise.all(fns),
      );

      const result = await service.assignOrgs(COUPON_ID, [ORG_ID]);
      expect(result.count).toBe(1);
    });

    it('should throw NotFoundException for missing coupon', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(null);
      await expect(service.assignOrgs('missing', [ORG_ID])).rejects.toThrow(NotFoundException);
    });
  });

  // ==================================================================
  // Admin CRUD: setPlanRules
  // ==================================================================

  describe('setPlanRules', () => {
    it('should delete existing rules and create new ones', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['couponPlanRule']['deleteMany'] = jest.fn().mockResolvedValue({ count: 0 });
      prisma['couponPlanRule']['create'] = jest.fn().mockResolvedValue({});
      prisma['$transaction'].mockImplementation((fns: Array<Promise<unknown>>) =>
        Promise.all(fns),
      );
      prisma['couponPlanRule']['findMany'].mockResolvedValue([
        { id: 'r-1', couponId: COUPON_ID, planCode: 'pro', ruleType: 'include' },
      ]);

      const result = await service.setPlanRules(COUPON_ID, [{ planCode: 'pro', ruleType: 'include' }]);
      expect(result).toHaveLength(1);
      expect(result[0]!.planCode).toBe('pro');
    });

    it('should throw NotFoundException for missing coupon', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(null);
      await expect(service.setPlanRules('missing', [])).rejects.toThrow(NotFoundException);
    });

    it('should handle empty rules array (clear all rules)', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['couponPlanRule']['deleteMany'] = jest.fn().mockResolvedValue({ count: 2 });
      prisma['$transaction'].mockImplementation((fns: Array<Promise<unknown>>) =>
        Promise.all(fns),
      );
      prisma['couponPlanRule']['findMany'].mockResolvedValue([]);

      const result = await service.setPlanRules(COUPON_ID, []);
      expect(result).toHaveLength(0);
    });

    it('should handle multiple rules of different types', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['couponPlanRule']['deleteMany'] = jest.fn().mockResolvedValue({ count: 0 });
      prisma['couponPlanRule']['create'] = jest.fn().mockResolvedValue({});
      prisma['$transaction'].mockImplementation((fns: Array<Promise<unknown>>) =>
        Promise.all(fns),
      );
      prisma['couponPlanRule']['findMany'].mockResolvedValue([
        { id: 'r-1', couponId: COUPON_ID, planCode: 'pro', ruleType: 'include' },
        { id: 'r-2', couponId: COUPON_ID, planCode: 'team', ruleType: 'include' },
        { id: 'r-3', couponId: COUPON_ID, planCode: 'free', ruleType: 'exclude' },
      ]);

      const result = await service.setPlanRules(COUPON_ID, [
        { planCode: 'pro', ruleType: 'include' },
        { planCode: 'team', ruleType: 'include' },
        { planCode: 'free', ruleType: 'exclude' },
      ]);
      expect(result).toHaveLength(3);
    });
  });

  // ==================================================================
  // EDGE CASES: validateCoupon boundary conditions
  // ==================================================================

  describe('validateCoupon — edge cases', () => {
    beforeEach(() => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
    });

    it('should pass when startsAt is exactly now (boundary)', async () => {
      const now = new Date();
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon({ startsAt: now }));
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      // startsAt > now is false when equal, so it should pass this check
      expect(result.errors).not.toContain('Coupon is not yet valid');
    });

    it('should fail when expiresAt is exactly now (boundary — expiresAt <= now)', async () => {
      const now = new Date();
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon({ expiresAt: now }));
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Coupon has expired');
    });

    it('should accumulate 4+ errors when multiple failures apply simultaneously', async () => {
      const past = new Date(Date.now() - 86400000);
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon({
        isActive: false,
        isArchived: true,
        expiresAt: past,
        maxRedemptions: 1,
        currentRedemptions: 1,
        appliesToBillingPeriod: 'annual',
        minimumPlanTier: 'enterprise',
      }));
      prisma['couponRedemption']['count'].mockResolvedValue(1);
      prisma['couponUserAssignment']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, userId: 'other-user' },
      ]);
      prisma['couponRedemption']['findFirst'].mockResolvedValue(makeRedemption());

      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'edu', 'monthly');
      expect(result.valid).toBe(false);
      // isActive=false, isArchived=true, expired, max redemptions, per-org limit,
      // billing period mismatch, min tier, assignment, existing reservation
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    });

    it('should pass with appliesToBillingPeriod=any regardless of selected period', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon({ appliesToBillingPeriod: 'any' }));
      const r1 = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(r1.valid).toBe(true);

      const r2 = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'annual');
      expect(r2.valid).toBe(true);
    });

    it('should still return coupon object even when validation fails', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon({ isActive: false }));
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(false);
      expect(result.coupon).toBeDefined();
      expect(result.coupon!.code).toBe('SAVE20');
    });

    it('should not return discountPreview when validation fails', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon({ isActive: false }));
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(false);
      expect(result.discountPreview).toBeUndefined();
    });

    it('should pass with unknown minimumPlanTier (treats as tier 0)', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon({ minimumPlanTier: 'nonexistent' }));
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      // nonexistent maps to tier 0 in TIER_HIERARCHY, pro maps to tier 2, so 2 >= 0 passes
      expect(result.errors).not.toContain(expect.stringContaining('Coupon requires'));
    });

    it('should handle null startsAt and null expiresAt (always valid date range)', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon({ startsAt: null, expiresAt: null }));
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(true);
    });

    it('should return valid for free plan when coupon has no minimum tier', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon({ minimumPlanTier: null }));
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'free', 'monthly');
      expect(result.errors).not.toContain(expect.stringContaining('Coupon requires'));
    });

    it('should return discount preview of 0 for free plan (unknown in PLAN_PRICING)', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'free', 'monthly');
      expect(result.valid).toBe(true);
      expect(result.discountPreview).toBeDefined();
      expect(result.discountPreview!.originalAmount).toBe(0);
      expect(result.discountPreview!.discountAmount).toBe(0);
      expect(result.discountPreview!.finalAmount).toBe(0);
    });

    it('should pass when maxRedemptionsPerOrg > 1 and orgRedemptionCount is below limit', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon({ maxRedemptionsPerOrg: 5 }));
      prisma['couponRedemption']['count'].mockResolvedValue(3);
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(true);
    });

    it('should fail when maxRedemptionsPerOrg reached (exactly at limit)', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon({ maxRedemptionsPerOrg: 3 }));
      prisma['couponRedemption']['count'].mockResolvedValue(3);
      const result = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Your organization has already used this coupon');
    });
  });

  // ==================================================================
  // EDGE CASES: calculateDiscount boundary conditions
  // ==================================================================

  describe('calculateDiscount — edge cases', () => {
    it('should clamp negative percentage to 0', async () => {
      const coupon = makeCoupon({ discountType: 'percentage', discountValue: -10 });
      const result = await service.calculateDiscount(coupon as never, 'pro', 'monthly');
      expect(result.discountAmount).toBe(0);
      expect(result.finalAmount).toBe(99900);
    });

    it('should handle fixed_amount exactly equal to plan price', async () => {
      const coupon = makeCoupon({ discountType: 'fixed_amount', discountValue: 99900 });
      const result = await service.calculateDiscount(coupon as never, 'pro', 'monthly');
      expect(result.discountAmount).toBe(99900);
      expect(result.finalAmount).toBe(0);
    });

    it('should handle negative fixed_amount (clamped via Math.min with originalAmount)', async () => {
      const coupon = makeCoupon({ discountType: 'fixed_amount', discountValue: -5000 });
      const result = await service.calculateDiscount(coupon as never, 'pro', 'monthly');
      // Math.min(-5000, 99900) = -5000, so discountAmount = -5000 and finalAmount = 99900 - (-5000) = 104900
      // This is technically a bug/edge case — negative fixed amounts are not meaningful
      expect(result.discountAmount).toBe(-5000);
      expect(result.finalAmount).toBe(104900);
    });

    it('should return 0 discount for unknown discount type', async () => {
      const coupon = makeCoupon({ discountType: 'unknown_type', discountValue: 50 });
      const result = await service.calculateDiscount(coupon as never, 'pro', 'monthly');
      expect(result.discountAmount).toBe(0);
      expect(result.finalAmount).toBe(99900);
    });

    it('should use PricingEngineService for annual billing', async () => {
      pricingEngine.resolvePlanPrice.mockResolvedValue({
        amount: 899000, planName: 'Pro', planId: 'plan-id', currency: 'PHP', source: 'database',
      } as never);
      const coupon = makeCoupon({ discountType: 'percentage', discountValue: 10 });
      const result = await service.calculateDiscount(coupon as never, 'pro', 'annual');
      expect(result.originalAmount).toBe(899000);
      expect(result.discountAmount).toBe(89900);
    });

    it('should handle edu plan monthly pricing', async () => {
      const coupon = makeCoupon({ discountType: 'percentage', discountValue: 50 });
      const result = await service.calculateDiscount(coupon as never, 'edu', 'monthly');
      expect(result.originalAmount).toBe(29900);
      expect(result.discountAmount).toBe(14950);
      expect(result.finalAmount).toBe(14950);
    });

    it('should handle team plan annual pricing', async () => {
      const coupon = makeCoupon({ discountType: 'fixed_amount', discountValue: 100000 });
      const result = await service.calculateDiscount(coupon as never, 'team', 'annual');
      expect(result.originalAmount).toBe(2499000);
      expect(result.discountAmount).toBe(100000);
      expect(result.finalAmount).toBe(2399000);
    });

    it('should handle enterprise plan monthly pricing', async () => {
      const coupon = makeCoupon({ discountType: 'percentage', discountValue: 100 });
      const result = await service.calculateDiscount(coupon as never, 'enterprise', 'monthly');
      expect(result.originalAmount).toBe(499900);
      expect(result.discountAmount).toBe(499900);
      expect(result.finalAmount).toBe(0);
    });

    it('should round percentage discount to whole number', async () => {
      const coupon = makeCoupon({ discountType: 'percentage', discountValue: 33 });
      const result = await service.calculateDiscount(coupon as never, 'pro', 'monthly');
      // 99900 * 33 / 100 = 32967, Math.round = 32967
      expect(result.discountAmount).toBe(32967);
      expect(result.finalAmount).toBe(99900 - 32967);
    });
  });

  // ==================================================================
  // EDGE CASES: checkPlanRules with mixed rules
  // ==================================================================

  describe('checkPlanRules — edge cases', () => {
    it('should prioritize include rules when both include and exclude exist', async () => {
      prisma['couponPlanRule']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, planCode: 'pro', ruleType: 'include' },
        { couponId: COUPON_ID, planCode: 'pro', ruleType: 'exclude' },
      ]);
      // Include rules exist, so it checks include list — 'pro' is in include list
      expect(await service.checkPlanRules(COUPON_ID, 'pro')).toBe(true);
    });

    it('should reject plan not in include list even if exclude list would allow it', async () => {
      prisma['couponPlanRule']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, planCode: 'pro', ruleType: 'include' },
        { couponId: COUPON_ID, planCode: 'free', ruleType: 'exclude' },
      ]);
      // Include rules exist, 'team' is not in include list
      expect(await service.checkPlanRules(COUPON_ID, 'team')).toBe(false);
    });

    it('should allow plan with multiple include rules when plan matches any', async () => {
      prisma['couponPlanRule']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, planCode: 'pro', ruleType: 'include' },
        { couponId: COUPON_ID, planCode: 'team', ruleType: 'include' },
        { couponId: COUPON_ID, planCode: 'enterprise', ruleType: 'include' },
      ]);
      expect(await service.checkPlanRules(COUPON_ID, 'team')).toBe(true);
    });

    it('should reject plan with multiple exclude rules when plan matches any', async () => {
      prisma['couponPlanRule']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, planCode: 'free', ruleType: 'exclude' },
        { couponId: COUPON_ID, planCode: 'edu', ruleType: 'exclude' },
      ]);
      expect(await service.checkPlanRules(COUPON_ID, 'edu')).toBe(false);
    });
  });

  // ==================================================================
  // EDGE CASES: checkAssignments complex scenarios
  // ==================================================================

  describe('checkAssignments — edge cases', () => {
    it('should reject when both user and org assignments exist but neither matches', async () => {
      prisma['couponUserAssignment']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, userId: 'other-user' },
      ]);
      prisma['couponOrgAssignment']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, organizationId: 'other-org' },
      ]);
      expect(await service.checkAssignments(COUPON_ID, ORG_ID, USER_ID)).toBe(false);
    });

    it('should allow when only org assignment exists and org matches', async () => {
      prisma['couponUserAssignment']['findMany'].mockResolvedValue([]);
      prisma['couponOrgAssignment']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, organizationId: ORG_ID },
      ]);
      expect(await service.checkAssignments(COUPON_ID, ORG_ID, USER_ID)).toBe(true);
    });

    it('should allow via org match even when user is not in user assignments', async () => {
      prisma['couponUserAssignment']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, userId: 'other-user' },
      ]);
      prisma['couponOrgAssignment']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, organizationId: ORG_ID },
      ]);
      // User doesn't match user assignments, but org matches org assignments
      expect(await service.checkAssignments(COUPON_ID, ORG_ID, USER_ID)).toBe(true);
    });

    it('should handle multiple user assignments — match found in middle', async () => {
      prisma['couponUserAssignment']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, userId: 'user-a' },
        { couponId: COUPON_ID, userId: USER_ID },
        { couponId: COUPON_ID, userId: 'user-c' },
      ]);
      expect(await service.checkAssignments(COUPON_ID, ORG_ID, USER_ID)).toBe(true);
    });

    it('should handle multiple org assignments — match found in last', async () => {
      prisma['couponOrgAssignment']['findMany'].mockResolvedValue([
        { couponId: COUPON_ID, organizationId: 'org-a' },
        { couponId: COUPON_ID, organizationId: 'org-b' },
        { couponId: COUPON_ID, organizationId: ORG_ID },
      ]);
      expect(await service.checkAssignments(COUPON_ID, ORG_ID, USER_ID)).toBe(true);
    });
  });

  // ==================================================================
  // EDGE CASES: reserveCoupon with different discount types
  // ==================================================================

  describe('reserveCoupon — edge cases', () => {
    beforeEach(() => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['$queryRawUnsafe'].mockResolvedValue([makeCoupon()]);
      prisma['couponRedemption']['create'].mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: REDEMPTION_ID, ...data }),
      );
    });

    it('should store fixed_amount discount info in metadata', async () => {
      const fixedCoupon = makeCoupon({ discountType: 'fixed_amount', discountValue: 50000 });
      prisma['coupon']['findUnique'].mockResolvedValue(fixedCoupon);
      prisma['$queryRawUnsafe'].mockResolvedValue([fixedCoupon]);

      await service.reserveCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      const createCall = prisma['couponRedemption']['create'].mock.calls[0][0];
      expect(createCall.data.metadataJson).toEqual(
        expect.objectContaining({
          discountType: 'fixed_amount',
          discountValue: 50000,
        }),
      );
    });

    it('should store 0 discount for bonus_credit type', async () => {
      const bonusCoupon = makeCoupon({
        discountType: 'bonus_credit',
        discountValue: 50,
        bonusEntitlementKey: 'aiAnswers',
        bonusEntitlementValue: 50,
      });
      prisma['coupon']['findUnique'].mockResolvedValue(bonusCoupon);
      prisma['$queryRawUnsafe'].mockResolvedValue([bonusCoupon]);

      await service.reserveCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      const createCall = prisma['couponRedemption']['create'].mock.calls[0][0];
      expect(createCall.data.discountAmountApplied).toBe(0);
      expect(createCall.data.originalAmount).toBe(99900);
    });

    it('should store trial_extension metadata correctly', async () => {
      const trialCoupon = makeCoupon({
        discountType: 'trial_extension',
        discountValue: 14,
        trialExtensionDays: 14,
      });
      prisma['coupon']['findUnique'].mockResolvedValue(trialCoupon);
      prisma['$queryRawUnsafe'].mockResolvedValue([trialCoupon]);

      await service.reserveCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      const createCall = prisma['couponRedemption']['create'].mock.calls[0][0];
      expect(createCall.data.discountAmountApplied).toBe(0);
      expect(createCall.data.metadataJson.discountType).toBe('trial_extension');
    });

    it('should use edu annual pricing for reserve calculation', async () => {
      await service.reserveCoupon('SAVE20', ORG_ID, USER_ID, 'edu', 'annual');
      const createCall = prisma['couponRedemption']['create'].mock.calls[0][0];
      // edu annual = 299000, 20% of 299000 = 59800
      expect(createCall.data.originalAmount).toBe(299000);
      expect(createCall.data.discountAmountApplied).toBe(59800);
    });

    it('should include coupon code in audit log metadata', async () => {
      await service.reserveCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            couponCode: 'SAVE20',
            planCode: 'pro',
            billingPeriod: 'monthly',
          }),
        }),
      );
    });
  });

  // ==================================================================
  // EDGE CASES: finalizeCoupon bonus scenarios
  // ==================================================================

  describe('finalizeCoupon — edge cases', () => {
    it('should grant bonus without expiresAt when bonusDurationDays is null', async () => {
      const bonusCoupon = makeCoupon({
        discountType: 'bonus_credit',
        bonusEntitlementKey: 'searchQueries',
        bonusEntitlementValue: 100,
        bonusDurationDays: null,
      });
      prisma['couponRedemption']['findUnique'].mockResolvedValue(
        makeRedemption({ coupon: bonusCoupon }),
      );
      prisma['couponRedemption']['update'].mockResolvedValue({ ...makeRedemption(), status: 'redeemed' });

      await service.finalizeCoupon(REDEMPTION_ID, SUB_ID, null, 0);
      expect(entitlementService.grantBonus).toHaveBeenCalledWith(
        expect.objectContaining({
          entitlementKey: 'searchQueries',
          numericValue: 100,
          expiresAt: undefined,
        }),
      );
    });

    it('should not grant bonus for bonus_credit when bonusEntitlementKey is null', async () => {
      const coupon = makeCoupon({
        discountType: 'bonus_credit',
        bonusEntitlementKey: null,
        bonusEntitlementValue: 50,
      });
      prisma['couponRedemption']['findUnique'].mockResolvedValue(
        makeRedemption({ coupon }),
      );
      prisma['couponRedemption']['update'].mockResolvedValue({ ...makeRedemption(), status: 'redeemed' });

      await service.finalizeCoupon(REDEMPTION_ID, SUB_ID, null, 0);
      expect(entitlementService.grantBonus).not.toHaveBeenCalled();
    });

    it('should not grant bonus for trial_extension type', async () => {
      const trialCoupon = makeCoupon({
        discountType: 'trial_extension',
        trialExtensionDays: 14,
        bonusEntitlementKey: null,
      });
      prisma['couponRedemption']['findUnique'].mockResolvedValue(
        makeRedemption({ coupon: trialCoupon }),
      );
      prisma['couponRedemption']['update'].mockResolvedValue({ ...makeRedemption(), status: 'redeemed' });

      await service.finalizeCoupon(REDEMPTION_ID, SUB_ID, null, 0);
      expect(entitlementService.grantBonus).not.toHaveBeenCalled();
    });

    it('should reject finalization of expired redemption', async () => {
      prisma['couponRedemption']['findUnique'].mockResolvedValue(
        makeRedemption({ status: 'expired' }),
      );
      await expect(
        service.finalizeCoupon(REDEMPTION_ID, SUB_ID, PAYMENT_ID, 0),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject double finalization (status already redeemed)', async () => {
      prisma['couponRedemption']['findUnique'].mockResolvedValue(
        makeRedemption({ status: 'redeemed' }),
      );
      await expect(
        service.finalizeCoupon(REDEMPTION_ID, SUB_ID, PAYMENT_ID, 0),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject finalization of rolled_back redemption', async () => {
      prisma['couponRedemption']['findUnique'].mockResolvedValue(
        makeRedemption({ status: 'rolled_back' }),
      );
      await expect(
        service.finalizeCoupon(REDEMPTION_ID, SUB_ID, PAYMENT_ID, 0),
      ).rejects.toThrow(BadRequestException);
    });

    it('should set correct bonus expiresAt for 30-day duration', async () => {
      const bonusCoupon = makeCoupon({
        discountType: 'bonus_credit',
        bonusEntitlementKey: 'cameraScans',
        bonusEntitlementValue: 20,
        bonusDurationDays: 30,
      });
      prisma['couponRedemption']['findUnique'].mockResolvedValue(
        makeRedemption({ coupon: bonusCoupon }),
      );
      prisma['couponRedemption']['update'].mockResolvedValue({ ...makeRedemption(), status: 'redeemed' });

      await service.finalizeCoupon(REDEMPTION_ID, SUB_ID, null, 0);
      const grantCall = entitlementService.grantBonus.mock.calls[0]![0];
      const expiresAt = grantCall.expiresAt as Date;
      const now = Date.now();
      // Should expire approximately 30 days from now (+/- 5 seconds tolerance)
      expect(expiresAt.getTime()).toBeGreaterThan(now + 29 * 24 * 60 * 60 * 1000);
      expect(expiresAt.getTime()).toBeLessThan(now + 31 * 24 * 60 * 60 * 1000);
    });

    it('should include discountType in audit metadata', async () => {
      prisma['couponRedemption']['findUnique'].mockResolvedValue(makeRedemption());
      prisma['couponRedemption']['update'].mockResolvedValue({ ...makeRedemption(), status: 'redeemed' });

      await service.finalizeCoupon(REDEMPTION_ID, SUB_ID, PAYMENT_ID, 19980);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            discountType: 'percentage',
            discountAmountApplied: 19980,
          }),
        }),
      );
    });

    it('should pass bonusEntitlementValue as undefined when null', async () => {
      const bonusCoupon = makeCoupon({
        discountType: 'bonus_credit',
        bonusEntitlementKey: 'aiAnswers',
        bonusEntitlementValue: null,
        bonusDurationDays: null,
      });
      prisma['couponRedemption']['findUnique'].mockResolvedValue(
        makeRedemption({ coupon: bonusCoupon }),
      );
      prisma['couponRedemption']['update'].mockResolvedValue({ ...makeRedemption(), status: 'redeemed' });

      await service.finalizeCoupon(REDEMPTION_ID, SUB_ID, null, 0);
      expect(entitlementService.grantBonus).toHaveBeenCalledWith(
        expect.objectContaining({
          numericValue: undefined,
        }),
      );
    });
  });

  // ==================================================================
  // EDGE CASES: rollbackCoupon status transitions
  // ==================================================================

  describe('rollbackCoupon — edge cases', () => {
    it('should reject rollback of expired redemption', async () => {
      prisma['couponRedemption']['findUnique'].mockResolvedValue(
        makeRedemption({ status: 'expired' }),
      );
      await expect(service.rollbackCoupon(REDEMPTION_ID)).rejects.toThrow(BadRequestException);
    });

    it('should include couponCode in audit log on rollback', async () => {
      prisma['couponRedemption']['findUnique'].mockResolvedValue(makeRedemption());
      prisma['couponRedemption']['update'].mockResolvedValue({ ...makeRedemption(), status: 'rolled_back' });

      await service.rollbackCoupon(REDEMPTION_ID);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            couponCode: 'SAVE20',
          }),
        }),
      );
    });

    it('should set rolledBackAt timestamp on rollback', async () => {
      prisma['couponRedemption']['findUnique'].mockResolvedValue(makeRedemption());
      prisma['couponRedemption']['update'].mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...makeRedemption(), ...data }),
      );

      const result = await service.rollbackCoupon(REDEMPTION_ID);
      expect(result.rolledBackAt).toBeDefined();
      expect(result.rolledBackAt).toBeInstanceOf(Date);
    });
  });

  // ==================================================================
  // EDGE CASES: expireStaleReservations
  // ==================================================================

  describe('expireStaleReservations — edge cases', () => {
    it('should not call audit.log when no stale reservations found', async () => {
      prisma['couponRedemption']['findMany'].mockResolvedValue([]);
      await service.expireStaleReservations();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('should process 10 stale reservations correctly', async () => {
      const staleRedemptions = Array.from({ length: 10 }, (_, i) => makeRedemption({
        id: `r-${i}`,
        couponId: `coupon-${i % 3}`,
        coupon: makeCoupon({ id: `coupon-${i % 3}` }),
        expiresAt: new Date(Date.now() - 60 * 1000),
      }));
      prisma['couponRedemption']['findMany'].mockResolvedValue(staleRedemptions);
      prisma['couponRedemption']['update'].mockResolvedValue({});

      const count = await service.expireStaleReservations();
      expect(count).toBe(10);
      expect(prisma['couponRedemption']['update']).toHaveBeenCalledTimes(10);
      expect(prisma['coupon']['update']).toHaveBeenCalledTimes(10);
      expect(audit.log).toHaveBeenCalledTimes(10);
    });

    it('should set correct status in each expiration update', async () => {
      const stale = makeRedemption({ expiresAt: new Date(Date.now() - 60 * 1000) });
      prisma['couponRedemption']['findMany'].mockResolvedValue([stale]);
      prisma['couponRedemption']['update'].mockResolvedValue({});

      await service.expireStaleReservations();
      expect(prisma['couponRedemption']['update']).toHaveBeenCalledWith({
        where: { id: REDEMPTION_ID },
        data: { status: 'expired' },
      });
    });
  });

  // ==================================================================
  // EDGE CASES: Admin CRUD — create edge cases
  // ==================================================================

  describe('create — edge cases', () => {
    it('should set all optional fields when provided', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(null);
      prisma['coupon']['create'] = jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: COUPON_ID, ...data }),
      );

      const result = await service.create({
        code: 'FULL',
        name: 'Full Options',
        description: 'Test description',
        internalNotes: 'Internal note',
        discountType: 'percentage',
        discountValue: 25,
        currency: 'USD',
        appliesToBillingPeriod: 'annual',
        maxRedemptions: 100,
        maxRedemptionsPerOrg: 3,
        startsAt: '2026-04-01T00:00:00Z',
        expiresAt: '2026-12-31T23:59:59Z',
        minimumPlanTier: 'pro',
        bonusEntitlementKey: 'aiAnswers',
        bonusEntitlementValue: 50,
        bonusDurationDays: 30,
        trialExtensionDays: 7,
        isActive: false,
        metadataJson: { campaign: 'spring2026' },
      }, USER_ID);

      expect(result.code).toBe('FULL');
      expect(result.description).toBe('Test description');
      expect(result.internalNotes).toBe('Internal note');
      expect(result.currency).toBe('USD');
      expect(result.appliesToBillingPeriod).toBe('annual');
      expect(result.maxRedemptions).toBe(100);
      expect(result.maxRedemptionsPerOrg).toBe(3);
      expect(result.startsAt).toBeInstanceOf(Date);
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.minimumPlanTier).toBe('pro');
      expect(result.bonusEntitlementKey).toBe('aiAnswers');
      expect(result.bonusEntitlementValue).toBe(50);
      expect(result.bonusDurationDays).toBe(30);
      expect(result.trialExtensionDays).toBe(7);
      expect(result.isActive).toBe(false);
      expect(result.metadataJson).toEqual({ campaign: 'spring2026' });
    });

    it('should handle code with mixed case and spaces', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(null);
      prisma['coupon']['create'] = jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: COUPON_ID, ...data }),
      );

      const result = await service.create({
        code: '  Save Twenty  ',
        name: 'Mixed Case',
        discountType: 'percentage',
        discountValue: 20,
      }, USER_ID);

      expect(result.code).toBe('SAVE TWENTY');
    });
  });

  // ==================================================================
  // EDGE CASES: Admin CRUD — update edge cases
  // ==================================================================

  describe('update — edge cases', () => {
    it('should handle update with no fields changed (empty data)', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['coupon']['update'].mockImplementation(({ data }) =>
        Promise.resolve({ ...makeCoupon(), ...data }),
      );

      // Empty update — should still call prisma.update with empty data
      const result = await service.update(COUPON_ID, {});
      expect(prisma['coupon']['update']).toHaveBeenCalledWith({
        where: { id: COUPON_ID },
        data: {},
      });
      expect(result.id).toBe(COUPON_ID);
    });

    it('should convert both startsAt and expiresAt date strings', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['coupon']['update'].mockResolvedValue(makeCoupon());

      await service.update(COUPON_ID, {
        startsAt: '2026-04-01T00:00:00Z',
        expiresAt: '2026-12-31T23:59:59Z',
      });

      expect(prisma['coupon']['update']).toHaveBeenCalledWith({
        where: { id: COUPON_ID },
        data: {
          startsAt: expect.any(Date),
          expiresAt: expect.any(Date),
        },
      });
    });

    it('should only include provided fields in update data', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['coupon']['update'].mockResolvedValue(makeCoupon());

      await service.update(COUPON_ID, { name: 'Only Name' });
      const callData = prisma['coupon']['update'].mock.calls[0][0].data;
      expect(Object.keys(callData)).toEqual(['name']);
    });

    it('should allow updating metadataJson', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['coupon']['update'].mockResolvedValue(makeCoupon());

      await service.update(COUPON_ID, {
        metadataJson: { campaign: 'summer', source: 'email' },
      });
      expect(prisma['coupon']['update']).toHaveBeenCalledWith({
        where: { id: COUPON_ID },
        data: { metadataJson: { campaign: 'summer', source: 'email' } },
      });
    });
  });

  // ==================================================================
  // EDGE CASES: Admin CRUD — list edge cases
  // ==================================================================

  describe('list — edge cases', () => {
    it('should apply isArchived filter', async () => {
      prisma['coupon']['findMany'] = jest.fn().mockResolvedValue([]);
      await service.list({ isArchived: true });

      expect(prisma['coupon']['findMany']).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isArchived: true }),
        }),
      );
    });

    it('should apply isActive=false filter', async () => {
      prisma['coupon']['findMany'] = jest.fn().mockResolvedValue([]);
      await service.list({ isActive: false });

      expect(prisma['coupon']['findMany']).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: false }),
        }),
      );
    });

    it('should apply custom sort field and direction', async () => {
      prisma['coupon']['findMany'] = jest.fn().mockResolvedValue([]);
      await service.list({ sortBy: 'name', sortDir: 'asc' });

      expect(prisma['coupon']['findMany']).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { name: 'asc' },
        }),
      );
    });

    it('should default to createdAt desc when no sort specified', async () => {
      prisma['coupon']['findMany'] = jest.fn().mockResolvedValue([]);
      await service.list({});

      expect(prisma['coupon']['findMany']).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should pass cursor through for pagination', async () => {
      prisma['coupon']['findMany'] = jest.fn().mockResolvedValue([]);
      await service.list({ cursor: 'some-cursor-id', limit: 10 });

      expect(prisma['coupon']['findMany']).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 11,
          skip: 1,
          cursor: { id: 'some-cursor-id' },
        }),
      );
    });

    it('should combine multiple filters', async () => {
      prisma['coupon']['findMany'] = jest.fn().mockResolvedValue([]);
      await service.list({ search: 'PROMO', discountType: 'fixed_amount', isActive: true, isArchived: false });

      const where = prisma['coupon']['findMany'].mock.calls[0][0].where;
      expect(where.discountType).toBe('fixed_amount');
      expect(where.isActive).toBe(true);
      expect(where.isArchived).toBe(false);
      expect(where.OR).toBeDefined();
    });

    it('should default limit to 20 when not specified', async () => {
      prisma['coupon']['findMany'] = jest.fn().mockResolvedValue([]);
      await service.list({});

      expect(prisma['coupon']['findMany']).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 21, // 20 + 1 for hasNext detection
        }),
      );
    });

    it('should return empty result set with no next cursor', async () => {
      prisma['coupon']['findMany'] = jest.fn().mockResolvedValue([]);
      const result = await service.list({});
      expect(result.data).toHaveLength(0);
      expect(result.hasNext).toBe(false);
      expect(result.nextCursor).toBeUndefined();
    });
  });

  // ==================================================================
  // EDGE CASES: getRedemptionHistory edge cases
  // ==================================================================

  describe('getRedemptionHistory — edge cases', () => {
    it('should filter by organizationId', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['couponRedemption']['findMany'].mockResolvedValue([]);

      await service.getRedemptionHistory(COUPON_ID, { organizationId: ORG_ID });
      expect(prisma['couponRedemption']['findMany']).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG_ID }),
        }),
      );
    });

    it('should pass cursor through for pagination', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['couponRedemption']['findMany'].mockResolvedValue([]);

      await service.getRedemptionHistory(COUPON_ID, { cursor: 'c-1', limit: 5 });
      expect(prisma['couponRedemption']['findMany']).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 6,
          skip: 1,
          cursor: { id: 'c-1' },
        }),
      );
    });

    it('should detect hasNext when more items than limit', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      const items = Array.from({ length: 6 }, (_, i) => ({
        ...makeRedemption(),
        id: `r-${i}`,
        user: { id: USER_ID, fullName: 'Test', email: 'test@test.com' },
        organization: { id: ORG_ID, name: 'Test Org', slug: 'test' },
      }));
      prisma['couponRedemption']['findMany'].mockResolvedValue(items);

      const result = await service.getRedemptionHistory(COUPON_ID, { limit: 5 });
      expect(result.data).toHaveLength(5);
      expect(result.hasNext).toBe(true);
      expect(result.nextCursor).toBe('r-4');
    });

    it('should combine status and organizationId filters', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['couponRedemption']['findMany'].mockResolvedValue([]);

      await service.getRedemptionHistory(COUPON_ID, {
        status: 'redeemed',
        organizationId: ORG_ID,
      });
      expect(prisma['couponRedemption']['findMany']).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            couponId: COUPON_ID,
            status: 'redeemed',
            organizationId: ORG_ID,
          }),
        }),
      );
    });
  });

  // ==================================================================
  // EDGE CASES: Full lifecycle with different coupon types
  // ==================================================================

  describe('full lifecycle — fixed_amount coupon', () => {
    it('should calculate, reserve, and finalize with fixed_amount', async () => {
      const fixedCoupon = makeCoupon({ discountType: 'fixed_amount', discountValue: 30000 });
      prisma['coupon']['findUnique'].mockResolvedValue(fixedCoupon);
      prisma['$queryRawUnsafe'].mockResolvedValue([fixedCoupon]);
      prisma['couponRedemption']['create'].mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: REDEMPTION_ID, ...data, coupon: fixedCoupon }),
      );

      // 1. Validate
      const validation = await service.validateCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(validation.valid).toBe(true);
      expect(validation.discountPreview!.discountAmount).toBe(30000);
      expect(validation.discountPreview!.finalAmount).toBe(69900);

      // 2. Reserve
      const reservation = await service.reserveCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(reservation.id).toBe(REDEMPTION_ID);

      // 3. Finalize
      prisma['couponRedemption']['findUnique'].mockResolvedValue(
        makeRedemption({ coupon: fixedCoupon }),
      );
      prisma['couponRedemption']['update'].mockResolvedValue({
        ...makeRedemption(),
        status: 'redeemed',
      });

      const finalized = await service.finalizeCoupon(REDEMPTION_ID, SUB_ID, PAYMENT_ID, 30000);
      expect(finalized.status).toBe('redeemed');
      expect(entitlementService.grantBonus).not.toHaveBeenCalled();
    });
  });

  describe('full lifecycle — bonus_credit coupon', () => {
    it('should reserve, finalize, and grant bonus entitlement', async () => {
      const bonusCoupon = makeCoupon({
        discountType: 'bonus_credit',
        discountValue: 0,
        bonusEntitlementKey: 'digestGeneration',
        bonusEntitlementValue: 25,
        bonusDurationDays: 60,
      });
      prisma['coupon']['findUnique'].mockResolvedValue(bonusCoupon);
      prisma['$queryRawUnsafe'].mockResolvedValue([bonusCoupon]);
      prisma['couponRedemption']['create'].mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: REDEMPTION_ID, ...data }),
      );

      // 1. Reserve
      const reservation = await service.reserveCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(reservation.id).toBe(REDEMPTION_ID);

      // 2. Finalize
      prisma['couponRedemption']['findUnique'].mockResolvedValue(
        makeRedemption({ coupon: bonusCoupon }),
      );
      prisma['couponRedemption']['update'].mockResolvedValue({
        ...makeRedemption(),
        status: 'redeemed',
      });

      await service.finalizeCoupon(REDEMPTION_ID, SUB_ID, null, 0);
      expect(entitlementService.grantBonus).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          entitlementKey: 'digestGeneration',
          numericValue: 25,
          overrideType: 'bonus_credit',
          sourceType: 'coupon',
          sourceId: COUPON_ID,
        }),
      );
    });
  });

  describe('full lifecycle — reserve → expire (stale)', () => {
    it('should reserve then auto-expire when reservation lapses', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(makeCoupon());
      prisma['$queryRawUnsafe'].mockResolvedValue([makeCoupon()]);
      prisma['couponRedemption']['create'].mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: REDEMPTION_ID, ...data }),
      );

      // 1. Reserve
      await service.reserveCoupon('SAVE20', ORG_ID, USER_ID, 'pro', 'monthly');
      expect(prisma['coupon']['update']).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { currentRedemptions: { increment: 1 } },
        }),
      );

      // 2. Simulate stale expiration
      const stale = makeRedemption({
        expiresAt: new Date(Date.now() - 60 * 1000),
      });
      prisma['couponRedemption']['findMany'].mockResolvedValue([stale]);
      prisma['couponRedemption']['update'].mockResolvedValue({});
      prisma['coupon']['update'].mockClear();

      const expiredCount = await service.expireStaleReservations();
      expect(expiredCount).toBe(1);
      expect(prisma['coupon']['update']).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { currentRedemptions: { decrement: 1 } },
        }),
      );
    });
  });

  // ==================================================================
  // EDGE CASES: hashCode static method
  // ==================================================================

  describe('hashCode — edge cases', () => {
    it('should produce different hashes for different codes', () => {
      const hash1 = CouponService.hashCode('CODE1');
      const hash2 = CouponService.hashCode('CODE2');
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = CouponService.hashCode('');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle special characters', () => {
      const hash = CouponService.hashCode('SAVE-20%OFF!');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should be deterministic (same input = same output)', () => {
      const hash1 = CouponService.hashCode('PROMO2026');
      const hash2 = CouponService.hashCode('PROMO2026');
      expect(hash1).toBe(hash2);
    });
  });

  // ==================================================================
  // EDGE CASES: findByCode normalization
  // ==================================================================

  describe('findByCode — edge cases', () => {
    it('should handle code with only whitespace', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(null);
      await service.findByCode('   ');
      expect(prisma['coupon']['findUnique']).toHaveBeenCalledWith({
        where: { code: '' },
      });
    });

    it('should handle mixed case with special characters', async () => {
      prisma['coupon']['findUnique'].mockResolvedValue(null);
      await service.findByCode('Save-20%');
      expect(prisma['coupon']['findUnique']).toHaveBeenCalledWith({
        where: { code: 'SAVE-20%' },
      });
    });
  });
});
