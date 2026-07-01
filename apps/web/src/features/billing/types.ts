// ─── Billing Feature Types ──────────────────────────────────

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

// ─── Subscription Status Helpers ───────────────────────────

/**
 * Statuses where the subscription still grants access to paid features.
 * With Xendit-native recurring billing a failed cycle moves the sub to
 * `past_due` then `grace_period` — the user keeps access (and the plan card
 * keeps rendering) while Xendit auto-retries, so these count as "has access".
 */
export function subscriptionHasAccess(status: string | undefined | null): boolean {
  return status === 'active' || status === 'past_due' || status === 'grace_period';
}

/**
 * Statuses inside the failed-payment dunning window (Xendit is auto-retrying).
 * Drives the dunning banner and the "update payment method" nudge.
 */
export function subscriptionIsPastDue(status: string | undefined | null): boolean {
  return status === 'past_due' || status === 'grace_period';
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
  isFeatured: boolean;
  featuredLabel: string | null;
  ctaText: string | null;
  highlightColor: string | null;
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

/** Convert a PlanDetail from the API into the legacy PlanInfo shape for fallback rendering */
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
      .filter((e) => e.description)
      .map((e) => e.description as string),
    highlight: plan.isFeatured,
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
  return `₱${(centavos / 100).toLocaleString('en-PH')}`;
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
      return `₱${((benefit.discountValue ?? 0) / 100).toLocaleString()} off`;
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
      'Bookmarks, annotations, highlights',
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

// ─── Admin Plan Management Types ─────────────────────────

export type PlanType = 'standard' | 'trial' | 'complimentary' | 'custom';
export type PlanCategory = 'individual' | 'team' | 'academic' | 'enterprise';
export type BillingInterval = 'monthly' | 'annual' | 'quarterly' | 'one_time';
export type EntitlementValueType = 'numeric' | 'boolean' | 'unlimited';

/** Extended plan detail returned from admin endpoints (includes admin-only fields) */
export interface AdminPlanDetail extends PlanDetail {
  gracePeriodDays: number;
  autoRenewRequired: boolean;
  adminOnlyAssignment: boolean;
  inviteOnly: boolean;
  eligibleSegments: string[];
  internalNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPlanListResponse {
  success: boolean;
  data: AdminPlanDetail[];
}

export interface AdminPlanResponse {
  success: boolean;
  data: AdminPlanDetail;
}

export interface CreatePlanInput {
  code: string;
  name: string;
  displayName?: string;
  description?: string;
  type: PlanType;
  category?: PlanCategory;
  isActive?: boolean;
  isVisible?: boolean;
  displayOrder?: number;
  trialEnabled?: boolean;
  trialDurationDays?: number;
  gracePeriodDays?: number;
  autoRenewRequired?: boolean;
  adminOnlyAssignment?: boolean;
  inviteOnly?: boolean;
  eligibleSegments?: string[];
  maxSeats?: number;
  internalNotes?: string;
  isFeatured?: boolean;
  featuredLabel?: string;
  ctaText?: string;
  highlightColor?: string;
}

export type UpdatePlanInput = Partial<CreatePlanInput>;

export interface CreatePlanPriceInput {
  billingInterval: BillingInterval;
  amount: number; // centavos
  currency?: string;
}

export interface UpdatePlanPriceInput {
  amount?: number;
  isActive?: boolean;
}

export interface CreatePlanEntitlementInput {
  key: string;
  valueType: EntitlementValueType;
  numericValue?: number;
  booleanValue?: boolean;
  description?: string;
}

export type UpdatePlanEntitlementInput = Partial<CreatePlanEntitlementInput>;

export interface PlanPriceResponse {
  success: boolean;
  data: PlanPriceDetail;
}

export interface PlanEntitlementResponse {
  success: boolean;
  data: PlanEntitlementDetail;
}

export interface PlanComparisonResult {
  from: { code: string; name: string };
  to: { code: string; name: string };
  entitlements: {
    key: string;
    fromValue: string | number | boolean | null;
    toValue: string | number | boolean | null;
    change: 'added' | 'removed' | 'upgraded' | 'downgraded' | 'unchanged';
  }[];
}

export interface PlanComparisonResponse {
  success: boolean;
  data: PlanComparisonResult;
}

// ─── Admin Coupon Management Types ───────────────────────

export type CouponDiscountType = 'percentage' | 'fixed_amount' | 'bonus_credit' | 'trial_extension';
export type CouponRedemptionStatus = 'reserved' | 'redeemed' | 'rolled_back' | 'expired';
export type CouponPlanRuleType = 'include' | 'exclude';

export interface AdminCouponDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  internalNotes: string | null;
  discountType: CouponDiscountType;
  discountValue: number;
  currency: string;
  appliesToBillingPeriod: string;
  maxRedemptions: number | null;
  maxRedemptionsPerOrg: number;
  currentRedemptions: number;
  startsAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  isArchived: boolean;
  minimumPlanTier: string | null;
  bonusEntitlementKey: string | null;
  bonusEntitlementValue: number | null;
  bonusDurationDays: number | null;
  trialExtensionDays: number | null;
  metadataJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  planRules?: CouponPlanRule[];
  userAssignments?: CouponAssignment[];
  orgAssignments?: CouponAssignment[];
}

export interface CouponPlanRule {
  id: string;
  planCode: string;
  ruleType: CouponPlanRuleType;
}

export interface CouponAssignment {
  id: string;
  entityId: string;
  createdAt: string;
}

export interface AdminCouponListResponse {
  success: boolean;
  data: AdminCouponDetail[];
  nextCursor: string | null;
  hasNext: boolean;
}

export interface AdminCouponResponse {
  success: boolean;
  data: AdminCouponDetail;
}

export interface CouponRedemptionDetail {
  id: string;
  couponId: string;
  organizationId: string;
  userId: string;
  subscriptionId: string | null;
  paymentId: string | null;
  status: CouponRedemptionStatus;
  discountAmountApplied: number | null;
  originalAmount: number | null;
  reservedAt: string;
  redeemedAt: string | null;
  rolledBackAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface CouponRedemptionListResponse {
  success: boolean;
  data: CouponRedemptionDetail[];
  nextCursor: string | null;
  hasNext: boolean;
}

export interface CreateCouponInput {
  code: string;
  name: string;
  description?: string;
  internalNotes?: string;
  discountType: CouponDiscountType;
  discountValue: number;
  currency?: string;
  appliesToBillingPeriod?: 'any' | 'monthly' | 'annual';
  maxRedemptions?: number;
  maxRedemptionsPerOrg?: number;
  startsAt?: string;
  expiresAt?: string;
  minimumPlanTier?: string;
  bonusEntitlementKey?: string;
  bonusEntitlementValue?: number;
  bonusDurationDays?: number;
  trialExtensionDays?: number;
  isActive?: boolean;
  metadataJson?: Record<string, unknown>;
}

export interface UpdateCouponInput {
  name?: string;
  description?: string;
  internalNotes?: string;
  appliesToBillingPeriod?: 'any' | 'monthly' | 'annual';
  maxRedemptions?: number;
  maxRedemptionsPerOrg?: number;
  startsAt?: string;
  expiresAt?: string;
  minimumPlanTier?: string;
  bonusEntitlementKey?: string;
  bonusEntitlementValue?: number;
  bonusDurationDays?: number;
  trialExtensionDays?: number;
  isActive?: boolean;
  metadataJson?: Record<string, unknown>;
}

export interface ListCouponsQuery {
  cursor?: string;
  limit?: number;
  search?: string;
  discountType?: CouponDiscountType;
  isActive?: boolean;
  isArchived?: boolean;
  sortBy?: 'createdAt' | 'code' | 'currentRedemptions' | 'expiresAt';
  sortDir?: 'asc' | 'desc';
}

export interface ListRedemptionsQuery {
  cursor?: string;
  limit?: number;
  status?: CouponRedemptionStatus;
  organizationId?: string;
}

export interface SetCouponPlanRuleInput {
  planCode: string;
  ruleType: CouponPlanRuleType;
}

// ─── Admin Promotion Management Types ────────────────────

export type PromotionTypeValue = 'sale' | 'bonus' | 'trial_extension' | 'combined';
export type PromotionStatusValue =
  | 'draft'
  | 'scheduled'
  | 'active'
  | 'paused'
  | 'expired'
  | 'archived';
export type PromotionBenefitTypeValue =
  | 'percentage_discount'
  | 'fixed_discount'
  | 'bonus_credit'
  | 'trial_extension';
export type PromotionRuleTypeValue =
  | 'date_range'
  | 'organization_type'
  | 'subscription_status'
  | 'redemption_limit'
  | 'new_subscriber'
  | 'billing_period'
  | 'minimum_tier'
  | 'stacking';
export type PromotionPlanRuleTypeValue = 'include' | 'exclude';

export interface AdminPromotionDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  internalNotes: string | null;
  promotionType: PromotionTypeValue;
  status: PromotionStatusValue;
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  maxRedemptionsPerOrg: number;
  currentRedemptions: number;
  isStackableWithCoupons: boolean;
  isStackableWithPromos: boolean;
  isDisplayedOnPricing: boolean;
  metadataJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  rules?: PromotionRuleDetail[];
  benefits?: AdminPromotionBenefitDetail[];
  planRules?: PromotionPlanRuleDetail[];
  // stats from findByIdWithStats
  stats?: {
    totalRedemptions: number;
    appliedCount: number;
    revokedCount: number;
  };
}

export interface PromotionRuleDetail {
  id: string;
  ruleType: PromotionRuleTypeValue;
  configuration: Record<string, unknown>;
  ordering: number;
  isActive: boolean;
}

export interface AdminPromotionBenefitDetail {
  id: string;
  benefitType: PromotionBenefitTypeValue;
  discountValue: number | null;
  bonusEntitlementKey: string | null;
  bonusEntitlementValue: number | null;
  bonusDurationDays: number | null;
  trialExtensionDays: number | null;
  appliesToBillingPeriod: string;
}

export interface PromotionPlanRuleDetail {
  id: string;
  planCode: string;
  ruleType: PromotionPlanRuleTypeValue;
}

export interface AdminPromotionListResponse {
  success: boolean;
  data: AdminPromotionDetail[];
  nextCursor: string | null;
  hasNext: boolean;
}

export interface AdminPromotionResponse {
  success: boolean;
  data: AdminPromotionDetail;
}

export interface PromotionRedemptionDetail {
  id: string;
  promotionId: string;
  organizationId: string;
  userId: string;
  subscriptionId: string | null;
  paymentId: string | null;
  status: string;
  discountAmountApplied: number | null;
  originalAmount: number | null;
  benefitsAppliedJson: Record<string, unknown>;
  revokedAt: string | null;
  revokeReason: string | null;
  createdAt: string;
}

export interface PromotionRedemptionListResponse {
  success: boolean;
  data: PromotionRedemptionDetail[];
  nextCursor: string | null;
  hasNext: boolean;
}

export interface CreatePromotionInput {
  name: string;
  slug: string;
  promotionType: PromotionTypeValue;
  description?: string;
  internalNotes?: string;
  status?: 'draft' | 'scheduled' | 'active';
  priority?: number;
  startsAt?: string;
  endsAt?: string;
  maxRedemptions?: number;
  maxRedemptionsPerOrg?: number;
  isStackableWithCoupons?: boolean;
  isStackableWithPromos?: boolean;
  isDisplayedOnPricing?: boolean;
  metadataJson?: Record<string, unknown>;
  rules?: CreatePromotionRuleInput[];
  benefits?: CreatePromotionBenefitInput[];
}

export interface UpdatePromotionInput {
  name?: string;
  description?: string;
  internalNotes?: string;
  priority?: number;
  startsAt?: string;
  endsAt?: string;
  maxRedemptions?: number;
  maxRedemptionsPerOrg?: number;
  isStackableWithCoupons?: boolean;
  isStackableWithPromos?: boolean;
  isDisplayedOnPricing?: boolean;
  status?: 'draft' | 'scheduled' | 'active' | 'paused';
  metadataJson?: Record<string, unknown>;
}

export interface CreatePromotionRuleInput {
  ruleType: PromotionRuleTypeValue;
  configuration: Record<string, unknown>;
  ordering?: number;
  isActive?: boolean;
}

export interface CreatePromotionBenefitInput {
  benefitType: PromotionBenefitTypeValue;
  discountValue?: number;
  bonusEntitlementKey?: string;
  bonusEntitlementValue?: number;
  bonusDurationDays?: number;
  trialExtensionDays?: number;
  appliesToBillingPeriod?: 'any' | 'monthly' | 'annual';
}

export interface SetPromotionPlanRuleInput {
  planCode: string;
  ruleType: PromotionPlanRuleTypeValue;
}

export interface ListPromotionsQuery {
  cursor?: string;
  limit?: number;
  search?: string;
  status?: PromotionStatusValue;
  promotionType?: PromotionTypeValue;
  isDisplayedOnPricing?: boolean;
  sortBy?: 'createdAt' | 'name' | 'priority' | 'currentRedemptions' | 'startsAt' | 'endsAt';
  sortDir?: 'asc' | 'desc';
}

export interface ListPromotionRedemptionsQuery {
  cursor?: string;
  limit?: number;
  status?: 'applied' | 'revoked';
  organizationId?: string;
}

export interface RevokeRedemptionInput {
  reason: string;
}

// ─── Simulator Types ────────────────────────────────────

export interface SimulateTransitionInput {
  currentState: string;
  action: string;
  planCode?: string;
  actorType?: string;
}

export interface SimulateTransitionResult {
  valid: boolean;
  fromState: string;
  action: string;
  toState: string | null;
  hasAccess: boolean;
  sideEffects: { type: string; description: string }[];
  validActionsFromNewState: string[];
  error: string | null;
}

export interface SimulateLifecycleInput {
  startingState: string;
  actions: string[];
}

export interface LifecycleStep {
  step: number;
  action: string;
  fromState: string;
  toState: string | null;
  valid: boolean;
  hasAccess: boolean;
  sideEffects: { type: string; description: string }[];
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

export interface SimulatePricingInput {
  organizationId: string;
  planCode: string;
  billingPeriod: 'monthly' | 'annual';
  couponCode?: string;
  promotionId?: string;
}

export interface SimulatePricingResult {
  baseAmount: number;
  discountAmount: number;
  finalAmount: number;
  currency: string;
  lineItems: { type: string; label: string; amount: number }[];
  simulatedAt: string;
}

export interface SimulateProrationInput {
  currentPlanCode: string;
  newPlanCode: string;
  billingPeriod: 'monthly' | 'annual';
  periodStart: string;
  periodEnd: string;
  effectiveDate?: string;
}

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

export interface SimulateCouponInput {
  couponCode: string;
  planCode: string;
  billingPeriod: 'monthly' | 'annual';
  organizationId?: string;
}

export interface SimulateCouponResult {
  couponCode: string;
  valid: boolean;
  errors: string[];
  couponId: string | null;
  couponName: string | null;
  discountType: string | null;
  discountValue: number | null;
  discountPreview: { originalAmount: number; discountAmount: number; finalAmount: number; currency: string } | null;
}

export interface SimulatePromotionInput {
  promotionId: string;
  organizationId: string;
  planCode: string;
  billingPeriod: 'monthly' | 'annual';
}

export interface SimulatePromotionResult {
  promotionId: string;
  eligible: boolean;
  errors: string[];
  ruleResults: { ruleType: string; passed: boolean; reason?: string }[];
  discountPreview: { originalAmount: number; discountAmount: number; finalAmount: number; currency: string } | null;
}

export interface RevenueImpactPlanBreakdown {
  planCode: string;
  billingPeriod: string;
  basePriceAmount: number;
  discountAmount: number;
  finalAmount: number;
  discountPercentage: number;
  currency: string;
}

export interface SimulateRevenueImpactInput {
  couponId?: string;
  promotionId?: string;
  plans: { planCode: string; billingPeriod: 'monthly' | 'annual' }[];
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

export interface SimulatorResponse<T> {
  success: boolean;
  data: T;
}

// ─── Admin Subscription Management Types ─────────────────

export type SubscriptionStatusValue =
  | 'provisioning'
  | 'trialing'
  | 'trial_expired'
  | 'active'
  | 'past_due'
  | 'grace_period'
  | 'suspended'
  | 'cancelling'
  | 'cancelled'
  | 'expired'
  | 'complimentary'
  | 'migrating'
  | 'terminated';

export interface AdminSubscriptionListItem {
  id: string;
  organizationId: string;
  planCode: string;
  planId: string | null;
  status: SubscriptionStatusValue;
  billingPeriod: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  seats: number;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  trialStart: string | null;
  trialEnd: string | null;
  createdAt: string;
  updatedAt: string;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  plan: {
    id: string;
    name: string;
    code: string;
  } | null;
}

export interface AdminSubscriptionListResponse {
  success: boolean;
  data: AdminSubscriptionListItem[];
  nextCursor: string | null;
  hasNext: boolean;
}

export interface SubscriptionHistoryEntry {
  id: string;
  subscriptionId: string;
  organizationId: string;
  action: string;
  fromState: string;
  toState: string;
  fromPlanCode: string | null;
  toPlanCode: string | null;
  reason: string | null;
  actorUserId: string | null;
  actorType: string;
  metadataJson: Record<string, unknown>;
  createdAt: string;
}

export interface SubscriptionHistoryListResponse {
  success: boolean;
  data: SubscriptionHistoryEntry[];
  nextCursor: string | null;
  hasNext: boolean;
}

export interface TrialRecordEntry {
  id: string;
  organizationId: string;
  subscriptionId: string;
  planCode: string;
  trialStartedAt: string;
  trialEndsAt: string;
  trialDurationDays: number;
  convertedAt: string | null;
  convertedToPlanCode: string | null;
  expiredAt: string | null;
  cancelledAt: string | null;
  status: string;
  createdAt: string;
}

export interface ComplimentaryAccessEntry {
  id: string;
  organizationId: string;
  subscriptionId: string;
  planCode: string;
  grantedByUserId: string;
  reason: string;
  startsAt: string;
  endsAt: string | null;
  revokedAt: string | null;
  revokedByUserId: string | null;
  revokeReason: string | null;
  status: string;
  createdAt: string;
}

export interface SubscriptionMigrationEntry {
  id: string;
  organizationId: string;
  fromSubscriptionId: string;
  toSubscriptionId: string;
  fromPlanCode: string;
  toPlanCode: string;
  direction: string;
  fromBillingPeriod: string | null;
  toBillingPeriod: string | null;
  proratedCreditAmount: number;
  proratedChargeAmount: number;
  netAmount: number;
  currency: string;
  effectiveAt: string;
  status: string;
  initiatedByUserId: string | null;
  metadataJson: Record<string, unknown>;
  createdAt: string;
}

export interface SubscriptionMigrationListResponse {
  success: boolean;
  data: SubscriptionMigrationEntry[];
  nextCursor: string | null;
  hasNext: boolean;
}

export interface LifecycleEventEntry {
  id: string;
  subscriptionId: string;
  organizationId: string;
  eventType: string;
  status: string;
  scheduledAt: string;
  processedAt: string | null;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
}

export interface AdminSubscriptionDetail extends AdminSubscriptionListItem {
  history: SubscriptionHistoryEntry[];
  trialRecords: TrialRecordEntry[];
  complimentaryAccess: ComplimentaryAccessEntry[];
  migrationsFrom: SubscriptionMigrationEntry[];
  migrationsTo: SubscriptionMigrationEntry[];
  lifecycleEvents: LifecycleEventEntry[];
  validActions: string[];
}

export interface AdminSubscriptionDetailResponse {
  success: boolean;
  data: AdminSubscriptionDetail;
}

export interface EntitlementOverrideEntry {
  id: string;
  organizationId: string;
  entitlementKey: string;
  overrideType: string;
  numericValue: number | null;
  booleanValue: boolean | null;
  reason: string;
  sourceType: string;
  sourceId: string | null;
  startsAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

export interface EntitlementOverrideListResponse {
  success: boolean;
  data: EntitlementOverrideEntry[];
  nextCursor: string | null;
  hasNext: boolean;
}

// ─── Admin Subscription Query Params ─────────────────────

export interface ListSubscriptionsQuery {
  status?: SubscriptionStatusValue;
  planCode?: string;
  organizationId?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface ListSubscriptionHistoryQuery {
  action?: string;
  actorType?: string;
  limit?: number;
  cursor?: string;
}

export interface ListSubscriptionMigrationsQuery {
  limit?: number;
  cursor?: string;
}

export interface ListEntitlementOverridesQuery {
  organizationId: string;
  cursor?: string;
  limit?: number;
}

// ─── Admin Subscription Action Inputs ────────────────────

export interface ForceCancelInput {
  reason: string;
}

export interface ExtendTrialInput {
  extensionDays: number;
}

export interface ChangeBillingPeriodInput {
  billingPeriod: 'monthly' | 'annual';
}

export interface GrantComplimentaryInput {
  organizationId: string;
  planCode: string;
  reason: string;
  endsAt?: string;
}

export interface RevokeComplimentaryInput {
  reason: string;
}

export interface GrantEntitlementOverrideInput {
  organizationId: string;
  entitlementKey: string;
  overrideType: 'bonus_credit' | 'admin_override' | 'promo';
  numericValue?: number;
  booleanValue?: boolean;
  reason: string;
  sourceType: 'admin' | 'coupon' | 'promotion' | 'system';
  sourceId?: string;
  startsAt: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface RevokeEntitlementOverrideInput {
  reason: string;
}

// ─── Admin Lifecycle Events Types ────────────────────────

export interface AdminLifecycleEventListItem extends LifecycleEventEntry {
  subscription: {
    id: string;
    planCode: string;
    status: string;
    organization: {
      id: string;
      name: string;
    };
  };
}

export interface AdminLifecycleEventListResponse {
  success: boolean;
  data: AdminLifecycleEventListItem[];
  nextCursor: string | null;
  hasNext: boolean;
}

export interface LifecycleEventStatsData {
  statusCounts: Record<string, number>;
  eventTypeCounts: Record<string, number>;
  pendingDueCount: number;
}

export interface LifecycleEventStatsResponse {
  success: boolean;
  data: LifecycleEventStatsData;
}

export interface ListLifecycleEventsQuery {
  status?: string;
  eventType?: string;
  subscriptionId?: string;
  limit?: number;
  cursor?: string;
}

export interface BulkRetryResult {
  count: number;
}
