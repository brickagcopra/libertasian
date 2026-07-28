// ─── Mobile Billing Feature Types ────────────────────────────
// Ported from web billing types — user-facing types only.
// Admin/Simulator types remain web-only.

// ─── Subscription ──────────────────────────────────────────

export interface SubscriptionDetail {
  id: string;
  planCode: string;
  status: string;
  billingPeriod: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  seats: number;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  trialStart: string | null;
  trialEnd: string | null;
  createdAt: string;
}

export interface SubscriptionResponse {
  success: boolean;
  data: SubscriptionDetail;
}

// ─── Payment Methods ───────────────────────────────────────

export interface PaymentMethodDetail {
  id: string;
  type: string;
  brand: string | null;
  last4: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  billingEmail: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface PaymentMethodListResponse {
  success: boolean;
  data: PaymentMethodDetail[];
}

// ─── Invoices ──────────────────────────────────────────────

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitAmount: number;
  totalAmount: number;
}

export interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  status: string;
  description: string | null;
  lineItems: InvoiceLineItem[];
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  dueDate: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface InvoiceListResponse {
  success: boolean;
  data: InvoiceDetail[];
  meta: {
    cursor: string | null;
    hasNext: boolean;
  };
}

export interface InvoiceDetailResponse {
  success: boolean;
  data: InvoiceDetail;
}

// ─── Checkout ──────────────────────────────────────────────

export interface CheckoutResponse {
  success: boolean;
  data: {
    checkoutUrl: string;
    checkoutSessionId: string;
    paymentId: string;
  };
}

export interface CreateCheckoutInput {
  planCode: 'edu' | 'pro' | 'team' | 'enterprise';
  billingPeriod: 'monthly' | 'annual';
  successUrl: string;
  cancelUrl: string;
  couponCode?: string;
  promotionId?: string;
}

// ─── Checkout Preview ─────────────────────────────────────

export interface CheckoutPreviewInput {
  planCode: 'edu' | 'pro' | 'team' | 'enterprise';
  billingPeriod: 'monthly' | 'annual';
  couponCode?: string;
  promotionId?: string;
}

export interface PriceLineItem {
  type: 'base_price' | 'coupon_discount' | 'promotion_discount';
  label: string;
  amount: number;
  referenceId: string | null;
  referenceCode: string | null;
  metadata: Record<string, unknown>;
}

export interface CheckoutPreviewData {
  basePriceAmount: number;
  couponId: string | null;
  couponCode: string | null;
  couponDiscountAmount: number;
  promotionId: string | null;
  promotionDiscountAmount: number;
  totalDiscountAmount: number;
  finalAmount: number;
  currency: string;
  planCode: string;
  billingPeriod: string;
  planName: string;
  planId: string | null;
  discountsStacked: boolean;
  lineItems: PriceLineItem[];
  calculatedAt: string;
  currentPlanCode: string;
  isUpgrade: boolean;
  isDowngrade: boolean;
  isNewSubscription: boolean;
}

export interface CheckoutPreviewResponse {
  success: boolean;
  data: CheckoutPreviewData;
}

// ─── Coupon Validation ───────────────────────────────────

export interface ValidateCouponInput {
  code: string;
  planCode: string;
  billingPeriod: 'monthly' | 'annual';
}

export interface CouponValidationCoupon {
  id: string;
  code: string;
  name: string;
  discountType: 'percentage' | 'fixed_amount';
  discountValue: number;
  currency: string;
}

export interface CouponDiscountPreview {
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  discountType: 'percentage' | 'fixed_amount';
  discountValue: number;
  currency: string;
}

export interface CouponValidationResult {
  valid: boolean;
  coupon?: CouponValidationCoupon;
  errors: string[];
  discountPreview?: CouponDiscountPreview;
}

export interface ValidateCouponResponse {
  success: boolean;
  data: CouponValidationResult;
}

// ─── Eligible Promotions ─────────────────────────────────

export interface EligiblePromotionsInput {
  planCode: string;
  billingPeriod: 'monthly' | 'annual';
}

export interface PromotionRuleResult {
  ruleType: string;
  passed: boolean;
  reason?: string;
}

export interface PromotionEligibilityResult {
  eligible: boolean;
  promotionId: string;
  promotionName: string;
  promotionSlug: string;
  ruleResults: PromotionRuleResult[];
  errors: string[];
  discountPreview?: CouponDiscountPreview;
}

export interface EligiblePromotionsResponse {
  success: boolean;
  data: PromotionEligibilityResult[];
}

// ─── Cancel ────────────────────────────────────────────────

export interface CancelSubscriptionInput {
  cancelAtPeriodEnd?: boolean;
}

// ─── Dynamic Plan API Types ───────────────────────────────

export interface PlanPriceDetail {
  id: string;
  billingInterval: 'monthly' | 'annual' | 'quarterly' | 'one_time';
  amount: number; // in centavos
  currency: string;
  isActive: boolean;
}

