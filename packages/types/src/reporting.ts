// =====================================================================
// Reporting & Analytics Types
// =====================================================================

// -----------------------------------------------------------------------
// Enums & Common Types
// -----------------------------------------------------------------------

export enum ReportPeriod {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

/** A single time-series data point with a date label and numeric value */
export interface TimePeriodDataPoint {
  period: string;
  value: number;
}

/** A labeled count (e.g. { label: 'active', count: 42 }) */
export interface LabeledCount {
  label: string;
  count: number;
}

/** A labeled amount in centavos + pesos */
export interface LabeledAmount {
  label: string;
  amountCentavos: number;
  amountPesos: number;
}

// -----------------------------------------------------------------------
// Revenue
// -----------------------------------------------------------------------

export interface RevenueSummary {
  /** Monthly Recurring Revenue (centavos) */
  mrrCentavos: number;
  /** Monthly Recurring Revenue (pesos) */
  mrrPesos: number;
  /** Annual Recurring Revenue (centavos) */
  arrCentavos: number;
  /** Annual Recurring Revenue (pesos) */
  arrPesos: number;
  /** Average Revenue Per User (centavos) */
  arpuCentavos: number;
  /** Average Revenue Per User (pesos) */
  arpuPesos: number;
  /** Net revenue in period (centavos) */
  netRevenueCentavos: number;
  /** Net revenue in period (pesos) */
  netRevenuePesos: number;
  /** Total discounts applied in period (centavos) */
  totalDiscountsCentavos: number;
  /** Total discounts applied in period (pesos) */
  totalDiscountsPesos: number;
  /** Number of active paid subscriptions */
  activeSubscriptions: number;
}

export interface RevenueTrendPoint {
  period: string;
  revenueCentavos: number;
  revenuePesos: number;
  paymentCount: number;
}

export interface RevenueTrendResponse {
  data: RevenueTrendPoint[];
  periodType: string;
  startDate: string;
  endDate: string;
}

export interface RevenueByPlanItem {
  planCode: string;
  planName: string;
  revenueCentavos: number;
  revenuePesos: number;
  paymentCount: number;
  subscriptionCount: number;
}

export interface RevenueByPlanResponse {
  data: RevenueByPlanItem[];
  totalRevenueCentavos: number;
  totalRevenuePesos: number;
}

// -----------------------------------------------------------------------
// Subscriptions
// -----------------------------------------------------------------------

export interface SubscriptionSummary {
  /** Total active subscriptions (including trials) */
  totalActive: number;
  /** Active paid subscriptions (excluding free) */
  activePaid: number;
  /** Active trialing subscriptions */
  activeTrial: number;
  /** New subscriptions in period */
  newInPeriod: number;
  /** Cancelled subscriptions in period */
  cancelledInPeriod: number;
  /** Churn rate (cancelled / active at start of period) */
  churnRate: number;
  /** Net subscription growth in period */
  netGrowth: number;
}

export interface SubscriptionTrendPoint {
  period: string;
  newSubscriptions: number;
  cancellations: number;
  netChange: number;
}

export interface SubscriptionTrendResponse {
  data: SubscriptionTrendPoint[];
  periodType: string;
  startDate: string;
  endDate: string;
}

export interface SubscriptionDistributionResponse {
  byPlan: LabeledCount[];
  byStatus: LabeledCount[];
  byBillingPeriod: LabeledCount[];
}

// -----------------------------------------------------------------------
// Trials
// -----------------------------------------------------------------------

export interface TrialSummary {
  /** Total trials started in period */
  totalTrials: number;
  /** Active trials right now */
  activeTrials: number;
  /** Trials converted to paid */
  convertedTrials: number;
  /** Trials expired without conversion */
  expiredTrials: number;
  /** Trials cancelled */
  cancelledTrials: number;
  /** Conversion rate = converted / (converted + expired) */
  conversionRate: number;
  /** Average trial duration in days */
  avgTrialDurationDays: number;
}

// -----------------------------------------------------------------------
// Payments
// -----------------------------------------------------------------------

export interface PaymentSummary {
  /** Total succeeded payments in period */
  totalSucceeded: number;
  /** Total failed payments in period */
  totalFailed: number;
  /** Total pending payments */
  totalPending: number;
  /** Total refunded payments in period */
  totalRefunded: number;
  /** Success rate = succeeded / (succeeded + failed) */
  successRate: number;
  /** Total revenue from succeeded payments (centavos) */
  totalAmountCentavos: number;
  /** Total revenue from succeeded payments (pesos) */
  totalAmountPesos: number;
  /** Average transaction value (centavos) */
  avgTransactionCentavos: number;
  /** Average transaction value (pesos) */
  avgTransactionPesos: number;
}

export interface PaymentTrendPoint {
  period: string;
  succeededCount: number;
  failedCount: number;
  succeededAmountCentavos: number;
  succeededAmountPesos: number;
}

export interface PaymentTrendResponse {
  data: PaymentTrendPoint[];
  periodType: string;
  startDate: string;
  endDate: string;
}

// -----------------------------------------------------------------------
// Discounts (Coupons + Promotions)
// -----------------------------------------------------------------------

export interface DiscountSummary {
  /** Total coupon redemptions in period */
  totalCouponRedemptions: number;
  /** Total coupon discount amount (centavos) */
  couponDiscountCentavos: number;
  /** Total coupon discount amount (pesos) */
  couponDiscountPesos: number;
  /** Total promotion redemptions in period */
  totalPromotionRedemptions: number;
  /** Total promotion discount amount (centavos) */
  promotionDiscountCentavos: number;
  /** Total promotion discount amount (pesos) */
  promotionDiscountPesos: number;
  /** Combined discount total (centavos) */
  totalDiscountCentavos: number;
  /** Combined discount total (pesos) */
  totalDiscountPesos: number;
  /** Discount-to-revenue ratio */
  discountToRevenueRatio: number;
}

export interface TopCouponItem {
  couponId: string;
  code: string;
  name: string;
  redemptionCount: number;
  totalDiscountCentavos: number;
  totalDiscountPesos: number;
}

export interface TopPromotionItem {
  promotionId: string;
  name: string;
  slug: string;
  redemptionCount: number;
  totalDiscountCentavos: number;
  totalDiscountPesos: number;
}

// -----------------------------------------------------------------------
// Customers / Organizations
// -----------------------------------------------------------------------

export interface CustomerSummary {
  /** Total organizations */
  totalOrganizations: number;
  /** Organizations by type */
  byType: LabeledCount[];
  /** New signups in period */
  newSignupsInPeriod: number;
  /** Total seats across all active subscriptions */
  totalSeats: number;
  /** Seats actually used (org members with active status) */
  usedSeats: number;
  /** Seat utilization = usedSeats / totalSeats */
  seatUtilization: number;
}
