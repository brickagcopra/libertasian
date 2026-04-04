// =====================================================================
// Billing & Payment Types
// =====================================================================

import type { SubscriptionTier, SubscriptionStatus } from './auth';

// -----------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------

export enum PaymentMethodType {
  CARD = 'card',
  GCASH = 'gcash',
  MAYA = 'maya',
}

export enum PaymentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

export enum PaymentType {
  SUBSCRIPTION = 'subscription',
  UPGRADE = 'upgrade',
  ONE_TIME = 'one_time',
}

export enum InvoiceStatus {
  DRAFT = 'draft',
  OPEN = 'open',
  PAID = 'paid',
  VOID = 'void',
}

export enum BillingPeriod {
  MONTHLY = 'monthly',
  ANNUAL = 'annual',
}

// -----------------------------------------------------------------------
// Payment Methods
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Payments
// -----------------------------------------------------------------------

export interface PaymentDetail {
  id: string;
  amount: number;
  currency: string;
  status: string;
  paymentType: string;
  description: string | null;
  paidAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  createdAt: string;
}

// -----------------------------------------------------------------------
// Invoices
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Checkout & Subscription
// -----------------------------------------------------------------------

export interface CheckoutResponse {
  checkoutUrl: string;
  checkoutSessionId: string;
  paymentId: string;
}

export interface BillingPlanInfo {
  code: SubscriptionTier | string;
  name: string;
  monthlyPriceCentavos: number;
  annualPriceCentavos: number;
  features: string[];
}

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

// -----------------------------------------------------------------------
// Subscription Lifecycle
// -----------------------------------------------------------------------

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

export interface SubscriptionMigrationDetail {
  id: string;
  organizationId: string;
  fromSubscriptionId: string;
  toSubscriptionId: string;
  fromPlanCode: string;
  toPlanCode: string;
  direction: 'upgrade' | 'downgrade';
  fromBillingPeriod: string | null;
  toBillingPeriod: string | null;
  proratedCreditAmount: number;
  proratedChargeAmount: number;
  netAmount: number;
  currency: string;
  effectiveAt: string;
  status: string;
  paymentId: string | null;
  initiatedByUserId: string | null;
  createdAt: string;
}

export interface TrialRecordDetail {
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
}

export interface ComplimentaryAccessDetail {
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
}

// -----------------------------------------------------------------------
// Pending Invites
// -----------------------------------------------------------------------

export interface PendingInviteDetail {
  id: string;
  email: string;
  role: string;
  invitedBy: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

// -----------------------------------------------------------------------
// Entitlement Overrides
// -----------------------------------------------------------------------

export enum EntitlementOverrideType {
  BONUS_CREDIT = 'bonus_credit',
  ADMIN_OVERRIDE = 'admin_override',
  PROMO = 'promo',
}

export enum EntitlementSourceType {
  ADMIN = 'admin',
  COUPON = 'coupon',
  PROMOTION = 'promotion',
  SYSTEM = 'system',
}

export interface EntitlementOverrideDetail {
  id: string;
  organizationId: string;
  entitlementKey: string;
  overrideType: EntitlementOverrideType;
  numericValue: number | null;
  booleanValue: boolean | null;
  reason: string;
  sourceType: EntitlementSourceType;
  sourceId: string | null;
  startsAt: string;
  expiresAt: string | null;
  isActive: boolean;
  createdByUserId: string;
  revokedAt: string | null;
  revokedByUserId: string | null;
  revokeReason: string | null;
  metadataJson: Record<string, unknown>;
  createdAt: string;
}

export interface ActiveBonus {
  id: string;
  entitlementKey: string;
  overrideType: EntitlementOverrideType;
  numericValue: number | null;
  booleanValue: boolean | null;
  reason: string;
  sourceType: EntitlementSourceType;
  expiresAt: string | null;
}

export interface QuotaUsageItem {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
  baseLimit: number;
  bonusAmount: number;
}

export interface QuotaUsageSummary {
  quotas: Record<string, QuotaUsageItem>;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  activeBonuses: ActiveBonus[];
}

// -----------------------------------------------------------------------
// Coupon System
// -----------------------------------------------------------------------

export enum CouponDiscountType {
  PERCENTAGE = 'percentage',
  FIXED_AMOUNT = 'fixed_amount',
  BONUS_CREDIT = 'bonus_credit',
  TRIAL_EXTENSION = 'trial_extension',
}

export enum CouponRedemptionStatus {
  RESERVED = 'reserved',
  REDEEMED = 'redeemed',
  ROLLED_BACK = 'rolled_back',
  EXPIRED = 'expired',
}

export enum CouponPlanRuleType {
  INCLUDE = 'include',
  EXCLUDE = 'exclude',
}

export interface CouponDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
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

export interface DiscountPreview {
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  discountType: CouponDiscountType;
  discountValue: number;
  currency: string;
}

export interface CouponValidationResult {
  valid: boolean;
  coupon?: CouponDetail;
  errors: string[];
  discountPreview?: DiscountPreview;
}

// -----------------------------------------------------------------------
// Promotion System (auto-applied, rule-based campaigns)
// -----------------------------------------------------------------------

export enum PromotionType {
  SALE = 'sale',
  BONUS = 'bonus',
  TRIAL_EXTENSION = 'trial_extension',
  COMBINED = 'combined',
}

export enum PromotionStatus {
  DRAFT = 'draft',
  SCHEDULED = 'scheduled',
  ACTIVE = 'active',
  PAUSED = 'paused',
  EXPIRED = 'expired',
  ARCHIVED = 'archived',
}

export enum PromotionBenefitType {
  PERCENTAGE_DISCOUNT = 'percentage_discount',
  FIXED_DISCOUNT = 'fixed_discount',
  BONUS_CREDIT = 'bonus_credit',
  TRIAL_EXTENSION = 'trial_extension',
}

export enum PromotionRuleType {
  DATE_RANGE = 'date_range',
  ORGANIZATION_TYPE = 'organization_type',
  SUBSCRIPTION_STATUS = 'subscription_status',
  REDEMPTION_LIMIT = 'redemption_limit',
  NEW_SUBSCRIBER = 'new_subscriber',
  BILLING_PERIOD = 'billing_period',
  MINIMUM_TIER = 'minimum_tier',
  STACKING = 'stacking',
}

export interface PromotionDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  promotionType: PromotionType;
  status: PromotionStatus;
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  maxRedemptionsPerOrg: number;
  currentRedemptions: number;
  isStackableWithCoupons: boolean;
  isStackableWithPromos: boolean;
  isDisplayedOnPricing: boolean;
  benefits: PromotionBenefitDetail[];
  metadataJson: Record<string, unknown>;
  createdAt: string;
}

