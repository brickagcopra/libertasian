import { Injectable, Logger } from '@nestjs/common';

import { PricingEngineService } from '../pricing/pricing-engine.service';

// ---- Types ----

export interface ProrationResult {
  /** Credit for unused time on current plan (centavos) */
  creditAmount: number;
  /** Charge for new plan remainder (centavos) */
  chargeAmount: number;
  /** Net amount: chargeAmount - creditAmount (centavos, can be negative for downgrades) */
  netAmount: number;
  /** Currency code */
  currency: string;
  /** Days remaining in current billing period */
  daysRemaining: number;
  /** Total days in current billing period */
  totalDays: number;
  /** Current plan daily rate (centavos) */
  currentDailyRate: number;
  /** New plan daily rate (centavos) */
  newDailyRate: number;
}

export interface ProrationInput {
  organizationId: string;
  currentPlanCode: string;
  newPlanCode: string;
  billingPeriod: 'monthly' | 'annual';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  effectiveDate?: Date;
}

@Injectable()
export class ProrationService {
  private readonly logger = new Logger(ProrationService.name);

  constructor(
    private readonly pricingEngine: PricingEngineService,
  ) {}

  /**
   * Calculate prorated credit/charge amounts for a plan change mid-cycle.
   *
   * Formula:
   *   daysRemaining = ceil((periodEnd - effectiveDate) / msPerDay)
   *   totalDays     = ceil((periodEnd - periodStart) / msPerDay)
   *   credit        = floor(currentPlanPrice * daysRemaining / totalDays)
   *   charge        = floor(newPlanPrice * daysRemaining / totalDays)
   *   net           = charge - credit
   */
  async calculateProration(input: ProrationInput): Promise<ProrationResult> {
    const {
      organizationId,
      currentPlanCode,
      newPlanCode,
      billingPeriod,
      currentPeriodStart,
      currentPeriodEnd,
    } = input;

    const effectiveDate = input.effectiveDate ?? new Date();

    // Resolve prices via central pricing engine
    const currentResolved = await this.pricingEngine.resolvePlanPrice(currentPlanCode, billingPeriod, organizationId);
    const newResolved = await this.pricingEngine.resolvePlanPrice(newPlanCode, billingPeriod, organizationId);
    const currentPrice = currentResolved.amount;
    const newPrice = newResolved.amount;

    const msPerDay = 86_400_000;
    const totalDays = Math.max(
      1,
      Math.ceil((currentPeriodEnd.getTime() - currentPeriodStart.getTime()) / msPerDay),
    );
    const daysRemaining = Math.max(
      0,
      Math.ceil((currentPeriodEnd.getTime() - effectiveDate.getTime()) / msPerDay),
    );

    const currentDailyRate = Math.floor(currentPrice / totalDays);
    const newDailyRate = Math.floor(newPrice / totalDays);

    const creditAmount = Math.floor((currentPrice * daysRemaining) / totalDays);
    const chargeAmount = Math.floor((newPrice * daysRemaining) / totalDays);
    const netAmount = chargeAmount - creditAmount;

    this.logger.debug(
      `Proration: ${currentPlanCode}→${newPlanCode} (${billingPeriod}), ` +
        `${daysRemaining}/${totalDays} days, credit=${creditAmount}, charge=${chargeAmount}, net=${netAmount}`,
    );

    return {
      creditAmount,
      chargeAmount,
      netAmount,
      currency: 'PHP',
      daysRemaining,
      totalDays,
      currentDailyRate,
      newDailyRate,
    };
  }

}
