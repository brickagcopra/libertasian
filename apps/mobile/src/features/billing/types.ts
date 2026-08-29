// ─── Mobile Billing Feature Types ────────────────────────────
// Ported from web billing types — user-facing types only.
// Admin/Simulator types remain web-only.
//
// This module deliberately holds NO plan catalogue: no tier names, no
// display labels, no prices, no plan-card helpers. App Review 2.1(b) reads a
// named tier in the UI as an offer to purchase, and the app sells nothing.
// The tier ordering the gate needs lives privately in
// `hooks/use-subscription.ts` so it cannot be imported into a screen.

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
  /**
   * Whether this account is limited to the free corpus — the server's own
   * `resolveEffectiveEntitlements().previewOnly`, the same value the API gates
   * documents and search on.
   *
   * Optional because a shipped build can outlive the API version that added it:
   * store rollouts are gradual and builds live on devices for months, so a
   * client cannot assume the field is there. See `surfacesFromQuotas` for what
   * happens when it is absent.
   */
  previewOnly?: boolean;
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
