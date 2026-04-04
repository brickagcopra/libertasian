import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import type { DateRangeQueryDto, TrendQueryDto, TopItemsQueryDto } from './dto';
import type {
  RevenueSummary,
  RevenueTrendResponse,
  RevenueByPlanResponse,
  SubscriptionSummary,
  SubscriptionTrendResponse,
  SubscriptionDistributionResponse,
  TrialSummary,
  PaymentSummary,
  PaymentTrendResponse,
  DiscountSummary,
  TopCouponItem,
  TopPromotionItem,
  CustomerSummary,
  LabeledCount,
} from '@libertasian/types';

// -----------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------

const CACHE_PREFIX = 'cache:reporting:';
const CACHE_TTL = 300; // 5 minutes

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

interface DateRange {
  startDate: Date;
  endDate: Date;
}

function resolveDateRange(dto: DateRangeQueryDto): DateRange {
  const endDate = dto.endDate ? new Date(dto.endDate) : new Date();
  const startDate = dto.startDate
    ? new Date(dto.startDate)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
  return { startDate, endDate };
}

function cacheKey(segment: string, params: unknown): string {
  const hash = JSON.stringify(params);
  return `${CACHE_PREFIX}${segment}:${hash}`;
}

function centavosToPesos(centavos: number): number {
  return Math.round(centavos) / 100;
}

/**
 * Validates and returns a safe period literal for date_trunc.
 * Only allows 'day', 'week', 'month' — prevents SQL injection.
 */
function safePeriod(period?: string): string {
  const allowed = ['day', 'week', 'month'];
  if (period && allowed.includes(period)) return period;
  return 'day';
}

// -----------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------

@Injectable()
export class ReportingService {
  private readonly logger = new Logger(ReportingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // =====================================================================
  // Revenue
  // =====================================================================

  async getRevenueSummary(dto: DateRangeQueryDto): Promise<RevenueSummary> {
    const key = cacheKey('revenue-summary', dto);
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as RevenueSummary;

    const { startDate, endDate } = resolveDateRange(dto);

    // Net revenue in period (succeeded payments)
    const revenueAgg = await this.prisma.payment.aggregate({
      where: {
        status: 'succeeded',
        paidAt: { gte: startDate, lte: endDate },
      },
      _sum: { amount: true },
      _count: true,
    });

    const netRevenueCentavos = revenueAgg._sum.amount ?? 0;

    // Active paid subscriptions (excluding free plan)
    const activeSubscriptions = await this.prisma.subscription.count({
      where: {
        status: 'active',
        planCode: { not: 'free' },
      },
    });

    // MRR: sum of latest succeeded payment per active subscription, normalized to monthly
    // Using raw query for the lateral join pattern
    const mrrResult = await this.prisma.$queryRaw<{ mrr: bigint | null }[]>`
      SELECT COALESCE(SUM(
        CASE
          WHEN s.billing_period = 'annual' THEN p.amount / 12
          ELSE p.amount
        END
      ), 0) AS mrr
      FROM subscriptions s
      INNER JOIN LATERAL (
        SELECT amount
        FROM payments
        WHERE subscription_id = s.id
          AND status = 'succeeded'
        ORDER BY paid_at DESC
        LIMIT 1
      ) p ON true
      WHERE s.status = 'active'
        AND s.plan_code != 'free'
    `;

    const mrrCentavos = Number(mrrResult[0]?.mrr ?? 0);
    const arrCentavos = mrrCentavos * 12;
    const arpuCentavos = activeSubscriptions > 0
      ? Math.round(mrrCentavos / activeSubscriptions)
      : 0;

    // Total discounts in period
    const discountAgg = await this.prisma.checkoutPriceSnapshot.aggregate({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        totalDiscountAmount: { gt: 0 },
      },
      _sum: { totalDiscountAmount: true },
    });

    const totalDiscountsCentavos = discountAgg._sum.totalDiscountAmount ?? 0;

    const result: RevenueSummary = {
      mrrCentavos,
      mrrPesos: centavosToPesos(mrrCentavos),
      arrCentavos,
      arrPesos: centavosToPesos(arrCentavos),
      arpuCentavos,
      arpuPesos: centavosToPesos(arpuCentavos),
      netRevenueCentavos,
      netRevenuePesos: centavosToPesos(netRevenueCentavos),
      totalDiscountsCentavos,
      totalDiscountsPesos: centavosToPesos(totalDiscountsCentavos),
      activeSubscriptions,
    };

    await this.redis.set(key, JSON.stringify(result), CACHE_TTL);
    return result;
  }

