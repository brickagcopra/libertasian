import { createHmac, timingSafeEqual } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  PaymentProviderError,
  type CreateCustomerParams,
  type CreateInvoiceParams,
  type CreateSubscriptionSessionParams,
  type NormalizedWebhookEvent,
  type PaymentProvider,
  type ProviderCustomer,
  type ProviderInvoice,
  type ProviderSubscription,
  type ProviderPaymentMethodAttachment,
  type ProviderSubscriptionSession,
  type RefundEventData,
  type SubscriptionEventData,
  type WebhookVerification,
} from './payment-provider.interface';

/**
 * PayMongo adapter for the `PaymentProvider` port.
 *
 * EVERY PayMongo-specific detail — endpoint paths, the `{data:{attributes}}`
 * envelope, centavo amounts, event name strings, the `Paymongo-Signature` HMAC
 * scheme — lives in this file. Callers see only the neutral DTOs from
 * `payment-provider.interface.ts`. The wire types below are intentionally NOT
 * exported.
 *
 * UNIT BOUNDARY: PayMongo speaks CENTAVOS everywhere; the port speaks WHOLE
 * PESOS. Every amount crossing this file is converted — `toCentavos` on the way
 * out, `toMajorUnits` on the way in. Nothing outside this file should ever see
 * a centavo figure from PayMongo.
 */

/** Canonical slug for this adapter — persisted on billing rows, used in webhook paths. */
export const PAYMONGO_PROVIDER_SLUG = 'paymongo';

/**
 * Error thrown for non-2xx PayMongo responses. Carries the HTTP status and the
 * first `errors[].code` from the response body so callers can branch on
 * specific failures instead of treating every PayMongo error as a 500.
 *
 * Extends the port's `PaymentProviderError` so callers branch on the neutral
 * type, never on this one.
 */
export class PaymongoApiError extends PaymentProviderError {
  constructor(status: number, errorCode: string | null) {
    super(PAYMONGO_PROVIDER_SLUG, status, errorCode);
    this.name = 'PaymongoApiError';
    this.message = `PayMongo API error: ${status}`;
  }
}

// ---- Wire types (private to this file) ----

/** Every PayMongo resource is `{ id, type, attributes }`. */
interface PaymongoResource<A> {
  id: string;
  type?: string;
  attributes: A;
}

/** Single-resource response envelope. */
interface PaymongoEnvelope<A> {
  data: PaymongoResource<A>;
}

/** List response envelope. */
interface PaymongoListEnvelope<A> {
  data?: PaymongoResource<A>[];
  has_more?: boolean;
}

interface PaymongoPlanAttributes {
  name: string;
  description?: string;
  /** CENTAVOS. */
  amount: number;
  currency: string;
  interval: string;
  interval_count: number;
  [key: string]: unknown;
}

interface PaymongoSubscriptionAttributes {
  customer_id?: string;
  plan_id?: string;
  status?: string;
  /** CENTAVOS, when the surface inlines the plan amount. */
  amount?: number;
  currency?: string;
  /**
   * Present on the attach response when the instrument needs a further
   * customer step (3DS). `next_action_url` is where the customer must go.
   */
  setup_intent?: { next_action_url?: string | null; [key: string]: unknown };
  [key: string]: unknown;
}

interface PaymongoCustomerAttributes {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  default_device?: string;
  [key: string]: unknown;
}

interface PaymongoCheckoutSessionAttributes {
  checkout_url: string;
  reference_number?: string;
  status?: string;
  description?: string;
  line_items?: { name: string; amount: number; currency: string; quantity: number }[];
  payment_method_types?: string[];
  metadata?: Record<string, string>;
  [key: string]: unknown;
}

/** Webhook envelope: `{ data: { id: 'evt_…', attributes: { type, livemode, data, created_at } } }`. */
interface PaymongoWebhookEnvelope {
  data?: {
    id?: string;
    attributes?: {
      type?: string;
      livemode?: boolean;
      created_at?: number;
      /** The resource the event concerns — itself a `{ id, type, attributes }` object. */
      data?: PaymongoResource<Record<string, unknown>>;
      [key: string]: unknown;
    };
  };
  [key: string]: unknown;
}

