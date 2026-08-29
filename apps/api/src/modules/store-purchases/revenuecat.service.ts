import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';

import type { WebhookVerification } from '../billing/payment-provider.interface';
import {
  type NormalizedStoreEvent,
  type StoreEntitlementSnapshot,
  type StoreEventType,
  type StorePeriodType,
  type StoreProviderSlug,
  type StorePurchaseProvider,
} from './store-purchase-provider.interface';

/** Conduit slug — the `:conduit` webhook path segment. NOT a store slug. */
export const REVENUECAT_CONDUIT_SLUG = 'revenuecat';

/**
 * RevenueCat event name → our conduit-neutral vocabulary.
 *
 * Everything absent from this map resolves to `informational` or `unknown`, and
 * both are acknowledged with a 200 and no state change. A conduit we do not
 * understand must never be able to move a subscription.
 */
const EVENT_TYPE_MAP: Record<string, StoreEventType> = {
  INITIAL_PURCHASE: 'purchase.initial',
  RENEWAL: 'purchase.renewed',
  CANCELLATION: 'purchase.cancelled',
  UNCANCELLATION: 'purchase.uncancelled',
  BILLING_ISSUE: 'purchase.billing_issue',
  EXPIRATION: 'purchase.expired',
  PRODUCT_CHANGE: 'purchase.product_changed',
  SUBSCRIPTION_PAUSED: 'purchase.paused',
  SUBSCRIPTION_EXTENDED: 'purchase.extended',
  TRANSFER: 'purchase.transferred',
  TEMPORARY_ENTITLEMENT_GRANT: 'purchase.temporary_grant',
  REFUND_REVERSED: 'purchase.refund_reversed',
  // §4.1 row 33 — persisted, logged, acknowledged, never acted on. We sell no
  // consumables and run no experiments, so any of these appearing in production
  // is a signal worth alerting on rather than a routine event.
  NON_RENEWING_PURCHASE: 'informational',
  INVOICE_ISSUANCE: 'informational',
  PURCHASE_REDEEMED: 'informational',
  PRICE_INCREASE_CONSENT_REQUESTED: 'informational',
  PRICE_INCREASE_CONSENT_RECEIVED: 'informational',
  EXPERIMENT_ENROLLMENT: 'informational',
  VIRTUAL_CURRENCY_TRANSACTION: 'informational',
  SUBSCRIBER_ALIAS: 'informational',
  TEST: 'informational',
};

/** RevenueCat's `store` field → the store slug we persist. */
const STORE_MAP: Record<string, StoreProviderSlug> = {
  APP_STORE: 'app_store',
  MAC_APP_STORE: 'app_store',
  PLAY_STORE: 'play_store',
};

const PERIOD_TYPES: readonly StorePeriodType[] = [
  'TRIAL',
  'INTRO',
  'NORMAL',
  'PROMOTIONAL',
  'PREPAID',
];

/** RevenueCat's REST API base. Overridable so tests never touch the network. */
const DEFAULT_API_URL = 'https://api.revenuecat.com';

/** The single outbound call has a hard ceiling — a slow conduit must not pin a request. */
const SNAPSHOT_TIMEOUT_MS = 10_000;

interface RevenueCatWebhookBody {
  event?: Record<string, unknown>;
  api_version?: string;
}

@Injectable()
export class RevenueCatService implements StorePurchaseProvider {
  readonly slug = REVENUECAT_CONDUIT_SLUG;

  private readonly logger = new Logger(RevenueCatService.name);
  private readonly webhookAuthToken: string;
  private readonly apiKey: string;
  private readonly apiUrl: string;

  constructor(private readonly config: ConfigService) {
    this.webhookAuthToken = this.config.get<string>('REVENUECAT_WEBHOOK_AUTH_TOKEN', '');
    this.apiKey = this.config.get<string>('REVENUECAT_API_KEY', '');
    this.apiUrl = this.config.get<string>('REVENUECAT_API_URL', DEFAULT_API_URL);
  }

  // ---- Inbound: authentication ----

  /**
   * RevenueCat authenticates with a value we configure in its dashboard and it
   * echoes back verbatim in the `Authorization` header. It is NOT an HMAC over
   * the raw body — there is no signature to recompute, which is why this method
   * takes only headers.
   *
   * An UNCONFIGURED token rejects every webhook rather than accepting every
   * webhook. There is deliberately no default value in the Joi schema that
   * would let an unauthenticated caller move a subscription: a missing secret
   * means the endpoint is closed, not open.
   */
  verifyWebhookAuthorization(headers: Record<string, string | undefined>): WebhookVerification {
    const presented = headers['authorization'] ?? headers['Authorization'];
    if (!presented) {
      return 'missing';
    }
    if (!this.webhookAuthToken) {
      this.logger.warn(
        'REVENUECAT_WEBHOOK_AUTH_TOKEN is not configured — rejecting every store webhook',
      );
      return 'invalid';
    }

    const presentedBuffer = Buffer.from(presented);
    const expectedBuffer = Buffer.from(this.webhookAuthToken);

    // Compare lengths first: timingSafeEqual throws on a length mismatch. The
    // length itself is not a secret.
    if (presentedBuffer.length !== expectedBuffer.length) {
      return 'invalid';
    }

    return timingSafeEqual(presentedBuffer, expectedBuffer) ? 'valid' : 'invalid';
  }

  // ---- Inbound: parsing ----

