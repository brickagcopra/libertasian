import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  SimulateTransitionResult,
  SimulateLifecycleResult,
  SimulatePricingResult,
  SimulateProrationResult,
  SimulateCouponResult,
  SimulatePromotionResult,
  SimulateRevenueImpactResult,
  RevenueImpactPlanBreakdown,
  LifecycleStep,
  CouponDiscountType,
} from '@libertasian/types';
import {
  SubscriptionState,
  SubscriptionAction,
  transition,
  getValidActions,
  isAccessibleState,
} from '../subscriptions/subscription-state-machine';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { ProrationService } from '../subscriptions/proration.service';
import { CouponService } from '../coupons/coupon.service';
import { PromotionRuleEngineService } from '../promotions/promotion-rule-engine.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { SimulateTransitionDto } from './dto/simulate-transition.dto';
import type { SimulateLifecycleDto } from './dto/simulate-lifecycle.dto';
import type { SimulatePricingDto } from './dto/simulate-pricing.dto';
import type { SimulateProrationDto } from './dto/simulate-proration.dto';
import type { SimulateCouponDto } from './dto/simulate-coupon.dto';
import type { SimulatePromotionDto } from './dto/simulate-promotion.dto';
import type { SimulateRevenueImpactDto } from './dto/simulate-revenue-impact.dto';