/**
 * Exact webhook event-name strings, taken verbatim from PayMongo's documented
 * webhook events enum. Centralised so a single edit reconciles every consumer
 * (mirrors `XENDIT_RECURRING_EVENTS`).
 *
 * PENDING VENDOR CONFIRMATION: an open PayMongo support ticket asks them to
 * confirm this list is complete for subscriptions. A correction lands as a
 * follow-up commit.
 */
export const PAYMONGO_EVENTS = {
  SUBSCRIPTION_INVOICE_PAID: 'subscription.invoice.paid',
  SUBSCRIPTION_INVOICE_PAYMENT_FAILED: 'subscription.invoice.payment_failed',
  SUBSCRIPTION_INVOICE_CREATED: 'subscription.invoice.created',
  SUBSCRIPTION_INVOICE_FINALIZED: 'subscription.invoice.finalized',
  SUBSCRIPTION_UPDATED: 'subscription.updated',
  SUBSCRIPTION_UNPAID: 'subscription.unpaid',
  SUBSCRIPTION_PAST_DUE: 'subscription.past_due',
  CHECKOUT_SESSION_PAYMENT_PAID: 'checkout_session.payment.paid',
  PAYMENT_PAID: 'payment.paid',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',
  PAYMENT_REFUND_UPDATED: 'payment.refund.updated',
} as const;

/**
 * `subscription.updated` statuses we act on.
 *
 * NOTE: PayMongo emits NO `subscription.activated` event. Activation is DERIVED
 * from `subscription.updated` carrying `attributes.status === 'active'`. Do not
 * go looking for an activation event in their enum — it does not exist.
 */
const PAYMONGO_SUBSCRIPTION_ACTIVE_STATUS = 'active';
const PAYMONGO_SUBSCRIPTION_CANCELLED_STATUSES = ['cancelled', 'incomplete_cancelled'];

/** Refund status that counts as a success on `payment.refund.updated`. */
const PAYMONGO_REFUND_SUCCEEDED_STATUS = 'succeeded';

/** Port interval → PayMongo `interval`. PayMongo also supports `weekly`; the port does not. */
const PAYMONGO_INTERVALS: Record<CreateSubscriptionSessionParams['interval'], string> = {
  MONTH: 'monthly',
  YEAR: 'yearly',
};

/** PayMongo caps `interval_count` at 10. */
const MAX_INTERVAL_COUNT = 10;

/** Default instruments offered on a one-off checkout session. */
const DEFAULT_PAYMENT_METHOD_TYPES = ['card', 'gcash', 'paymaya', 'grab_pay'];

@Injectable()
export class PaymongoService implements PaymentProvider {
  readonly slug = PAYMONGO_PROVIDER_SLUG;

  private readonly logger = new Logger(PaymongoService.name);
  private readonly baseUrl = 'https://api.paymongo.com';
  private readonly secretKey: string;
  private readonly webhookSecret: string;
  private readonly signatureToleranceSec: number;
  private readonly paymentMethodTypes: string[];
  private readonly appUrl: string;

  /**
   * Memoised plan catalogue: `libertasian:{interval}:{count}:{centavos}` → plan id.
   * PayMongo plans are a REUSABLE catalogue, not per-subscriber objects, so the
   * same plan is shared by every subscriber on that price point.
   */
  private readonly planCache = new Map<string, string>();

  constructor(private readonly config: ConfigService) {
    this.secretKey = this.config.get<string>('PAYMONGO_SECRET_KEY', '');
    this.webhookSecret = this.config.get<string>('PAYMONGO_WEBHOOK_SECRET', '');
    this.signatureToleranceSec = Number(
      this.config.get<string | number>('PAYMONGO_SIGNATURE_TOLERANCE_SEC', 300),
    );
    this.paymentMethodTypes = this.config
      .get<string>('PAYMONGO_PAYMENT_METHOD_TYPES', DEFAULT_PAYMENT_METHOD_TYPES.join(','))
      .split(',')
      .map((type) => type.trim())
      .filter(Boolean);
    this.appUrl = this.config.get<string>('APP_URL', 'http://localhost:3000');
  }