  async getRevenueTrend(dto: TrendQueryDto): Promise<RevenueTrendResponse> {
    const key = cacheKey('revenue-trend', dto);
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as RevenueTrendResponse;

    const { startDate, endDate } = resolveDateRange(dto);
    const period = safePeriod(dto.period);

    const rows = await this.prisma.$queryRaw<
      { period: Date; revenue_centavos: bigint; payment_count: bigint }[]
    >`
      SELECT
        date_trunc(${Prisma.raw(`'${period}'`)}, paid_at) AS period,
        COALESCE(SUM(amount), 0) AS revenue_centavos,
        COUNT(*) AS payment_count
      FROM payments
      WHERE status = 'succeeded'
        AND paid_at >= ${startDate}
        AND paid_at <= ${endDate}
      GROUP BY 1
      ORDER BY 1
    `;

    const data = rows.map((r) => ({
      period: r.period.toISOString(),
      revenueCentavos: Number(r.revenue_centavos),
      revenuePesos: centavosToPesos(Number(r.revenue_centavos)),
      paymentCount: Number(r.payment_count),
    }));

    const result: RevenueTrendResponse = {
      data,
      periodType: period,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    };

    await this.redis.set(key, JSON.stringify(result), CACHE_TTL);
    return result;
  }

  async getRevenueByPlan(dto: DateRangeQueryDto): Promise<RevenueByPlanResponse> {
    const key = cacheKey('revenue-by-plan', dto);
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as RevenueByPlanResponse;

    const { startDate, endDate } = resolveDateRange(dto);

    const rows = await this.prisma.$queryRaw<
      {
        plan_code: string;
        plan_name: string;
        revenue_centavos: bigint;
        payment_count: bigint;
        subscription_count: bigint;
      }[]
    >`
      SELECT
        s.plan_code,
        COALESCE(pl.display_name, s.plan_code) AS plan_name,
        COALESCE(SUM(p.amount), 0) AS revenue_centavos,
        COUNT(DISTINCT p.id) AS payment_count,
        COUNT(DISTINCT s.id) AS subscription_count
      FROM payments p
      INNER JOIN subscriptions s ON s.id = p.subscription_id
      LEFT JOIN plans pl ON pl.code = s.plan_code
      WHERE p.status = 'succeeded'
        AND p.paid_at >= ${startDate}
        AND p.paid_at <= ${endDate}
      GROUP BY s.plan_code, pl.display_name
      ORDER BY revenue_centavos DESC
    `;

    const data = rows.map((r) => ({
      planCode: r.plan_code,
      planName: r.plan_name,
      revenueCentavos: Number(r.revenue_centavos),
      revenuePesos: centavosToPesos(Number(r.revenue_centavos)),
      paymentCount: Number(r.payment_count),
      subscriptionCount: Number(r.subscription_count),
    }));

    const totalRevenueCentavos = data.reduce((s, d) => s + d.revenueCentavos, 0);

    const result: RevenueByPlanResponse = {
      data,
      totalRevenueCentavos,
      totalRevenuePesos: centavosToPesos(totalRevenueCentavos),
    };

    await this.redis.set(key, JSON.stringify(result), CACHE_TTL);
    return result;
  }

  // =====================================================================
  // Subscriptions
  // =====================================================================