/** System-level user ID used for admin simulation context */
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class SimulatorService {
  constructor(
    private readonly pricingEngine: PricingEngineService,
    private readonly prorationService: ProrationService,
    private readonly couponService: CouponService,
    private readonly promotionRuleEngine: PromotionRuleEngineService,
    private readonly prisma: PrismaService,
  ) {}

  // ---- 1. Simulate Single Transition ----

  simulateTransition(dto: SimulateTransitionDto): SimulateTransitionResult {
    const state = this.parseState(dto.currentState);
    const action = this.parseAction(dto.action);

    const result = transition(state, action);

    if (result.success) {
      return {
        valid: true,
        fromState: result.fromState,
        action: result.action,
        toState: result.toState,
        hasAccess: isAccessibleState(result.toState),
        sideEffects: result.sideEffects,
        validActionsFromNewState: getValidActions(result.toState),
        error: null,
      };
    }

    return {
      valid: false,
      fromState: result.fromState,
      action: result.action,
      toState: null,
      hasAccess: isAccessibleState(state),
      sideEffects: [],
      validActionsFromNewState: getValidActions(state),
      error: result.error,
    };
  }

  // ---- 2. Simulate Lifecycle (Multi-Step) ----

  simulateLifecycle(dto: SimulateLifecycleDto): SimulateLifecycleResult {
    const startState = this.parseState(dto.startingState);
    const actions = dto.actions.map((a) => this.parseAction(a));

    const steps: LifecycleStep[] = [];
    let currentState = startState;
    let failedAtStep: number | null = null;

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const result = transition(currentState, action!);

      if (result.success) {
        steps.push({
          step: i + 1,
          action: result.action,
          fromState: result.fromState,
          toState: result.toState,
          valid: true,
          hasAccess: isAccessibleState(result.toState),
          sideEffects: result.sideEffects,
          error: null,
        });
        currentState = result.toState;
      } else {
        steps.push({
          step: i + 1,
          action: result.action,
          fromState: result.fromState,
          toState: null,
          valid: false,
          hasAccess: isAccessibleState(currentState),
          sideEffects: [],
          error: result.error,
        });
        failedAtStep = i + 1;
        break;
      }
    }

    return {
      startingState: startState,
      steps,
      finalState: currentState,
      finalHasAccess: isAccessibleState(currentState),
      totalSteps: actions.length,
      successfulSteps: failedAtStep !== null ? failedAtStep - 1 : actions.length,
      failedAtStep,
    };
  }

  // ---- 3. Simulate Pricing ----

  async simulatePricing(dto: SimulatePricingDto): Promise<SimulatePricingResult> {
    const breakdown = await this.pricingEngine.calculatePriceBreakdown({
      organizationId: dto.organizationId,
      userId: SYSTEM_USER_ID,
      planCode: dto.planCode,
      billingPeriod: dto.billingPeriod,
      couponCode: dto.couponCode,
      promotionId: dto.promotionId,
    });

    return {
      ...breakdown,
      simulatedAt: new Date().toISOString(),
    };
  }

  // ---- 4. Simulate Proration ----

  async simulateProration(dto: SimulateProrationDto): Promise<SimulateProrationResult> {
    const effectiveDate = dto.effectiveDate ? new Date(dto.effectiveDate) : new Date();

    const result = await this.prorationService.calculateProration({
      organizationId: SYSTEM_USER_ID,
      currentPlanCode: dto.currentPlanCode,
      newPlanCode: dto.newPlanCode,
      billingPeriod: dto.billingPeriod as 'monthly' | 'annual',
      currentPeriodStart: new Date(dto.periodStart),
      currentPeriodEnd: new Date(dto.periodEnd),
      effectiveDate,
    });

    return {
      currentPlanCode: dto.currentPlanCode,
      newPlanCode: dto.newPlanCode,
      billingPeriod: dto.billingPeriod,
      creditAmount: result.creditAmount,
      chargeAmount: result.chargeAmount,
      netAmount: result.netAmount,
      currency: result.currency,
      daysRemaining: result.daysRemaining,
      totalDays: result.totalDays,
      currentDailyRate: result.currentDailyRate,
      newDailyRate: result.newDailyRate,
      effectiveDate: effectiveDate.toISOString(),
      periodStart: dto.periodStart,
      periodEnd: dto.periodEnd,
    };
  }

  // ---- 5. Simulate Coupon ----

  async simulateCoupon(dto: SimulateCouponDto): Promise<SimulateCouponResult> {
    // If organizationId provided, do full org-specific validation
    if (dto.organizationId) {
      const validationResult = await this.couponService.validateCoupon(
        dto.couponCode,
        dto.organizationId,
        SYSTEM_USER_ID,
        dto.planCode,
        dto.billingPeriod,
      );

      return {
        couponCode: dto.couponCode,
        valid: validationResult.valid,
        errors: validationResult.errors,
        couponId: validationResult.coupon?.id ?? null,
        couponName: validationResult.coupon?.name ?? null,
        discountType: validationResult.coupon?.discountType ?? null,
        discountValue: validationResult.coupon?.discountValue ?? null,
        discountPreview: (validationResult.discountPreview ?? null) as SimulateCouponResult['discountPreview'],
      };
    }

    // Fallback: code-only validation (no org context)
    const coupon = await this.couponService.findByCode(dto.couponCode);

    if (!coupon) {
      return {
        couponCode: dto.couponCode,
        valid: false,
        errors: ['Coupon code not found'],
        couponId: null,
        couponName: null,
        discountType: null,
        discountValue: null,
        discountPreview: null,
      };
    }

    const discountResult = await this.couponService.calculateDiscount(
      coupon,
      dto.planCode,
      dto.billingPeriod,
    );

    return {
      couponCode: dto.couponCode,
      valid: true,
      errors: [],
      couponId: coupon.id,
      couponName: coupon.name,
      discountType: coupon.discountType as CouponDiscountType,
      discountValue: coupon.discountValue,
      discountPreview: {
        originalAmount: discountResult.originalAmount,
        discountAmount: discountResult.discountAmount,
        finalAmount: discountResult.finalAmount,
        discountType: coupon.discountType as CouponDiscountType,
        discountValue: coupon.discountValue,
        currency: coupon.currency,
      },
    };
  }

  // ---- 6. Simulate Promotion ----

  async simulatePromotion(dto: SimulatePromotionDto): Promise<SimulatePromotionResult> {
    const result = await this.promotionRuleEngine.evaluatePromotion(
      dto.promotionId,
      dto.organizationId,
      SYSTEM_USER_ID,
      dto.planCode,
      dto.billingPeriod,
    );

    return {
      promotionId: dto.promotionId,
      eligible: result.eligible,
      errors: result.errors,
      ruleResults: result.ruleResults,
      discountPreview: (result.discountPreview ?? null) as SimulatePromotionResult['discountPreview'],
    };
  }

  // ---- 7. Simulate Revenue Impact ----

  async simulateRevenueImpact(
    dto: SimulateRevenueImpactDto,
  ): Promise<SimulateRevenueImpactResult> {
    // Validate: exactly one of couponId or promotionId
    if (!dto.couponId && !dto.promotionId) {
      throw new BadRequestException(
        'Exactly one of couponId or promotionId is required',
      );
    }
    if (dto.couponId && dto.promotionId) {
      throw new BadRequestException(
        'Provide only one of couponId or promotionId, not both',
      );
    }

    if (dto.couponId) {
      return this.simulateCouponRevenueImpact(dto.couponId, dto.plans);
    }

    return this.simulatePromotionRevenueImpact(dto.promotionId!, dto.plans);
  }

  // ---- Private Helpers ----

  private async simulateCouponRevenueImpact(
    couponId: string,
    plans: Array<{ planCode: string; billingPeriod: string }>,
  ): Promise<SimulateRevenueImpactResult> {
    const coupon = await this.prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) {
      throw new BadRequestException(`Coupon with ID ${couponId} not found`);
    }

    const planBreakdowns: RevenueImpactPlanBreakdown[] = [];

    for (const plan of plans) {
      const resolved = await this.pricingEngine.resolvePlanPrice(plan.planCode, plan.billingPeriod);
      const baseAmount = resolved.amount;

      const discountResult = await this.couponService.calculateDiscount(
        coupon as Parameters<typeof this.couponService.calculateDiscount>[0],
        plan.planCode,
        plan.billingPeriod,
      );

      planBreakdowns.push({
        planCode: plan.planCode,
        billingPeriod: plan.billingPeriod,
        basePriceAmount: baseAmount,
        discountAmount: discountResult.discountAmount,
        finalAmount: discountResult.finalAmount,
        discountPercentage: baseAmount > 0
          ? Math.round((discountResult.discountAmount / baseAmount) * 10000) / 100
          : 0,
        currency: resolved.currency,
      });
    }

    return this.buildRevenueImpactResult(
      'coupon',
      couponId,
      coupon.name,
      planBreakdowns,
    );
  }

  private async simulatePromotionRevenueImpact(
    promotionId: string,
    plans: Array<{ planCode: string; billingPeriod: string }>,
  ): Promise<SimulateRevenueImpactResult> {
    const promotion = await this.prisma.promotion.findUnique({
      where: { id: promotionId },
      include: { benefits: true },
    });
    if (!promotion) {
      throw new BadRequestException(`Promotion with ID ${promotionId} not found`);
    }

    const planBreakdowns: RevenueImpactPlanBreakdown[] = [];

    for (const plan of plans) {
      const resolved = await this.pricingEngine.resolvePlanPrice(plan.planCode, plan.billingPeriod);
      const baseAmount = resolved.amount;

      const discountPreview = await this.promotionRuleEngine.calculateDiscountPreview(
        promotion.benefits,
        plan.planCode,
        plan.billingPeriod,
      );

      const discountAmount = discountPreview?.discountAmount ?? 0;
      const finalAmount = baseAmount - discountAmount;

      planBreakdowns.push({
        planCode: plan.planCode,
        billingPeriod: plan.billingPeriod,
        basePriceAmount: baseAmount,
        discountAmount,
        finalAmount: Math.max(0, finalAmount),
        discountPercentage: baseAmount > 0
          ? Math.round((discountAmount / baseAmount) * 10000) / 100
          : 0,
        currency: resolved.currency,
      });
    }

    return this.buildRevenueImpactResult(
      'promotion',
      promotionId,
      promotion.name,
      planBreakdowns,
    );
  }

  private buildRevenueImpactResult(
    sourceType: 'coupon' | 'promotion',
    sourceId: string,
    sourceName: string,
    plans: RevenueImpactPlanBreakdown[],
  ): SimulateRevenueImpactResult {
    const totalBaseRevenue = plans.reduce((sum, p) => sum + p.basePriceAmount, 0);
    const totalDiscountedRevenue = plans.reduce((sum, p) => sum + p.finalAmount, 0);
    const totalDiscountAmount = totalBaseRevenue - totalDiscountedRevenue;
    const averageDiscountPercentage = totalBaseRevenue > 0
      ? Math.round((totalDiscountAmount / totalBaseRevenue) * 10000) / 100
      : 0;

    return {
      sourceType,
      sourceId,
      sourceName,
      plans,
      totalBaseRevenue,
      totalDiscountedRevenue,
      totalDiscountAmount,
      averageDiscountPercentage,
      currency: plans[0]?.currency ?? 'PHP',
      simulatedAt: new Date().toISOString(),
    };
  }

  private parseState(value: string): SubscriptionState {
    const normalized = value.toLowerCase();
    const found = Object.values(SubscriptionState).find((s) => s === normalized);
    if (!found) {
      throw new BadRequestException(
        `Invalid state "${value}". Valid states: ${Object.values(SubscriptionState).join(', ')}`,
      );
    }
    return found;
  }

  private parseAction(value: string): SubscriptionAction {
    const normalized = value.toUpperCase();
    const found = Object.values(SubscriptionAction).find((a) => a === normalized);
    if (!found) {
      throw new BadRequestException(
        `Invalid action "${value}". Valid actions: ${Object.values(SubscriptionAction).join(', ')}`,
      );
    }
    return found;
  }
}