  /**
   * Translate a RevenueCat webhook body into our vocabulary.
   *
   * Everything downstream of this method is conduit-neutral: no other file in
   * the codebase may know a RevenueCat event-name string.
   */
  parseStoreEvent(rawBody: string): NormalizedStoreEvent {
    let parsed: RevenueCatWebhookBody;
    try {
      parsed = JSON.parse(rawBody) as RevenueCatWebhookBody;
    } catch {
      throw new Error('Malformed RevenueCat webhook body');
    }

    const event = parsed.event ?? {};
    const providerEventName = String(event['type'] ?? 'UNKNOWN').toUpperCase();
    const type = EVENT_TYPE_MAP[providerEventName] ?? 'unknown';

    const store = STORE_MAP[String(event['store'] ?? '').toUpperCase()] ?? null;
    const environment =
      String(event['environment'] ?? '').toUpperCase() === 'SANDBOX' ? 'sandbox' : 'production';

    const periodTypeRaw = String(event['period_type'] ?? '').toUpperCase();
    const periodType = (PERIOD_TYPES as readonly string[]).includes(periodTypeRaw)
      ? (periodTypeRaw as StorePeriodType)
      : null;

    const eventId = String(event['id'] ?? '');
    const appUserId = String(event['app_user_id'] ?? '');

    return {
      conduit: this.slug,
      eventId,
      providerEventName,
      type,
      store,
      environment,
      appUserId,
      aliases: toStringArray(event['aliases']),
      productId: optionalString(event['product_id']),
      entitlementIds: resolveEntitlementIds(event),
      periodType,
      transactionId: optionalString(event['transaction_id']),
      originalTransactionId: optionalString(event['original_transaction_id']),
      storeTransactionId: optionalString(event['store_transaction_id']),
      purchasedAt: toDate(event['purchased_at_ms']),
      expiresAt: toDate(event['expiration_at_ms']),
      cancelReason: upperOrNull(event['cancel_reason']),
      expirationReason: upperOrNull(event['expiration_reason']),
      transferredFrom: toStringArray(event['transferred_from']),
      transferredTo: toStringArray(event['transferred_to']),
      // PII-SAFE BY CONSTRUCTION: ids, slugs and statuses only. The App User ID
      // is an org uuid (D11), never an email, so there is no PII to redact here
      // — that is a second, independent payoff of that decision.
      auditMetadata: {
        rcEventId: eventId,
        providerEventName,
        store,
        environment,
        productId: optionalString(event['product_id']),
        periodType,
        cancelReason: upperOrNull(event['cancel_reason']),
        expirationReason: upperOrNull(event['expiration_reason']),
        rcOriginalTransactionId: optionalString(event['original_transaction_id']),
      },
    };
  }

  // ---- Outbound: the ONLY call we make (§9) ----

  /**
   * Pull the conduit's own view of a subscriber.
   *
   * This is the reconciliation primitive behind all three §9 uses (the
   * post-restore sync, the nightly drift job and the admin resync) and the
   * reason D12 has no `POST /store/restore` that accepts a client-asserted
   * receipt: a client-asserted entitlement is a client-forgeable entitlement.
   * The server's only input here is an org id it already knows.
   */
  async fetchSubscriberSnapshot(appUserId: string): Promise<StoreEntitlementSnapshot> {
    if (!this.apiKey) {
      throw new Error('REVENUECAT_API_KEY is not configured — cannot pull subscriber snapshot');
    }

    const url = `${this.apiUrl}/v1/subscribers/${encodeURIComponent(appUserId)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`RevenueCat subscriber fetch failed: ${response.status}`);
    }

    const body = (await response.json()) as {
      subscriber?: {
        entitlements?: Record<string, Record<string, unknown>>;
        subscriptions?: Record<string, Record<string, unknown>>;
      };
    };

    return this.toSnapshot(appUserId, body.subscriber ?? {});
  }

  private toSnapshot(
    appUserId: string,
    subscriber: {
      entitlements?: Record<string, Record<string, unknown>>;
      subscriptions?: Record<string, Record<string, unknown>>;
    },
  ): StoreEntitlementSnapshot {
    const entitlements = subscriber.entitlements ?? {};
    const subscriptions = subscriber.subscriptions ?? {};

    return {
      appUserId,
      entitlements: Object.entries(entitlements).map(([id, entitlement]) => {
        const productId = String(entitlement['product_identifier'] ?? '');
        const subscription = subscriptions[productId] ?? {};
        const isSandbox = subscription['is_sandbox'] === true;

        return {
          id,
          productId,
          store: STORE_MAP[String(subscription['store'] ?? '').toUpperCase()] ?? null,
          expiresAt: toIsoDate(entitlement['expires_date']),
          // An entitlement with no unsubscribe timestamp and no billing issue is
          // still auto-renewing. Both fields absent is the normal healthy case.
          willRenew:
            subscription['unsubscribe_detected_at'] == null &&
            subscription['billing_issues_detected_at'] == null,
          periodType: String(subscription['period_type'] ?? 'normal').toUpperCase(),
          environment: isSandbox ? 'sandbox' : 'production',
        };
      }),
    };
  }
}

// ---- Parsing helpers ----

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function upperOrNull(value: unknown): string | null {
  const str = optionalString(value);
  return str === null ? null : str.toUpperCase();
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Date(value);
}

function toIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `entitlement_ids` is the modern field; `entitlement_id` is the deprecated
 * singular RevenueCat still sends on some event types. Read both rather than
 * losing the entitlement on whichever shape arrives.
 */
function resolveEntitlementIds(event: Record<string, unknown>): string[] {
  const plural = toStringArray(event['entitlement_ids']);
  if (plural.length > 0) return plural;
  const singular = optionalString(event['entitlement_id']);
  return singular ? [singular] : [];
}