  async getSubscriptionSummary(dto: DateRangeQueryDto): Promise<SubscriptionSummary> {
    const key = cacheKey('subscription-summary', dto);
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as SubscriptionSummary;

    const { startDate, endDate } = resolveDateRange(dto);

    // Current counts by status
    const statusGroups = await this.prisma.subscription.groupBy({
      by: ['status'],
      _count: true,
    });

    const statusMap = new Map(statusGroups.map((g) => [g.status, g._count]));
    const totalActive = statusMap.get('active') ?? 0;
    const activeTrial = statusMap.get('trialing') ?? 0;

    // Active paid = active subs with non-free plan
    const activePaid = await this.prisma.subscription.count({
      where: { status: 'active', planCode: { not: 'free' } },
    });

    // New subscriptions in period
    const newInPeriod = await this.prisma.subscription.count({
      where: { createdAt: { gte: startDate, lte: endDate } },
    });

    // Cancelled in period
    const cancelledInPeriod = await this.prisma.subscription.count({
      where: { canceledAt: { gte: startDate, lte: endDate } },
    });

    // Churn rate: cancelled in period / active at start of period
    const activeAtStart = await this.prisma.subscription.count({
      where: {
        createdAt: { lt: startDate },
        OR: [
          { canceledAt: null },
          { canceledAt: { gte: startDate } },
        ],
      },
    });

    const churnRate = activeAtStart > 0
      ? Math.round((cancelledInPeriod / activeAtStart) * 10000) / 10000
      : 0;

    const result: SubscriptionSummary = {
      totalActive,
      activePaid,
      activeTrial,
      newInPeriod,
      cancelledInPeriod,
      churnRate,
      netGrowth: newInPeriod - cancelledInPeriod,
    };

    await this.redis.set(key, JSON.stringify(result), CACHE_TTL);
    return result;
  }

  async getSubscriptionTrend(dto: TrendQueryDto): Promise<SubscriptionTrendResponse> {
    const key = cacheKey('subscription-trend', dto);
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as SubscriptionTrendResponse;

    const { startDate, endDate } = resolveDateRange(dto);
    const period = safePeriod(dto.period);

    const rows = await this.prisma.$queryRaw<
      { period: Date; new_subs: bigint; cancellations: bigint }[]
    >`
      SELECT
        gs.period,
        COALESCE(n.cnt, 0) AS new_subs,
        COALESCE(c.cnt, 0) AS cancellations
      FROM generate_series(
        date_trunc(${Prisma.raw(`'${period}'`)}, ${startDate}::timestamptz),
        date_trunc(${Prisma.raw(`'${period}'`)}, ${endDate}::timestamptz),
        ${Prisma.raw(`'1 ${period}'::interval`)}
      ) AS gs(period)
      LEFT JOIN (
        SELECT date_trunc(${Prisma.raw(`'${period}'`)}, created_at) AS p, COUNT(*) AS cnt
        FROM subscriptions
        WHERE created_at >= ${startDate} AND created_at <= ${endDate}
        GROUP BY 1
      ) n ON n.p = gs.period
      LEFT JOIN (
        SELECT date_trunc(${Prisma.raw(`'${period}'`)}, canceled_at) AS p, COUNT(*) AS cnt
        FROM subscriptions
        WHERE canceled_at >= ${startDate} AND canceled_at <= ${endDate}
        GROUP BY 1
      ) c ON c.p = gs.period
      ORDER BY 1
    `;

    const data = rows.map((r) => ({
      period: r.period.toISOString(),
      newSubscriptions: Number(r.new_subs),
      cancellations: Number(r.cancellations),
      netChange: Number(r.new_subs) - Number(r.cancellations),
    }));

    const result: SubscriptionTrendResponse = {
      data,
      periodType: period,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    };

    await this.redis.set(key, JSON.stringify(result), CACHE_TTL);
    return result;
  }

  async getSubscriptionDistribution(
    _dto: DateRangeQueryDto,
  ): Promise<SubscriptionDistributionResponse> {
    const key = cacheKey('subscription-distribution', {});
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as SubscriptionDistributionResponse;

    const [byPlanRaw, byStatusRaw, byBillingRaw] = await Promise.all([
      this.prisma.subscription.groupBy({
        by: ['planCode'],
        _count: true,
        orderBy: { _count: { planCode: 'desc' } },
      }),
      this.prisma.subscription.groupBy({
        by: ['status'],
        _count: true,
        orderBy: { _count: { status: 'desc' } },
      }),
      this.prisma.subscription.groupBy({
        by: ['billingPeriod'],
        _count: true,
        orderBy: { _count: { billingPeriod: 'desc' } },
      }),
    ]);

    const toLabeled = (
      items: { _count: number; [key: string]: unknown }[],
      labelKey: string,
    ): LabeledCount[] =>
      items.map((item) => ({
        label: String(item[labelKey]),
        count: item._count,
      }));

    const result: SubscriptionDistributionResponse = {
      byPlan: toLabeled(byPlanRaw, 'planCode'),
      byStatus: toLabeled(byStatusRaw, 'status'),
      byBillingPeriod: toLabeled(byBillingRaw, 'billingPeriod'),
    };

    await this.redis.set(key, JSON.stringify(result), CACHE_TTL);
    return result;
  }

