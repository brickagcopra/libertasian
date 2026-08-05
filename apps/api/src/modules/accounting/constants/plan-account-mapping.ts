/**
 * Maps plan codes to their corresponding revenue and deferred revenue account codes
 * in the chart of accounts. Used by the accounting service to determine which accounts
 * to credit when recording subscription revenue.
 */

export interface PlanAccountMapping {
  revenueAccountCode: string;
  deferredRevenueAccountCode: string;
}

export const PLAN_ACCOUNT_MAP: Record<string, PlanAccountMapping> = {
  edu: {
    revenueAccountCode: '4010',
    deferredRevenueAccountCode: '2110',
  },
  pro: {
    revenueAccountCode: '4020',
    deferredRevenueAccountCode: '2120',
  },
  team: {
    revenueAccountCode: '4030',
    deferredRevenueAccountCode: '2130',
  },
  enterprise: {
    revenueAccountCode: '4040',
    deferredRevenueAccountCode: '2140',
  },
};

/** Payment gateway settlement account — where payments land */
export const XENDIT_SETTLEMENT_ACCOUNT = '1010';

/** Payment processing fee expense account */
export const PAYMENT_PROCESSING_FEE_ACCOUNT = '5050';

/** Refund contra-revenue account */
export const REFUND_ACCOUNT = '4910';

/** Coupon discount contra-revenue account */
export const COUPON_DISCOUNT_ACCOUNT = '4920';

/** Promotional discount contra-revenue account */
export const PROMO_DISCOUNT_ACCOUNT = '4930';

/** Operating bank account */
export const BANK_ACCOUNT = '1020';

/**
 * Resolve the revenue account code for a given plan code.
 * Defaults to Pro revenue account if plan code is unknown.
 */
export function getRevenueAccountCode(planCode: string): string {
  return PLAN_ACCOUNT_MAP[planCode]?.revenueAccountCode ?? '4020';
}

/**
 * Resolve the deferred revenue account code for a given plan code.
 * Defaults to Pro deferred revenue account if plan code is unknown.
 */
export function getDeferredRevenueAccountCode(planCode: string): string {
  return PLAN_ACCOUNT_MAP[planCode]?.deferredRevenueAccountCode ?? '2120';
}