export interface PlanEntitlementDetail {
  id: string;
  key: string;
  valueType: 'numeric' | 'boolean' | 'unlimited';
  numericValue: number | null;
  booleanValue: boolean | null;
  description: string | null;
}

export interface PlanDetail {
  id: string;
  code: string;
  name: string;
  displayName: string;
  description: string | null;
  type: string;
  category: string;
  isActive: boolean;
  isVisible: boolean;
  displayOrder: number;
  trialEnabled: boolean;
  trialDurationDays: number;
  defaultSeats: number;
  maxSeats: number | null;
  prices: PlanPriceDetail[];
  entitlements: PlanEntitlementDetail[];
}

export interface PlansListResponse {
  success: boolean;
  data: PlanDetail[];
}

// ─── Active Promotions (Pricing Display) ──────────────────

export interface PromotionBenefitDetail {
  id: string;
  benefitType: 'percentage_discount' | 'fixed_discount' | 'bonus_credit' | 'trial_extension';
  discountValue: number | null;
  bonusEntitlementKey: string | null;
  bonusEntitlementValue: number | null;
  bonusDurationDays: number | null;
  trialExtensionDays: number | null;
  appliesToBillingPeriod: string;
}

export interface ActivePromotionForPricing {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  promotionType: 'sale' | 'bonus' | 'trial_extension' | 'combined';
  benefits: PromotionBenefitDetail[];
  endsAt: string | null;
}

export interface ActivePromotionsResponse {
  success: boolean;
  data: ActivePromotionForPricing[];
}

// ─── Plan Info (Legacy Hardcoded Fallback) ────────────────

export interface PlanInfo {
  code: string;
  name: string;
  monthlyPrice: number;
  annualPrice: number;
  features: string[];
  highlight?: boolean;
}

// ─── Plan Helpers ─────────────────────────────────────────

/**
 * Entitlement keys that describe a restriction rather than a benefit and must
 * never render as a plan-card bullet with a check next to it.
 * `previewOnly` is the free tier's public-corpus cap.
 */
const NON_BENEFIT_ENTITLEMENT_KEYS = new Set(['previewOnly']);

/**
 * True when an entitlement should appear as a plan-card bullet.
 *
 * Mirrors the web pricing card filter: a bullet is a *benefit*, so drop the
 * zero-valued numerics ("0 active matters") and the false booleans ("team
 * collaboration" on Free) that the comparison table renders as "—", plus the
 * restriction-shaped keys above. Without this, Free listed 14 features it
 * does not have, each with a green checkmark.
 */
export function isPlanCardBullet(entitlement: PlanEntitlementDetail): boolean {
  if (!entitlement.description) return false;
  if (NON_BENEFIT_ENTITLEMENT_KEYS.has(entitlement.key)) return false;
  if (entitlement.valueType === 'numeric' && entitlement.numericValue === 0) {
    return false;
  }
  if (entitlement.valueType === 'boolean' && entitlement.booleanValue === false) {
    return false;
  }
  return true;
}

/** Convert a PlanDetail from the API into the legacy PlanInfo shape */
export function planDetailToPlanInfo(plan: PlanDetail): PlanInfo {
  const monthlyPrice = plan.prices.find(
    (p) => p.billingInterval === 'monthly' && p.isActive,
  );
  const annualPrice = plan.prices.find(
    (p) => p.billingInterval === 'annual' && p.isActive,
  );

  return {
    code: plan.code,
    name: plan.displayName || plan.name,
    monthlyPrice: monthlyPrice ? monthlyPrice.amount / 100 : 0,
    annualPrice: annualPrice ? annualPrice.amount / 100 : 0,
    features: plan.entitlements
      .filter(isPlanCardBullet)
      .map((e) => e.description as string),
    highlight: plan.code === 'pro',
  };
}

/** Get price in centavos for a given billing interval */
export function getPlanPrice(
  plan: PlanDetail,
  interval: 'monthly' | 'annual',
): number {
  const price = plan.prices.find(
    (p) => p.billingInterval === interval && p.isActive,
  );
  return price?.amount ?? 0;
}

/** Format centavos amount to PHP display string */
export function formatPHP(centavos: number): string {
  if (centavos === 0) return 'Free';
  return `\u20B1${(centavos / 100).toLocaleString('en-PH')}`;
}

/** Get the best promotion discount label for a plan */
export function getPromotionDiscountLabel(
  promotion: ActivePromotionForPricing,
  billingPeriod: 'monthly' | 'annual',
): string | null {
  const benefit = promotion.benefits.find(
    (b) =>
      b.appliesToBillingPeriod === billingPeriod ||
      b.appliesToBillingPeriod === 'all',
  );
  if (!benefit) return null;

  switch (benefit.benefitType) {
    case 'percentage_discount':
      return `${benefit.discountValue}% off`;
    case 'fixed_discount':
      return `\u20B1${((benefit.discountValue ?? 0) / 100).toLocaleString()} off`;
    case 'trial_extension':
      return `+${benefit.trialExtensionDays} day trial`;
    case 'bonus_credit':
      return `+${benefit.bonusEntitlementValue} bonus credits`;
    default:
      return null;
  }
}