  // ---- Unit conversion ----

  /** WHOLE PESOS (port) → CENTAVOS (PayMongo). */
  static toCentavos(amount: number): number {
    return Math.round(amount * 100);
  }

  /** CENTAVOS (PayMongo) → WHOLE PESOS (port). */
  static toMajorUnits(centavos: number): number {
    return centavos / 100;
  }

  // ---- Customers ----

  /**
   * Create a PayMongo Customer.
   *
   * PayMongo's customer object has NO `reference_id` / `metadata` field, so our
   * org id cannot be round-tripped through the gateway. Idempotency therefore
   * rides the LOCAL pointer (`Subscription.providerCustomerId`), which
   * BillingService reads back off the most recent row that has one.
   */
  async createCustomer(params: CreateCustomerParams): Promise<ProviderCustomer> {
    const { firstName, lastName } = PaymongoService.splitName(params.givenNames);
    const attributes: Record<string, unknown> = {
      first_name: firstName,
      last_name: lastName,
      default_device: 'email',
      ...(params.email && { email: params.email }),
      ...(params.mobileNumber && { phone: params.mobileNumber }),
    };

    const response = await this.request<PaymongoEnvelope<PaymongoCustomerAttributes>>(
      'POST',
      '/v1/customers',
      { data: { attributes } },
    );

    // Echo OUR reference back: PayMongo never stored it.
    return { id: response.data.id, referenceId: params.referenceId };
  }

  /**
   * Always null: PayMongo customers carry no `reference_id` or `metadata` field,
   * so there is nothing to query by. Idempotency for customer resolution rides
   * the local pointer (`Subscription.providerCustomerId`) instead of a
   * gateway-side lookup — see `createCustomer`.
   */
  async getCustomerByReferenceId(_referenceId: string): Promise<ProviderCustomer | null> {
    return null;
  }

  // ---- Plans (reusable catalogue) ----

  /**
   * Deterministic catalogue key for a price point. PayMongo plans are reusable
   * across subscribers, so we resolve-or-create exactly one plan per
   * (interval, count, amount) triple and share it.
   */
  static planKey(interval: string, intervalCount: number, centavos: number): string {
    return `libertasian:${interval}:${intervalCount}:${centavos}`;
  }

  /**
   * Resolve the plan for a price point, creating it on first use.
   * Order: in-process cache → `GET /v1/subscriptions/plans?limit=100` →
   * `POST /v1/subscriptions/plans`.
   */
  private async resolvePlanId(
    interval: string,
    intervalCount: number,
    centavos: number,
    currency: string,
    description: string,
  ): Promise<string> {
    const key = PaymongoService.planKey(interval, intervalCount, centavos);

    const cached = this.planCache.get(key);
    if (cached) return cached;

    const list = await this.request<PaymongoListEnvelope<PaymongoPlanAttributes>>(
      'GET',
      '/v1/subscriptions/plans?limit=100',
    );
    const existing = list.data?.find((plan) => plan.attributes?.name === key);
    if (existing) {
      this.planCache.set(key, existing.id);
      return existing.id;
    }

    const created = await this.request<PaymongoEnvelope<PaymongoPlanAttributes>>(
      'POST',
      '/v1/subscriptions/plans',
      {
        data: {
          attributes: {
            name: key,
            description,
            amount: centavos,
            currency,
            interval,
            interval_count: intervalCount,
          },
        },
      },
    );

    this.planCache.set(key, created.data.id);
    return created.data.id;
  }

  // ---- Subscriptions ----

