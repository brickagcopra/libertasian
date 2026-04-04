// =====================================================================
// Admin Simulator Types — Read-only "what-if" simulation responses
// =====================================================================

import type { PriceBreakdown, DiscountPreview } from './billing';

// -----------------------------------------------------------------------
// State Machine Simulation
// -----------------------------------------------------------------------

export interface SimulatedSideEffect {
  type: string;
  payload?: Record<string, unknown>;
}

export interface SimulateTransitionResult {
  valid: boolean;
  fromState: string;
  action: string;
  toState: string | null;
  hasAccess: boolean;
  sideEffects: SimulatedSideEffect[];
  validActionsFromNewState: string[];
  error: string | null;
}

export interface LifecycleStep {
  step: number;
  action: string;
  fromState: string;
  toState: string | null;
  valid: boolean;
  hasAccess: boolean;
  sideEffects: SimulatedSideEffect[];
  error: string | null;
}

export interface SimulateLifecycleResult {
  startingState: string;
  steps: LifecycleStep[];
  finalState: string;
  finalHasAccess: boolean;
  totalSteps: number;
  successfulSteps: number;
  failedAtStep: number | null;
}

// -----------------------------------------------------------------------
// Pricing Simulation
// -----------------------------------------------------------------------

export interface SimulatePricingResult extends PriceBreakdown {
  simulatedAt: string;
}

// -----------------------------------------------------------------------
// Proration Simulation
// -----------------------------------------------------------------------

export interface SimulateProrationResult {
  currentPlanCode: string;
  newPlanCode: string;
  billingPeriod: string;
  creditAmount: number;
  chargeAmount: number;
  netAmount: number;
  currency: string;
  daysRemaining: number;
  totalDays: number;
  currentDailyRate: number;
  newDailyRate: number;
  effectiveDate: string;
  periodStart: string;
  periodEnd: string;
}

// -----------------------------------------------------------------------
// Coupon Simulation
// -----------------------------------------------------------------------

export interface SimulateCouponResult {
  couponCode: string;
  valid: boolean;
  errors: string[];
  couponId: string | null;
  couponName: string | null;
  discountType: string | null;
  discountValue: number | null;
  discountPreview: DiscountPreview | null;
}

// -----------------------------------------------------------------------
// Promotion Simulation
// -----------------------------------------------------------------------

export interface SimulatePromotionResult {
  promotionId: string;
  eligible: boolean;
  errors: string[];
  ruleResults: Array<{
    ruleType: string;
    passed: boolean;
    reason?: string;
  }>;
  discountPreview: DiscountPreview | null;
}

// -----------------------------------------------------------------------
// Revenue Impact Simulation
// -----------------------------------------------------------------------

export interface RevenueImpactPlanBreakdown {
  planCode: string;
  billingPeriod: string;
  basePriceAmount: number;
  discountAmount: number;
  finalAmount: number;
  discountPercentage: number;
  currency: string;
}

export interface SimulateRevenueImpactResult {
  sourceType: 'coupon' | 'promotion';
  sourceId: string;
  sourceName: string;
  plans: RevenueImpactPlanBreakdown[];
  totalBaseRevenue: number;
  totalDiscountedRevenue: number;
  totalDiscountAmount: number;
  averageDiscountPercentage: number;
  currency: string;
  simulatedAt: string;
}
