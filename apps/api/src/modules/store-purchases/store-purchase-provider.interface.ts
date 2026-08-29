/**
 * Store-purchase (IAP) port — a PARALLEL port to `PaymentProvider`, not a third
 * adapter behind it. See docs/architecture/iap-entitlements-design.md D1.
 *
 * Two independent reasons this is not a `PaymentProvider`:
 *
 * *Shape.* IAP can implement two of that port's ten methods. There is no hosted
 * checkout to create, no customer to create (the store owns it), no instrument
 * to attach, no invoice to issue — and, decisively, no server-side cancel or
 * refund, because the stores do not let a server do either. Eight
 * `NotImplementedException`s and a fake customer object is not an
 * implementation of a port; it is a port being lied to.
 *
 * *Binding.* `PAYMENT_PROVIDER` is bound by a factory that picks EXACTLY ONE
 * adapter from an env var — an exclusive-or. IAP is not an alternative to
 * Xendit; it runs ALONGSIDE it, at the same time, for different subscribers. A
 * token that resolves to one adapter cannot express that.
 *
 * The surface below is deliberately two-methods-in / one-method-out. A reviewer
 * who spots a "missing" `cancel` or `refund` is spotting something the stores
 * genuinely do not permit, not an omission.
 */

import type { WebhookVerification } from '../billing/payment-provider.interface';

/** DI token for the configured store-purchase conduit adapter. */
export const STORE_PURCHASE_PROVIDER = Symbol('STORE_PURCHASE_PROVIDER');

/**
 * Canonical STORE slugs, written to `subscriptions.provider`.
 *
 * These name the STORE, not the conduit: refunds, restores and the entitlement
 * itself belong to Apple/Google. RevenueCat is swappable; the store of record
 * is not. Both fit the existing `varchar(20)`, which has no CHECK constraint —
 * so no DDL was needed to make them legal.
 */
export const STORE_PROVIDERS = ['app_store', 'play_store'] as const;
export type StoreProviderSlug = (typeof STORE_PROVIDERS)[number];

export function isStoreProviderSlug(value: string | null | undefined): value is StoreProviderSlug {
  return (STORE_PROVIDERS as readonly string[]).includes(value ?? '');
}

/** Internal, conduit-neutral event vocabulary. */
export type StoreEventType =
  | 'purchase.initial'
  | 'purchase.renewed'
  | 'purchase.cancelled' // auto-renew off; access continues
  | 'purchase.uncancelled'
  | 'purchase.billing_issue'
  | 'purchase.expired' // definitive; revoke
  | 'purchase.refunded'
  | 'purchase.refund_reversed'
  | 'purchase.product_changed'
  | 'purchase.paused'
  | 'purchase.extended'
  | 'purchase.transferred'
  | 'purchase.temporary_grant'
  | 'informational' // TEST, EXPERIMENT_ENROLLMENT, … ack and log
  | 'unknown';

export type StorePeriodType = 'TRIAL' | 'INTRO' | 'NORMAL' | 'PROMOTIONAL' | 'PREPAID';

export interface NormalizedStoreEvent {
  /** Conduit slug for the webhook path segment (`revenuecat`). */
  conduit: string;
  /** The conduit's own event id — the durable idempotency key. */
  eventId: string;
  /** The conduit's own event name (`INITIAL_PURCHASE`), kept verbatim for audit. */
  providerEventName: string;
  type: StoreEventType;
  store: StoreProviderSlug | null;
  environment: 'production' | 'sandbox';
  /** RevenueCat App User ID — our `organizationId`. See D11. */
  appUserId: string;
  aliases: string[];
  productId: string | null;
  entitlementIds: string[];
  periodType: StorePeriodType | null;
  transactionId: string | null;
  originalTransactionId: string | null;
  storeTransactionId: string | null;
  purchasedAt: Date | null;
  expiresAt: Date | null;
  /** CANCELLATION only. Drives the §4 branch. */
  cancelReason: string | null;
  /** EXPIRATION only. */
  expirationReason: string | null;
  /** TRANSFER only — the App User IDs losing and gaining the entitlement. */
  transferredFrom: string[];
  transferredTo: string[];
  /** PII-safe audit metadata. */
  auditMetadata: Record<string, unknown>;
}

/** A pull-side snapshot, used by restore and by the reconciliation job (§9). */
export interface StoreEntitlementSnapshot {
  appUserId: string;
  entitlements: {
    id: string;
    productId: string;
    store: StoreProviderSlug | null;
    expiresAt: Date | null;
    willRenew: boolean;
    periodType: string;
    /** SANDBOX entitlements must never grant production access (D10). */
    environment: 'production' | 'sandbox';
  }[];
}

export interface StorePurchaseProvider {
  /** Conduit slug, used in the webhook path. */
  readonly slug: string;

  /**
   * Authenticate an inbound webhook.
   *
   * NOT an HMAC over the body: RevenueCat authenticates with a configured
   * `Authorization` header value, which is why this method is named for
   * authorization rather than for a signature. It reuses the three-valued
   * `WebhookVerification` from `payment-provider.interface.ts` — that type is a
   * genuine shared concept, and importing it is not the same as implementing
   * the port.
   */
  verifyWebhookAuthorization(headers: Record<string, string | undefined>): WebhookVerification;

  parseStoreEvent(rawBody: string): NormalizedStoreEvent;

  /** The ONLY outbound call. See §9. */
  fetchSubscriberSnapshot(appUserId: string): Promise<StoreEntitlementSnapshot>;
}