  /**
   * Create a PayMongo Subscription (status `incomplete`) against the resolved
   * catalogue plan.
   *
   * PayMongo has NO hosted subscription checkout: a subscription becomes
   * chargeable only once a payment method is attached via
   * `PUT /v1/subscriptions/{id}/payment_method`. So the `checkoutUrl` we return
   * is OUR OWN authorize page, which collects the instrument and performs that
   * attach. (That page ships in a separate PR.)
   *
   * `providerSubscriptionId` is known immediately here — unlike Xendit, where
   * the recurring-plan id only arrives on activation. BillingService persists it
   * at checkout time, which is what lets `findSubscriptionForPlan` link later
   * webhooks back to the local row (PayMongo echoes no reference id).
   */
  async createSubscriptionSession(
    params: CreateSubscriptionSessionParams,
  ): Promise<ProviderSubscriptionSession> {
    if (params.intervalCount < 1 || params.intervalCount > MAX_INTERVAL_COUNT) {
      throw new Error(
        `PayMongo interval_count must be 1-${MAX_INTERVAL_COUNT}, got ${params.intervalCount}`,
      );
    }

    const interval = PAYMONGO_INTERVALS[params.interval];
    const centavos = PaymongoService.toCentavos(params.amount);
    const planId = await this.resolvePlanId(
      interval,
      params.intervalCount,
      centavos,
      params.currency,
      params.description,
    );

    const subscription = await this.request<PaymongoEnvelope<PaymongoSubscriptionAttributes>>(
      'POST',
      '/v1/subscriptions',
      { data: { attributes: { customer_id: params.customerId, plan_id: planId } } },
    );

    return {
      sessionId: subscription.data.id,
      checkoutUrl: this.authorizeUrl(params),
      referenceId: params.referenceId,
      status: subscription.data.attributes?.status,
      providerSubscriptionId: subscription.data.id,
    };
  }

  /**
   * Our own authorize page — PayMongo issues no hosted subscription checkout.
   * `ref` is the LOCAL Subscription id; the page resolves the PayMongo
   * subscription from the `providerSubscriptionId` persisted at checkout, so the
   * gateway id never travels in a user-visible URL.
   */
  private authorizeUrl(params: CreateSubscriptionSessionParams): string {
    const query = new URLSearchParams({
      ref: params.referenceId,
      success: params.successReturnUrl,
      cancel: params.cancelReturnUrl,
    });
    return `${this.appUrl}/billing/authorize?${query.toString()}`;
  }

  /** Retrieve a subscription by id. */
  async retrieveSubscription(id: string): Promise<ProviderSubscription> {
    const response = await this.request<PaymongoEnvelope<PaymongoSubscriptionAttributes>>(
      'GET',
      `/v1/subscriptions/${id}`,
    );
    return PaymongoService.toProviderSubscription(response.data);
  }

  /**
   * Cancel a subscription immediately. PayMongo requires a
   * `cancellation_reason`; we model cancel-at-period-end at our layer
   * (entitlements survive until currentPeriodEnd) so the gateway-side cancel is
   * always immediate and `other` is always the honest reason.
   */
  async cancelSubscription(id: string): Promise<ProviderSubscription> {
    const response = await this.request<PaymongoEnvelope<PaymongoSubscriptionAttributes>>(
      'POST',
      `/v1/subscriptions/${id}/cancel`,
      { data: { attributes: { cancellation_reason: 'other' } } },
    );
    return PaymongoService.toProviderSubscription(response.data);
  }

  /**
   * Attach a payment method to an `incomplete` subscription, making it
   * chargeable. PayMongo is the only gateway that needs this: it has no
   * hosted subscription checkout, so the subscription created at checkout
   * sits at `incomplete` until an instrument is attached here.
   *
   * `redirect_url` is where PayMongo returns the customer after any 3DS step.
   * When the instrument needs that step the response carries
   * `setup_intent.next_action_url` and the caller must send the customer
   * there; when it does not, the field is absent and we report null.
   */
  async attachSubscriptionPaymentMethod(
    providerSubscriptionId: string,
    paymentMethodId: string,
    redirectUrl: string,
  ): Promise<ProviderPaymentMethodAttachment> {
    const response = await this.request<PaymongoEnvelope<PaymongoSubscriptionAttributes>>(
      'PUT',
      `/v1/subscriptions/${providerSubscriptionId}/payment_method`,
      { data: { attributes: { payment_method_id: paymentMethodId, redirect_url: redirectUrl } } },
    );

    const attributes = response.data.attributes ?? {};
    return {
      status: attributes.status ?? '',
      // PENDING VENDOR CONFIRMATION: we do not yet know whether PayMongo
      // always issues a next action here, nor whether the first invoice
      // charges immediately or waits for the plan anchor. Both shapes are
      // handled by the caller — see BillingService.authorizeSubscription,
      // which keeps the subscription PROVISIONING and lets the webhooks
      // decide either way.
      nextActionUrl: attributes.setup_intent?.next_action_url ?? null,
    };
  }