  // =====================================================================
  // Trials
  // =====================================================================

  async getTrialSummary(dto: DateRangeQueryDto): Promise<TrialSummary> {
    const key = cacheKey('trial-summary', dto);
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as TrialSummary;

    const { startDate, endDate } = resolveDateRange(dto);

    const statusGroups = await this.prisma.trialRecord.groupBy({
      by: ['status'],
      _count: true,
      where: { trialStartedAt: { gte: startDate, lte: endDate } },
    });

    const statusMap = new Map(statusGroups.map((g) => [g.status, g._count]));
    const activeTrials = statusMap.get('active') ?? 0;
    const convertedTrials = statusMap.get('converted') ?? 0;
    const expiredTrials = statusMap.get('expired') ?? 0;
    const cancelledTrials = statusMap.get('cancelled') ?? 0;
    const totalTrials = activeTrials + convertedTrials + expiredTrials + cancelledTrials;

    const conversionDenom = convertedTrials + expiredTrials;
    const conversionRate = conversionDenom > 0
      ? Math.round((convertedTrials / conversionDenom) * 10000) / 10000
      : 0;

    // Average trial duration
    const durationAgg = await this.prisma.trialRecord.aggregate({
      where: { trialStartedAt: { gte: startDate, lte: endDate } },
      _avg: { trialDurationDays: true },
    });

    const result: TrialSummary = {
      totalTrials,
      activeTrials,
      convertedTrials,
      expiredTrials,
      cancelledTrials,
      conversionRate,
      avgTrialDurationDays: Math.round((durationAgg._avg.trialDurationDays ?? 0) * 10) / 10,
    };

    await this.redis.set(key, JSON.stringify(result), CACHE_TTL);
    return result;
  }

  // =====================================================================
  // Payments
  // =====================================================================

  async getPaymentSummary(dto: DateRangeQueryDto): Promise<PaymentSummary> {
    const key = cacheKey('payment-summary', dto);
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as PaymentSummary;

    const { startDate, endDate } = resolveDateRange(dto);

    const statusGroups = await this.prisma.payment.groupBy({
      by: ['status'],
      _count: true,
      where: { createdAt: { gte: startDate, lte: endDate } },
    });

    const statusMap = new Map(statusGroups.map((g) => [g.status, g._count]));
    const totalSucceeded = statusMap.get('succeeded') ?? 0;
    const totalFailed = statusMap.get('failed') ?? 0;
    const totalPending = statusMap.get('pending') ?? 0;
    const totalRefunded = statusMap.get('refunded') ?? 0;

    const successDenom = totalSucceeded + totalFailed;
    const successRate = successDenom > 0
      ? Math.round((totalSucceeded / successDenom) * 10000) / 10000
      : 0;

    // Aggregate for succeeded payments
    const amountAgg = await this.prisma.payment.aggregate({
      where: {
        status: 'succeeded',
        paidAt: { gte: startDate, lte: endDate },
      },
      _sum: { amount: true },
      _avg: { amount: true },
      _count: true,
    });

    const totalAmountCentavos = amountAgg._sum.amount ?? 0;
    const avgTransactionCentavos = Math.round(amountAgg._avg.amount ?? 0);

    const result: PaymentSummary = {
      totalSucceeded,
      totalFailed,
      totalPending,
      totalRefunded,
      successRate,
      totalAmountCentavos,
      totalAmountPesos: centavosToPesos(totalAmountCentavos),
      avgTransactionCentavos,
      avgTransactionPesos: centavosToPesos(avgTransactionCentavos),
    };

    await this.redis.set(key, JSON.stringify(result), CACHE_TTL);
    return result;
  }

