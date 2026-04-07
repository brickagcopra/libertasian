import { Test, TestingModule } from '@nestjs/testing';

import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportingService } from './reporting.service';

describe('ReportingService', () => {
  let service: ReportingService;
  let prisma: {
    payment: { aggregate: jest.Mock; groupBy: jest.Mock };
    subscription: { count: jest.Mock; groupBy: jest.Mock; aggregate: jest.Mock };
    checkoutPriceSnapshot: { aggregate: jest.Mock };
    trialRecord: { groupBy: jest.Mock; aggregate: jest.Mock };
    couponRedemption: { aggregate: jest.Mock };
    promotionRedemption: { aggregate: jest.Mock };
    organization: { count: jest.Mock; groupBy: jest.Mock };
    organizationMember: { count: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let redis: {
    get: jest.Mock;
    set: jest.Mock;
  };

  const defaultDto = { startDate: '2026-03-01', endDate: '2026-03-24' };
  const trendDto = { ...defaultDto, period: 'day' };
  const topDto = { ...defaultDto, limit: 5 };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportingService,
        {
          provide: PrismaService,
          useValue: {
            payment: {
              aggregate: jest.fn(),
              groupBy: jest.fn(),
            },
            subscription: {
              count: jest.fn(),
              groupBy: jest.fn(),
              aggregate: jest.fn(),
            },
            checkoutPriceSnapshot: {
              aggregate: jest.fn(),
            },
            trialRecord: {
              groupBy: jest.fn(),
              aggregate: jest.fn(),
            },
            couponRedemption: {
              aggregate: jest.fn(),
            },
            promotionRedemption: {
              aggregate: jest.fn(),
            },
            organization: {
              count: jest.fn(),
              groupBy: jest.fn(),
            },
            organizationMember: {
              count: jest.fn(),
            },
            $queryRaw: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<ReportingService>(ReportingService);
    prisma = module.get(PrismaService) as unknown as typeof prisma;
    redis = module.get(RedisService) as unknown as typeof redis;
  });

  // =====================================================================
  // Cache behavior
  // =====================================================================

  describe('caching', () => {
    it('should return cached data when available', async () => {
      const cached = {
        mrrCentavos: 100000,
        mrrPesos: 1000,
        arrCentavos: 1200000,
        arrPesos: 12000,
        arpuCentavos: 50000,
        arpuPesos: 500,
        netRevenueCentavos: 200000,
        netRevenuePesos: 2000,
        totalDiscountsCentavos: 5000,
        totalDiscountsPesos: 50,
        activeSubscriptions: 2,
      };
      (redis.get as jest.Mock).mockResolvedValueOnce(JSON.stringify(cached));

      const result = await service.getRevenueSummary(defaultDto);

      expect(result).toEqual(cached);
      expect(prisma.payment.aggregate).not.toHaveBeenCalled();
    });

    it('should store result in Redis cache on miss', async () => {
      (prisma.payment.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 0 }, _count: 0 });
      (prisma.subscription.count as jest.Mock).mockResolvedValue(0);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ mrr: BigInt(0) }]);
      (prisma.checkoutPriceSnapshot.aggregate as jest.Mock).mockResolvedValue({
        _sum: { totalDiscountAmount: 0 },
      });

      await service.getRevenueSummary(defaultDto);

      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining('cache:reporting:revenue-summary:'),
        expect.any(String),
        300,
      );
    });
  });

  // =====================================================================
  // Revenue
  // =====================================================================

  describe('getRevenueSummary', () => {
    it('should compute MRR, ARR, ARPU, net revenue correctly', async () => {
      (prisma.payment.aggregate as jest.Mock).mockResolvedValue({
        _sum: { amount: 500000 }, // 5000 pesos
        _count: 10,
      });
      (prisma.subscription.count as jest.Mock).mockResolvedValue(5);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ mrr: BigInt(200000) }]); // 2000 pesos
      (prisma.checkoutPriceSnapshot.aggregate as jest.Mock).mockResolvedValue({
        _sum: { totalDiscountAmount: 10000 }, // 100 pesos
      });

      const result = await service.getRevenueSummary(defaultDto);

      expect(result.mrrCentavos).toBe(200000);
      expect(result.mrrPesos).toBe(2000);
      expect(result.arrCentavos).toBe(2400000); // MRR * 12
      expect(result.arrPesos).toBe(24000);
      expect(result.arpuCentavos).toBe(40000); // 200000 / 5
      expect(result.arpuPesos).toBe(400);
      expect(result.netRevenueCentavos).toBe(500000);
      expect(result.netRevenuePesos).toBe(5000);
      expect(result.totalDiscountsCentavos).toBe(10000);
      expect(result.totalDiscountsPesos).toBe(100);
      expect(result.activeSubscriptions).toBe(5);
    });

    it('should handle zero active subscriptions (ARPU=0)', async () => {
      (prisma.payment.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 0 }, _count: 0 });
      (prisma.subscription.count as jest.Mock).mockResolvedValue(0);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ mrr: BigInt(0) }]);
      (prisma.checkoutPriceSnapshot.aggregate as jest.Mock).mockResolvedValue({
        _sum: { totalDiscountAmount: 0 },
      });

      const result = await service.getRevenueSummary(defaultDto);

      expect(result.arpuCentavos).toBe(0);
      expect(result.arpuPesos).toBe(0);
      expect(result.activeSubscriptions).toBe(0);
    });

    it('should default to last 30 days when no dates provided', async () => {
      (prisma.payment.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 0 }, _count: 0 });
      (prisma.subscription.count as jest.Mock).mockResolvedValue(0);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ mrr: BigInt(0) }]);
      (prisma.checkoutPriceSnapshot.aggregate as jest.Mock).mockResolvedValue({
        _sum: { totalDiscountAmount: 0 },
      });

      await service.getRevenueSummary({});

      expect(prisma.payment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            paidAt: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        }),
      );
    });
  });

  describe('getRevenueTrend', () => {
    it('should return trend data with proper conversion', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { period: new Date('2026-03-01'), revenue_centavos: BigInt(100000), payment_count: BigInt(5) },
        { period: new Date('2026-03-02'), revenue_centavos: BigInt(200000), payment_count: BigInt(8) },
      ]);

      const result = await service.getRevenueTrend(trendDto);

      expect(result.data).toHaveLength(2);
      expect(result.data[0]!.revenueCentavos).toBe(100000);
      expect(result.data[0]!.revenuePesos).toBe(1000);
      expect(result.data[0]!.paymentCount).toBe(5);
      expect(result.periodType).toBe('day');
    });

    it('should return empty array when no payments', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      const result = await service.getRevenueTrend(trendDto);

      expect(result.data).toHaveLength(0);
    });
  });

  describe('getRevenueByPlan', () => {
    it('should return revenue grouped by plan', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          plan_code: 'pro',
          plan_name: 'Pro',
          revenue_centavos: BigInt(300000),
          payment_count: BigInt(10),
          subscription_count: BigInt(5),
        },
        {
          plan_code: 'team',
          plan_name: 'Team',
          revenue_centavos: BigInt(500000),
          payment_count: BigInt(4),
          subscription_count: BigInt(2),
        },
      ]);

      const result = await service.getRevenueByPlan(defaultDto);

      expect(result.data).toHaveLength(2);
      expect(result.totalRevenueCentavos).toBe(800000);
      expect(result.totalRevenuePesos).toBe(8000);
      expect(result.data[0]!.planCode).toBe('pro');
    });
  });

  // =====================================================================
  // Subscriptions
  // =====================================================================

  describe('getSubscriptionSummary', () => {
    it('should compute active, churn, growth metrics', async () => {
      (prisma.subscription.groupBy as jest.Mock).mockResolvedValue([
        { status: 'active', _count: 50 },
        { status: 'trialing', _count: 10 },
        { status: 'cancelled', _count: 5 },
      ]);
      // activePaid count
      (prisma.subscription.count as jest.Mock)
        .mockResolvedValueOnce(45) // activePaid
        .mockResolvedValueOnce(15) // newInPeriod
        .mockResolvedValueOnce(3)  // cancelledInPeriod
        .mockResolvedValueOnce(48); // activeAtStart

      const result = await service.getSubscriptionSummary(defaultDto);

      expect(result.totalActive).toBe(50);
      expect(result.activePaid).toBe(45);
      expect(result.activeTrial).toBe(10);
      expect(result.newInPeriod).toBe(15);
      expect(result.cancelledInPeriod).toBe(3);
      expect(result.churnRate).toBe(0.0625); // 3/48
      expect(result.netGrowth).toBe(12); // 15 - 3
    });

    it('should handle zero active at start (churnRate=0)', async () => {
      (prisma.subscription.groupBy as jest.Mock).mockResolvedValue([]);
      (prisma.subscription.count as jest.Mock)
        .mockResolvedValueOnce(0) // activePaid
        .mockResolvedValueOnce(5) // newInPeriod
        .mockResolvedValueOnce(0) // cancelledInPeriod
        .mockResolvedValueOnce(0); // activeAtStart

      const result = await service.getSubscriptionSummary(defaultDto);

      expect(result.churnRate).toBe(0);
    });
  });

  describe('getSubscriptionTrend', () => {
    it('should return new subs vs cancellations per period', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { period: new Date('2026-03-01'), new_subs: BigInt(10), cancellations: BigInt(2) },
        { period: new Date('2026-03-08'), new_subs: BigInt(8), cancellations: BigInt(1) },
      ]);

      const result = await service.getSubscriptionTrend({ ...defaultDto, period: 'week' });

      expect(result.data).toHaveLength(2);
      expect(result.data[0]!.newSubscriptions).toBe(10);
      expect(result.data[0]!.cancellations).toBe(2);
      expect(result.data[0]!.netChange).toBe(8);
      expect(result.periodType).toBe('week');
    });
  });

  describe('getSubscriptionDistribution', () => {
    it('should return distributions by plan, status, and billing period', async () => {
      (prisma.subscription.groupBy as jest.Mock)
        .mockResolvedValueOnce([
          { planCode: 'pro', _count: 20 },
          { planCode: 'free', _count: 50 },
        ])
        .mockResolvedValueOnce([
          { status: 'active', _count: 60 },
          { status: 'trialing', _count: 10 },
        ])
        .mockResolvedValueOnce([
          { billingPeriod: 'monthly', _count: 40 },
          { billingPeriod: 'annual', _count: 30 },
        ]);

      const result = await service.getSubscriptionDistribution(defaultDto);

      expect(result.byPlan).toHaveLength(2);
      expect(result.byPlan[0]).toEqual({ label: 'pro', count: 20 });
      expect(result.byStatus).toHaveLength(2);
      expect(result.byBillingPeriod).toHaveLength(2);
    });
  });

  // =====================================================================
  // Trials
  // =====================================================================

  describe('getTrialSummary', () => {
    it('should compute conversion rate and avg duration', async () => {
      (prisma.trialRecord.groupBy as jest.Mock).mockResolvedValue([
        { status: 'active', _count: 5 },
        { status: 'converted', _count: 20 },
        { status: 'expired', _count: 10 },
        { status: 'cancelled', _count: 3 },
      ]);
      (prisma.trialRecord.aggregate as jest.Mock).mockResolvedValue({
        _avg: { trialDurationDays: 14.5 },
      });

      const result = await service.getTrialSummary(defaultDto);

      expect(result.totalTrials).toBe(38);
      expect(result.convertedTrials).toBe(20);
      expect(result.conversionRate).toBe(0.6667); // 20/(20+10) rounded
      expect(result.avgTrialDurationDays).toBe(14.5);
    });

    it('should handle zero trials (conversionRate=0)', async () => {
      (prisma.trialRecord.groupBy as jest.Mock).mockResolvedValue([]);
      (prisma.trialRecord.aggregate as jest.Mock).mockResolvedValue({
        _avg: { trialDurationDays: null },
      });

      const result = await service.getTrialSummary(defaultDto);

      expect(result.totalTrials).toBe(0);
      expect(result.conversionRate).toBe(0);
      expect(result.avgTrialDurationDays).toBe(0);
    });
  });

  // =====================================================================
  // Payments
  // =====================================================================

  describe('getPaymentSummary', () => {
    it('should compute success rate and amounts', async () => {
      (prisma.payment.groupBy as jest.Mock).mockResolvedValue([
        { status: 'succeeded', _count: 90 },
        { status: 'failed', _count: 10 },
        { status: 'pending', _count: 5 },
        { status: 'refunded', _count: 2 },
      ]);
      (prisma.payment.aggregate as jest.Mock).mockResolvedValue({
        _sum: { amount: 900000 },
        _avg: { amount: 10000 },
        _count: 90,
      });

      const result = await service.getPaymentSummary(defaultDto);

      expect(result.totalSucceeded).toBe(90);
      expect(result.totalFailed).toBe(10);
      expect(result.successRate).toBe(0.9); // 90/100
      expect(result.totalAmountCentavos).toBe(900000);
      expect(result.totalAmountPesos).toBe(9000);
      expect(result.avgTransactionCentavos).toBe(10000);
      expect(result.avgTransactionPesos).toBe(100);
    });

    it('should handle zero payments (successRate=0)', async () => {
      (prisma.payment.groupBy as jest.Mock).mockResolvedValue([]);
      (prisma.payment.aggregate as jest.Mock).mockResolvedValue({
        _sum: { amount: null },
        _avg: { amount: null },
        _count: 0,
      });

      const result = await service.getPaymentSummary(defaultDto);

      expect(result.successRate).toBe(0);
      expect(result.totalAmountCentavos).toBe(0);
      expect(result.avgTransactionCentavos).toBe(0);
    });
  });

  describe('getPaymentTrend', () => {
    it('should return succeeded vs failed per period', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          period: new Date('2026-03-01'),
          succeeded_count: BigInt(15),
          failed_count: BigInt(2),
          succeeded_amount: BigInt(150000),
        },
      ]);

      const result = await service.getPaymentTrend(trendDto);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.succeededCount).toBe(15);
      expect(result.data[0]!.failedCount).toBe(2);
      expect(result.data[0]!.succeededAmountCentavos).toBe(150000);
      expect(result.data[0]!.succeededAmountPesos).toBe(1500);
    });
  });

  // =====================================================================
  // Discounts
  // =====================================================================

  describe('getDiscountSummary', () => {
    it('should aggregate coupon + promotion discounts', async () => {
      (prisma.couponRedemption.aggregate as jest.Mock).mockResolvedValue({
        _sum: { discountAmountApplied: 50000 },
        _count: 10,
      });
      (prisma.promotionRedemption.aggregate as jest.Mock).mockResolvedValue({
        _sum: { discountAmountApplied: 30000 },
        _count: 5,
      });
      (prisma.payment.aggregate as jest.Mock).mockResolvedValue({
        _sum: { amount: 500000 },
      });

      const result = await service.getDiscountSummary(defaultDto);

      expect(result.totalCouponRedemptions).toBe(10);
      expect(result.couponDiscountCentavos).toBe(50000);
      expect(result.couponDiscountPesos).toBe(500);
      expect(result.totalPromotionRedemptions).toBe(5);
      expect(result.promotionDiscountCentavos).toBe(30000);
      expect(result.totalDiscountCentavos).toBe(80000);
      expect(result.discountToRevenueRatio).toBe(0.16); // 80000/500000
    });

    it('should handle zero revenue (ratio=0)', async () => {
      (prisma.couponRedemption.aggregate as jest.Mock).mockResolvedValue({
        _sum: { discountAmountApplied: 0 },
        _count: 0,
      });
      (prisma.promotionRedemption.aggregate as jest.Mock).mockResolvedValue({
        _sum: { discountAmountApplied: 0 },
        _count: 0,
      });
      (prisma.payment.aggregate as jest.Mock).mockResolvedValue({
        _sum: { amount: 0 },
      });

      const result = await service.getDiscountSummary(defaultDto);

      expect(result.discountToRevenueRatio).toBe(0);
    });
  });

  describe('getTopCoupons', () => {
    it('should return top coupons by redemption count', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          coupon_id: 'c-1',
          code: 'LAUNCH2026',
          name: 'Launch Promo',
          redemption_count: BigInt(50),
          total_discount: BigInt(250000),
        },
      ]);

      const result = await service.getTopCoupons(topDto);

      expect(result).toHaveLength(1);
      expect(result[0]!.couponId).toBe('c-1');
      expect(result[0]!.code).toBe('LAUNCH2026');
      expect(result[0]!.redemptionCount).toBe(50);
      expect(result[0]!.totalDiscountCentavos).toBe(250000);
      expect(result[0]!.totalDiscountPesos).toBe(2500);
    });

    it('should return empty array when no coupons redeemed', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      const result = await service.getTopCoupons(topDto);

      expect(result).toHaveLength(0);
    });
  });

  describe('getTopPromotions', () => {
    it('should return top promotions by discount amount', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          promotion_id: 'p-1',
          name: 'Summer Sale',
          slug: 'summer-sale',
          redemption_count: BigInt(30),
          total_discount: BigInt(180000),
        },
      ]);

      const result = await service.getTopPromotions(topDto);

      expect(result).toHaveLength(1);
      expect(result[0]!.promotionId).toBe('p-1');
      expect(result[0]!.slug).toBe('summer-sale');
      expect(result[0]!.totalDiscountPesos).toBe(1800);
    });
  });

  // =====================================================================
  // Customers
  // =====================================================================

  describe('getCustomerSummary', () => {
    it('should compute org counts and seat utilization', async () => {
      (prisma.organization.count as jest.Mock)
        .mockResolvedValueOnce(100)  // total
        .mockResolvedValueOnce(15);  // new signups
      (prisma.organization.groupBy as jest.Mock).mockResolvedValue([
        { type: 'individual', _count: 60 },
        { type: 'firm', _count: 30 },
        { type: 'school', _count: 10 },
      ]);
      (prisma.subscription.aggregate as jest.Mock).mockResolvedValue({
        _sum: { seats: 200 },
      });
      (prisma.organizationMember.count as jest.Mock).mockResolvedValue(150);

      const result = await service.getCustomerSummary(defaultDto);

      expect(result.totalOrganizations).toBe(100);
      expect(result.byType).toHaveLength(3);
      expect(result.newSignupsInPeriod).toBe(15);
      expect(result.totalSeats).toBe(200);
      expect(result.usedSeats).toBe(150);
      expect(result.seatUtilization).toBe(0.75); // 150/200
    });

    it('should handle zero seats (utilization=0)', async () => {
      (prisma.organization.count as jest.Mock)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      (prisma.organization.groupBy as jest.Mock).mockResolvedValue([]);
      (prisma.subscription.aggregate as jest.Mock).mockResolvedValue({
        _sum: { seats: null },
      });
      (prisma.organizationMember.count as jest.Mock).mockResolvedValue(0);

      const result = await service.getCustomerSummary(defaultDto);

      expect(result.seatUtilization).toBe(0);
      expect(result.totalSeats).toBe(0);
    });
  });

  // =====================================================================
  // Centavo-to-peso conversion accuracy
  // =====================================================================

  describe('centavo-to-peso conversion', () => {
    it('should convert fractional centavos correctly', async () => {
      (prisma.payment.aggregate as jest.Mock).mockResolvedValue({
        _sum: { amount: 99999 }, // 999.99 pesos
        _count: 1,
      });
      (prisma.subscription.count as jest.Mock).mockResolvedValue(1);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ mrr: BigInt(99999) }]);
      (prisma.checkoutPriceSnapshot.aggregate as jest.Mock).mockResolvedValue({
        _sum: { totalDiscountAmount: 1 }, // 0.01 pesos
      });

      const result = await service.getRevenueSummary(defaultDto);

      expect(result.mrrPesos).toBe(999.99);
      expect(result.totalDiscountsPesos).toBe(0.01);
    });
  });
});