  // ---- One-off invoices (Checkout Sessions) ----

  /**
   * Create a one-off hosted Checkout Session. PayMongo has no "invoice" object
   * on this surface, so the checkout session IS our invoice: its id is what
   * lands in `Payment.providerInvoiceId`.
   */
  async createInvoice(params: CreateInvoiceParams): Promise<ProviderInvoice> {
    const response = await this.request<PaymongoEnvelope<PaymongoCheckoutSessionAttributes>>(
      'POST',
      '/v2/checkout_sessions',
      {
        data: {
          attributes: {
            line_items: [
              {
                name: params.description,
                amount: PaymongoService.toCentavos(params.amount),
                currency: params.currency,
                quantity: 1,
              },
            ],
            payment_method_types: this.paymentMethodTypes,
            reference_number: params.externalId,
            success_url: params.successRedirectUrl,
            cancel_url: params.failureRedirectUrl,
            metadata: params.metadata,
          },
        },
      },
    );
    return PaymongoService.toProviderInvoice(response.data, params.externalId, params.description);
  }

  /** Retrieve a checkout session by id. */
  async retrieveInvoice(id: string): Promise<ProviderInvoice> {
    const response = await this.request<PaymongoEnvelope<PaymongoCheckoutSessionAttributes>>(
      'GET',
      `/v2/checkout_sessions/${id}`,
    );
    return PaymongoService.toProviderInvoice(response.data);
  }

  // ---- Webhooks ----