export interface PromotionBenefitDetail {
  id: string;
  benefitType: PromotionBenefitType;
  discountValue: number | null;
  bonusEntitlementKey: string | null;
  bonusEntitlementValue: number | null;
  bonusDurationDays: number | null;
  trialExtensionDays: number | null;
  appliesToBillingPeriod: string;
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

export interface PromotionRuleEvaluationResult {
  ruleType: string;
  passed: boolean;
  reason?: string;
}

export interface PromotionEligibilityResult {
  eligible: boolean;
  promotion?: PromotionDetail;
  ruleResults: PromotionRuleEvaluationResult[];
  errors: string[];
  discountPreview?: DiscountPreview;
}

export interface ActivePromotionForPricing {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  promotionType: PromotionType;
  benefits: PromotionBenefitDetail[];
  endsAt: string | null;
}

export interface PromotionRuleConfig {
  ruleType: PromotionRuleType;
  configuration: Record<string, unknown>;
}

// -----------------------------------------------------------------------
// Central Pricing Engine Types
// -----------------------------------------------------------------------

export interface ResolvedPlanPrice {
  /** Price amount in centavos */
  amount: number;
  /** Display name of the plan */
  planName: string;
  /** UUID of the Plan record (null if hardcoded) */
  planId: string | null;
  /** Currency code (e.g. 'PHP') */
  currency: string;
  /** Whether price came from DB or hardcoded fallback */
  source: 'database' | 'hardcoded';
}

export interface PriceLineItem {
  type: 'base_price' | 'coupon_discount' | 'promotion_discount';
  label: string;
  /** Amount in centavos (positive for charges, negative for discounts) */
  amount: number;
  /** Reference ID (couponId, promotionId, planId, etc.) */
  referenceId: string | null;
  /** Human-readable reference (coupon code, promotion slug, etc.) */
  referenceCode: string | null;
  metadata: Record<string, unknown>;
}

export interface PriceBreakdown {
  /** Base plan price in centavos before any discounts */
  basePriceAmount: number;
  /** Applied coupon ID (null if none) */
  couponId: string | null;
  /** Applied coupon code (null if none) */
  couponCode: string | null;
  /** Coupon discount amount in centavos */
  couponDiscountAmount: number;
  /** Applied promotion ID (null if none) */
  promotionId: string | null;
  /** Promotion discount amount in centavos */
  promotionDiscountAmount: number;
  /** Total discount = coupon + promotion (or max of the two if not stackable) */
  totalDiscountAmount: number;
  /** Final amount to charge = basePriceAmount - totalDiscountAmount */
  finalAmount: number;
  /** Currency code */
  currency: string;
  /** Plan code (e.g. 'pro') */
  planCode: string;
  /** Billing period */
  billingPeriod: string;
  /** Display name of the plan */
  planName: string;
  /** UUID of the Plan record (null if hardcoded) */
  planId: string | null;
  /** Whether coupon+promotion were stacked or only best-of applied */
  discountsStacked: boolean;
  /** Itemized line items for display and audit */
  lineItems: PriceLineItem[];
  /** When this breakdown was calculated */
  calculatedAt: string;
}

export interface CheckoutPreviewResponse extends PriceBreakdown {
  /** Current plan code (e.g. 'free' if no subscription) */
  currentPlanCode: string;
  /** Whether the target plan is an upgrade from current */
  isUpgrade: boolean;
  /** Whether the target plan is a downgrade from current */
  isDowngrade: boolean;
  /** Whether this is a new subscription (no existing paid plan) */
  isNewSubscription: boolean;
}