// ─── Quota / Usage ────────────────────────────────────────

export interface QuotaUsageItem {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
  baseLimit: number;
  bonusAmount: number;
}

export interface ActiveBonus {
  id: string;
  entitlementKey: string;
  overrideType: string;
  numericValue: number | null;
  booleanValue: boolean | null;
  reason: string;
  sourceType: string;
  expiresAt: string | null;
}

export interface QuotaUsageData {
  quotas: Record<string, QuotaUsageItem>;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  activeBonuses: ActiveBonus[];
}

export interface QuotaUsageResponse {
  success: boolean;
  data: QuotaUsageData;
}

// ─── Quota Display Helpers ───────────────────────────────

/** Human-readable label for an entitlement key */
export const ENTITLEMENT_LABELS: Record<string, string> = {
  ai_answers_per_month: 'AI Answers',
  search_queries_per_month: 'Search Queries',
  camera_scans_per_month: 'Camera Scans',
  digest_generations_per_month: 'Digest Generations',
  file_uploads_per_month: 'File Uploads',
  matters_per_organization: 'Active Matters',
  storage_gb: 'Storage (GB)',
  team_members_allowed: 'Team Members',
  flashcard_sets_per_month: 'Flashcard Sets',
  memo_generations_per_month: 'Memo Generations',
};

/** Returns a display-friendly percentage (0-100), clamped */
export function quotaPercent(item: QuotaUsageItem): number {
  if (item.limit <= 0) return 0;
  return Math.min(100, Math.round((item.used / item.limit) * 100));
}

/** Returns true if usage is at or above 80% of the limit */
export function isNearLimit(item: QuotaUsageItem): boolean {
  if (item.limit <= 0) return false;
  return item.used / item.limit >= 0.8;
}

/** Returns true if the quota is unlimited (limit === -1 or very large) */
export function isUnlimited(item: QuotaUsageItem): boolean {
  return item.limit < 0 || item.limit >= 999999;
}

/**
 * LEGACY FALLBACK — Used only when `usePlans()` API call fails or DB plans
 * feature flag is disabled. Prices in pesos (matching backend PLAN_PRICING
 * centavo values / 100). Prefer API-driven plans via `GET /plans`.
 */
export const PLANS: PlanInfo[] = [
  {
    code: 'free',
    name: 'Free',
    monthlyPrice: 0,
    annualPrice: 0,
    features: [
      'Browse public legal corpus',
      '15 AI answer credits',
      'Limited search queries',
      'OCR preview (no saved digests)',
    ],
  },
  {
    code: 'edu',
    name: 'Edu',
    monthlyPrice: 299,
    annualPrice: 2990,
    features: [
      'Unlimited search',
      'AI answers (ALAC/IRAC/bar modes)',
      'Codal reader with offline access',
      'Reviewer packs & digest library',
      'Flashcard generation',
      'Camera scan digests (10/month)',
      'Bookmarks, annotations, highlights',
      'Offline mobile reading',
      'Study progress tracking',
    ],
  },
  {
    code: 'pro',
    name: 'Pro',
    monthlyPrice: 999,
    annualPrice: 9990,
    highlight: true,
    features: [
      'Everything in Edu',
      'Unlimited AI answers & digests',
      'Unlimited camera scan digests',
      'Memo drafting assistance',
      'Case comparison',
      'Pleading assistance (10/month)',
      'Timeline generations (20/month)',
      '3 research workspaces',
      'Up to 20 active matters',
      'Document uploads',
    ],
  },
  {
    code: 'team',
    name: 'Team',
    monthlyPrice: 2499,
    annualPrice: 24990,
    features: [
      'Everything in Pro (per seat)',
      'Unlimited matters',
      'Team-shared workspace',
      'Collaboration & activity feed',
      'Role-based access control',
      'Task management & calendar',
      'Audit logs',
      'Client-safe workspaces',
    ],
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    monthlyPrice: 4999,
    annualPrice: 49990,
    features: [
      'Everything in Team',
      'Editorial ingestion tools',
      'Publish to shared corpus',
      'Corpus health monitoring',
      'API access (up to 10 keys)',
      'Dedicated support',
      'Custom integrations',
    ],
  },
];

export const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  edu: 'Edu',
  pro: 'Pro',
  team: 'Team',
  enterprise: 'Enterprise',
};

export const TIER_ORDER = ['free', 'edu', 'pro', 'team', 'enterprise'];