  async getPaymentTrend(dto: TrendQueryDto): Promise<PaymentTrendResponse> {
    const key = cacheKey('payment-trend', dto);
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as PaymentTrendResponse;

    const { startDate, endDate } = resolveDateRange(dto);
    const period = safePeriod(dto.period);

    const rows = await this.prisma.$queryRaw<
      {
        period: Date;
        succeeded_count: bigint;
        failed_count: bigint;
        succeeded_amount: bigint;
      }[]
    >`
      SELECT
        date_trunc(${Prisma.raw(`'${period}'`)}, created_at) AS period,
        COUNT(*) FILTER (WHERE status = 'succeeded') AS succeeded_count,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
        COALESCE(SUM(amount) FILTER (WHERE status = 'succeeded'), 0) AS succeeded_amount
      FROM payments
      WHERE created_at >= ${startDate}
        AND created_at <= ${endDate}
      GROUP BY 1
      ORDER BY 1
    `;

    const data = rows.map((r) => ({
      period: r.period.toISOString(),
      succeededCount: Number(r.succeeded_count),
      failedCount: Number(r.failed_count),
      succeededAmountCentavos: Number(r.succeeded_amount),
      succeededAmountPesos: centavosToPesos(Number(r.succeeded_amount)),
    }));

    const result: PaymentTrendResponse = {
      data,
      periodType: period,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    };

    await this.redis.set(key, JSON.stringify(result), CACHE_TTL);
    return result;
  }

  // =====================================================================
  // Discounts
  // =====================================================================