  /**
   * Verify the inbound webhook signature.
   *
   * PayMongo sends `Paymongo-Signature: t=<unix seconds>,te=<test hmac>,li=<live hmac>`.
   * The signed payload is `${t}.${rawBody}`, HMAC-SHA256 with the webhook
   * secret, hex-encoded. We prefer the live signature and fall back to the test
   * one, compare in constant time, and reject a timestamp outside the tolerance
   * window (replay defence).
   */
  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): WebhookVerification {
    const header = headers['paymongo-signature'];
    if (!header) {
      return 'missing';
    }
    if (!this.webhookSecret) {
      this.logger.warn('Webhook secret missing');
      return 'invalid';
    }

    const parts = PaymongoService.parseSignatureHeader(header);
    const timestamp = parts['t'];
    // Prefer the live signature; fall back to the test one. Present-but-empty
    // fields were dropped at the parse step, so this reaches the populated one
    // whichever mode the event came from.
    const provided = parts['li'] ?? parts['te'];
    if (!timestamp || !provided) {
      return 'invalid';
    }

    const timestampSec = Number(timestamp);
    if (!Number.isFinite(timestampSec)) {
      return 'invalid';
    }
    const skewSec = Math.abs(Date.now() / 1000 - timestampSec);
    if (skewSec > this.signatureToleranceSec) {
      this.logger.warn(`Webhook signature timestamp outside tolerance (${Math.round(skewSec)}s)`);
      return 'invalid';
    }

    const expected = createHmac('sha256', this.webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);
    if (providedBuffer.length !== expectedBuffer.length) {
      return 'invalid';
    }
    return timingSafeEqual(providedBuffer, expectedBuffer) ? 'valid' : 'invalid';
  }

  /** `t=…,te=…,li=…` → `{ t, te, li }`. Unknown keys are kept and ignored. */
  private static parseSignatureHeader(header: string): Record<string, string> {
    const parts: Record<string, string> = {};
    for (const segment of header.split(',')) {
      const separator = segment.indexOf('=');
      if (separator === -1) continue;
      const key = segment.slice(0, separator).trim();
      const value = segment.slice(separator + 1).trim();
      // Drop EMPTY values. PayMongo populates only the field matching the mode
      // of the event and sends the OTHER one present but empty (`li=` in test
      // mode, `te=` in live mode). Storing an empty string would make the
      // fallback in verifyWebhookSignature bind to it and reject every webhook
      // from that mode. The PayMongo Node SDK guards the same way, with
      // explicit non-empty checks on both fields.
      if (key && value) parts[key] = value;
    }
    return parts;
  }

  /**
   * Parse a raw webhook body and translate it into the internal vocabulary.
   *
   * The envelope is uniform: the event NAME is `data.attributes.type` and the
   * RESOURCE it concerns is `data.attributes.data` (itself `{id, attributes}`).
   *
   * Conventions applied to EVERY event, matching the Xendit recurring
   * convention so downstream Redis keys and audit rows stay predictable:
   *   - `idempotencyScope` = the event name verbatim
   *   - `auditSuffix`      = the event name with dots replaced by underscores
   *   - every amount divided by 100 (centavos → whole pesos) before it enters
   *     the port
   */
  parseWebhookEvent(rawBody: string): NormalizedWebhookEvent {
    const parsed = JSON.parse(rawBody) as PaymongoWebhookEnvelope;
    const eventName = parsed.data?.attributes?.type ?? '';
    const resource = parsed.data?.attributes?.data;
    const attributes = resource?.attributes ?? {};

    const base = {
      provider: this.slug,
      providerEventName: eventName,
      idempotencyScope: eventName,
      auditSuffix: eventName.replace(/\./g, '_'),
      entityId: resource?.id,
      auditMetadata: {
        event: eventName,
        status: attributes['status'] as string | undefined,
      },
    };

    switch (eventName) {
      // ---- Subscription invoice (cycle) lifecycle ----
      //
      // `subscription.invoice.paid` is the SINGLE AUTHORITATIVE cycle signal —
      // it owns the period advance and the Payment row. entityId is the INVOICE
      // id, which is what the cycle-id idempotency check dedups on.
      case PAYMONGO_EVENTS.SUBSCRIPTION_INVOICE_PAID:
        return {
          ...base,
          type: 'subscription.cycle.succeeded',
          data: PaymongoService.invoiceEventData(resource, attributes),
        };
      case PAYMONGO_EVENTS.SUBSCRIPTION_INVOICE_PAYMENT_FAILED:
        return {
          ...base,
          type: 'subscription.cycle.failed',
          data: PaymongoService.invoiceEventData(resource, attributes),
        };
      case PAYMONGO_EVENTS.SUBSCRIPTION_INVOICE_CREATED:
        return {
          ...base,
          type: 'subscription.cycle.created',
          data: PaymongoService.invoiceEventData(resource, attributes),
        };
      case PAYMONGO_EVENTS.SUBSCRIPTION_INVOICE_FINALIZED:
        // LOG-ONLY. The invoice exists but has not been charged yet; the
        // paid / payment_failed pair owns the outcome.
        return {
          ...base,
          type: 'unknown',
          data: PaymongoService.invoiceEventData(resource, attributes) as unknown as Record<
            string,
            unknown
          >,
        };

      // ---- Subscription object lifecycle ----
      //
      // PayMongo emits NO `subscription.activated` event. Activation is DERIVED
      // here from `subscription.updated` + status `active`. Nobody should go
      // looking for an activation event in their enum — it does not exist.
      case PAYMONGO_EVENTS.SUBSCRIPTION_UPDATED: {
        const data = PaymongoService.subscriptionEventData(resource, attributes);
        const status = (attributes['status'] as string | undefined) ?? '';
        if (status === PAYMONGO_SUBSCRIPTION_ACTIVE_STATUS) {
          return { ...base, type: 'subscription.activated', data };
        }
        if (PAYMONGO_SUBSCRIPTION_CANCELLED_STATUSES.includes(status)) {
          return { ...base, type: 'subscription.deactivated', data };
        }
        return { ...base, type: 'unknown', data: data as unknown as Record<string, unknown> };
      }
      case PAYMONGO_EVENTS.SUBSCRIPTION_UNPAID:
        return {
          ...base,
          type: 'subscription.deactivated',
          data: PaymongoService.subscriptionEventData(resource, attributes),
        };
      case PAYMONGO_EVENTS.SUBSCRIPTION_PAST_DUE:
        // LOG-ONLY ON PURPOSE. `subscription.invoice.payment_failed` already
        // owns dunning for the failed cycle; handling past_due as well would
        // double-count a single failed cycle.
        return {
          ...base,
          type: 'unknown',
          data: PaymongoService.subscriptionEventData(resource, attributes) as unknown as Record<
            string,
            unknown
          >,
        };

      // ---- One-off checkout ----
      //
      // entityId is the CHECKOUT SESSION id, which is what we persisted as
      // `Payment.providerInvoiceId` when the session was created.
      case PAYMONGO_EVENTS.CHECKOUT_SESSION_PAYMENT_PAID:
        return {
          ...base,
          type: 'payment.succeeded',
          data: {
            id: resource?.id ?? '',
            status: attributes['status'] as string | undefined,
          },
        };

      // ---- Raw payment events ----
      case PAYMONGO_EVENTS.PAYMENT_PAID:
        // LOG-ONLY — MUST NOT route into handleCycleSucceeded.
        //
        // `payment.paid` fires alongside `subscription.invoice.paid` for the
        // SAME charge but carries a DIFFERENT id (the payment id, not the
        // invoice id). The two ids never dedup against each other, so routing
        // this into the cycle handler would defeat the id-based idempotency
        // check and both record a SECOND Payment and advance currentPeriodEnd
        // TWICE. `subscription.invoice.paid` is the single authoritative cycle
        // signal.
        //
        // This is the exact trap already documented for Xendit's
        // `payment.captured` case in webhook.controller.ts — mapping here to
        // `payment.captured` reuses that controller branch, which is log-only.
        return {
          ...base,
          type: 'payment.captured',
          data: PaymongoService.subscriptionEventData(resource, attributes),
        };
      case PAYMONGO_EVENTS.PAYMENT_FAILED:
        return {
          ...base,
          type: 'payment.failed',
          data: {
            id: resource?.id ?? '',
            status: attributes['status'] as string | undefined,
            failureReason:
              (attributes['last_payment_error'] as string | undefined) ??
              (attributes['failed_message'] as string | undefined),
          },
        };

      // ---- Refunds ----
      case PAYMONGO_EVENTS.PAYMENT_REFUNDED:
        return {
          ...base,
          type: 'refund.succeeded',
          data: PaymongoService.refundEventData(resource, attributes),
        };
      case PAYMONGO_EVENTS.PAYMENT_REFUND_UPDATED: {
        const status = (attributes['status'] as string | undefined) ?? '';
        return {
          ...base,
          type:
            status === PAYMONGO_REFUND_SUCCEEDED_STATUS ? 'refund.succeeded' : 'refund.failed',
          data: PaymongoService.refundEventData(resource, attributes),
        };
      }

      default:
        return { ...base, type: 'unknown', data: attributes };
    }
  }

  /**
   * Subscription-invoice resource → neutral cycle payload. `id` is the INVOICE
   * id (the cycle identity); `planId` carries the PayMongo SUBSCRIPTION id,
   * which is what `Subscription.providerSubscriptionId` holds for this adapter.
   */
  private static invoiceEventData(
    resource: PaymongoResource<Record<string, unknown>> | undefined,
    attributes: Record<string, unknown>,
  ): SubscriptionEventData {
    const amount = attributes['amount'];
    return {
      id: resource?.id ?? '',
      planId: attributes['subscription_id'] as string | undefined,
      customerId: attributes['customer_id'] as string | undefined,
      status: attributes['status'] as string | undefined,
      ...(typeof amount === 'number' && { amount: PaymongoService.toMajorUnits(amount) }),
      currency: attributes['currency'] as string | undefined,
    };
  }

  /**
   * Subscription / payment resource → neutral subscription payload. `planId`
   * falls back to the resource id because for `subscription.*` events the
   * resource IS the subscription.
   */
  private static subscriptionEventData(
    resource: PaymongoResource<Record<string, unknown>> | undefined,
    attributes: Record<string, unknown>,
  ): SubscriptionEventData {
    const amount = attributes['amount'];
    return {
      id: resource?.id ?? '',
      planId: (attributes['subscription_id'] as string | undefined) ?? resource?.id,
      customerId: attributes['customer_id'] as string | undefined,
      status: attributes['status'] as string | undefined,
      ...(typeof amount === 'number' && { amount: PaymongoService.toMajorUnits(amount) }),
      currency: attributes['currency'] as string | undefined,
      paymentMethodId: attributes['payment_method_id'] as string | undefined,
      paymentMethodType: attributes['payment_method_type'] as string | undefined,
    };
  }

  /**
   * Refund resource → neutral refund payload. `paymentRequestId` carries
   * PayMongo's `payment_id`; `invoiceId` is only present when the payload
   * exposes the originating checkout session, which is the field BillingService
   * links on (`Payment.providerInvoiceId`).
   */
  private static refundEventData(
    resource: PaymongoResource<Record<string, unknown>> | undefined,
    attributes: Record<string, unknown>,
  ): RefundEventData {
    const amount = attributes['amount'];
    return {
      id: (attributes['refund_id'] as string | undefined) ?? resource?.id ?? '',
      invoiceId: attributes['checkout_session_id'] as string | undefined,
      paymentRequestId: attributes['payment_id'] as string | undefined,
      amount: typeof amount === 'number' ? PaymongoService.toMajorUnits(amount) : 0,
      currency: attributes['currency'] as string | undefined,
      status: attributes['status'] as string | undefined,
      reason: attributes['reason'] as string | undefined,
    };
  }

  // ---- Mappers ----

  private static toProviderInvoice(
    session: PaymongoResource<PaymongoCheckoutSessionAttributes>,
    externalId?: string,
    description?: string,
  ): ProviderInvoice {
    const lineItem = session.attributes?.line_items?.[0];
    return {
      id: session.id,
      externalId: session.attributes?.reference_number ?? externalId ?? '',
      invoiceUrl: session.attributes?.checkout_url,
      status: session.attributes?.status ?? '',
      amount: PaymongoService.toMajorUnits(lineItem?.amount ?? 0),
      currency: lineItem?.currency ?? '',
      description: session.attributes?.description ?? lineItem?.name ?? description ?? '',
    };
  }

  private static toProviderSubscription(
    subscription: PaymongoResource<PaymongoSubscriptionAttributes>,
  ): ProviderSubscription {
    const amount = subscription.attributes?.amount;
    return {
      id: subscription.id,
      customerId: subscription.attributes?.customer_id,
      status: subscription.attributes?.status,
      currency: subscription.attributes?.currency,
      ...(typeof amount === 'number' && { amount: PaymongoService.toMajorUnits(amount) }),
    };
  }

  /**
   * PayMongo requires both `first_name` and `last_name`. Our port carries a
   * single `givenNames` string, so split on the last space and fall back to a
   * neutral placeholder rather than sending an empty required field.
   */
  private static splitName(givenNames?: string): { firstName: string; lastName: string } {
    const tokens = (givenNames ?? '').trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return { firstName: 'LIBERTASIAN', lastName: 'Customer' };
    if (tokens.length === 1) return { firstName: tokens[0]!, lastName: tokens[0]! };
    return { firstName: tokens.slice(0, -1).join(' '), lastName: tokens[tokens.length - 1]! };
  }

  /**
   * Internal HTTP request helper using native fetch.
   * Auth is HTTP Basic with the secret key as the username and an empty
   * password — `base64(secretKey + ':')`.
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const authHeader = Buffer.from(`${this.secretKey}:`).toString('base64');
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${authHeader}`,
    };

    const response = await fetch(url, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(`PayMongo API error: ${response.status} ${method} ${path} — ${errorBody}`);
      let errorCode: string | null = null;
      try {
        const parsed = JSON.parse(errorBody) as { errors?: { code?: unknown }[] };
        const code = parsed.errors?.[0]?.code;
        if (typeof code === 'string') {
          errorCode = code;
        }
      } catch {
        // Non-JSON error body — status alone still identifies the failure.
      }
      throw new PaymongoApiError(response.status, errorCode);
    }

    return (await response.json()) as T;
  }
}