  async getDiscountSummary(dto: DateRangeQueryDto): Promise<DiscountSummary> {
    const key = cacheKey('discount-summary', dto);
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as DiscountSummary;

    const { startDate, endDate } = resolveDateRange(dto);

    const [couponAgg, promoAgg, revenueAgg] = await Promise.all([
      this.prisma.couponRedemption.aggregate({
        where: {
          status: 'redeemed',
          redeemedAt: { gte: startDate, lte: endDate },
        },
        _sum: { discountAmountApplied: true },
        _count: true,
      }),
      this.prisma.promotionRedemption.aggregate({
        where: {
          status: 'applied',
          createdAt: { gte: startDate, lte: endDate },
        },
        _sum: { discountAmountApplied: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: {
          status: 'succeeded',
          paidAt: { gte: startDate, lte: endDate },
        },
        _sum: { amount: true },
      }),
    ]);

    const couponDiscountCentavos = couponAgg._sum.discountAmountApplied ?? 0;
    const promotionDiscountCentavos = promoAgg._sum.discountAmountApplied ?? 0;
    const totalDiscountCentavos = couponDiscountCentavos + promotionDiscountCentavos;
    const totalRevenue = revenueAgg._sum.amount ?? 0;

    const discountToRevenueRatio = totalRevenue > 0
      ? Math.round((totalDiscountCentavos / totalRevenue) * 10000) / 10000
      : 0;

    const result: DiscountSummary = {
      totalCouponRedemptions: couponAgg._count,
      couponDiscountCentavos,
      couponDiscountPesos: centavosToPesos(couponDiscountCentavos),
      totalPromotionRedemptions: promoAgg._count,
      promotionDiscountCentavos,
      promotionDiscountPesos: centavosToPesos(promotionDiscountCentavos),
      totalDiscountCentavos,
      totalDiscountPesos: centavosToPesos(totalDiscountCentavos),
      discountToRevenueRatio,
    };

    await this.redis.set(key, JSON.stringify(result), CACHE_TTL);
    return result;
  }

  async getTopCoupons(dto: TopItemsQueryDto): Promise<TopCouponItem[]> {
    const key = cacheKey('top-coupons', dto);
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as TopCouponItem[];

    const { startDate, endDate } = resolveDateRange(dto);
    const limit = dto.limit ?? 10;

    const rows = await this.prisma.$queryRaw<
      {
        coupon_id: string;
        code: string;
        name: string;
        redemption_count: bigint;
        total_discount: bigint;
      }[]
    >`
      SELECT
        c.id AS coupon_id,
        c.code,
        c.name,
        COUNT(cr.id) AS redemption_count,
        COALESCE(SUM(cr.discount_amount_applied), 0) AS total_discount
      FROM coupon_redemptions cr
      INNER JOIN coupons c ON c.id = cr.coupon_id
      WHERE cr.status = 'redeemed'
        AND cr.redeemed_at >= ${startDate}
        AND cr.redeemed_at <= ${endDate}
      GROUP BY c.id, c.code, c.name
      ORDER BY redemption_count DESC
      LIMIT ${limit}
    `;

    const result: TopCouponItem[] = rows.map((r) => ({
      couponId: r.coupon_id,
      code: r.code,
      name: r.name,
      redemptionCount: Number(r.redemption_count),
      totalDiscountCentavos: Number(r.total_discount),
      totalDiscountPesos: centavosToPesos(Number(r.total_discount)),
    }));

    await this.redis.set(key, JSON.stringify(result), CACHE_TTL);
    return result;
  }

  async getTopPromotions(dto: TopItemsQueryDto): Promise<TopPromotionItem[]> {
    const key = cacheKey('top-promotions', dto);
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as TopPromotionItem[];

    const { startDate, endDate } = resolveDateRange(dto);
    const limit = dto.limit ?? 10;

    const rows = await this.prisma.$queryRaw<
      {
        promotion_id: string;
        name: string;
        slug: string;
        redemption_count: bigint;
        total_discount: bigint;
      }[]
    >`
      SELECT
        pr.id AS promotion_id,
        pr.name,
        pr.slug,
        COUNT(prd.id) AS redemption_count,
        COALESCE(SUM(prd.discount_amount_applied), 0) AS total_discount
      FROM promotion_redemptions prd
      INNER JOIN promotions pr ON pr.id = prd.promotion_id
      WHERE prd.status = 'applied'
        AND prd.created_at >= ${startDate}
        AND prd.created_at <= ${endDate}
      GROUP BY pr.id, pr.name, pr.slug
      ORDER BY total_discount DESC
      LIMIT ${limit}
    `;

    const result: TopPromotionItem[] = rows.map((r) => ({
      promotionId: r.promotion_id,
      name: r.name,
      slug: r.slug,
      redemptionCount: Number(r.redemption_count),
      totalDiscountCentavos: Number(r.total_discount),
      totalDiscountPesos: centavosToPesos(Number(r.total_discount)),
    }));

    await this.redis.set(key, JSON.stringify(result), CACHE_TTL);
    return result;
  }

  // =====================================================================
  // Customers
  // =====================================================================

  async getCustomerSummary(dto: DateRangeQueryDto): Promise<CustomerSummary> {
    const key = cacheKey('customer-summary', dto);
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as CustomerSummary;

    const { startDate, endDate } = resolveDateRange(dto);

    const [totalOrganizations, byTypeRaw, newSignupsInPeriod, seatAgg, usedSeats] =
      await Promise.all([
        this.prisma.organization.count(),

        this.prisma.organization.groupBy({
          by: ['type'],
          _count: true,
          orderBy: { _count: { type: 'desc' } },
        }),

        this.prisma.organization.count({
          where: { createdAt: { gte: startDate, lte: endDate } },
        }),

        // Total seats across active subs
        this.prisma.subscription.aggregate({
          where: { status: 'active' },
          _sum: { seats: true },
        }),

        // Active org members
        this.prisma.organizationMember.count({
          where: { status: 'active' },
        }),
      ]);

    const totalSeats = seatAgg._sum.seats ?? 0;
    const seatUtilization = totalSeats > 0
      ? Math.round((usedSeats / totalSeats) * 10000) / 10000
      : 0;

    const byType: LabeledCount[] = byTypeRaw.map((g) => ({
      label: g.type,
      count: g._count,
    }));

    const result: CustomerSummary = {
      totalOrganizations,
      byType,
      newSignupsInPeriod,
      totalSeats,
      usedSeats,
      seatUtilization,
    };

    await this.redis.set(key, JSON.stringify(result), CACHE_TTL);
    return result;
  }
}
