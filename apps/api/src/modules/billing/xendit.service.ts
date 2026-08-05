import { timingSafeEqual } from 'crypto';

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
  type ProviderSubscriptionSession,
  type WebhookVerification,
} from './payment-provider.interface';

/**
 * Xendit adapter for the `PaymentProvider` port.
 *
 * EVERY Xendit-specific detail — endpoint paths, snake_case wire shapes, event
 * name strings, the `x-callback-token` scheme — lives in this file. Callers see
 * only the neutral DTOs from `payment-provider.interface.ts`. The wire types
 * below are intentionally NOT exported.
 */

interface XenditInvoice {
  id: string;
  external_id: string;
  invoice_url: string;
  status: string;
  amount: number;
  currency: string;
  description: string;
}

interface XenditWebhookEvent {
  id: string;
  external_id: string;
  status: string;
  paid_amount?: number;
  amount: number;
  currency: string;
  description: string;
  [key: string]: unknown;
}

/**
 * Refund webhook payload (envelope shape).
 * Unlike invoice webhooks (flat), refund webhooks wrap the refund in a
 * `data` object under a string `event` discriminator
 * (`refund.succeeded` | `refund.failed`).
 */
interface XenditRefundData {
  /** The refund's own id (used as the idempotency key for refund events). */
  id: string;
  /**
   * Invoice id the refund originated from. Present (though deprecated by
   * Xendit) for invoice-originated refunds — this is how we link back to a
   * local Payment via `providerInvoiceId`.
   */
  invoice_id?: string;
  /**
   * Payments-API id the refund originated from. After the recurring
   * migration, invoice-originated refunds go away and this becomes the
   * linkage field. See the TODO in BillingService.handleRefundSucceeded.
   */
  payment_request_id?: string;
  /** Refund amount in WHOLE PHP (not centavos) — Xendit mirrors the invoice unit. */
  amount: number;
  currency: string;
  status: string;
  reason?: string;
  [key: string]: unknown;
}

interface XenditRefundWebhookEvent {
  event: string;
  data: XenditRefundData;
  [key: string]: unknown;
}

// ---- Recurring (Xendit v3 Payments API: Customers + Payment Sessions + Recurring Plans) ----
//
// Current Xendit "Subscriptions" product:
//   POST /customers                              -> { id }
//   POST /sessions  (session_type=SUBSCRIPTION)  -> { payment_session_id (ps-...), payment_link_url }
//   GET  /recurring/plans/{id}                   -> plan (id = repl_...)
//   POST /recurring/plans/{id}/deactivate        -> immediate cancel
// Recurring/session calls require the `api-version: 2026-01-01` header.
// NOTE: createSession returns a SESSION (ps-...); the recurring plan id (repl_...)
// is only known once `recurring.plan.activated` fires, so subscriptions are
// linked back by `reference_id` (our local Subscription id) at activation.

/** Pinned API version for the recurring/session endpoints. */
export const XENDIT_RECURRING_API_VERSION = '2026-01-01';

/** Canonical slug for this adapter — persisted on billing rows, used in webhook paths. */
export const XENDIT_PROVIDER_SLUG = 'xendit';

/**
 * Error thrown for non-2xx Xendit responses. Carries the HTTP status and the
 * Xendit `error_code` from the response body (e.g. `DUPLICATE_ERROR` on
 * `POST /customers` with an already-used reference_id) so callers can branch
 * on specific failures instead of treating every Xendit error as a 500.
 *
 * Extends the port's `PaymentProviderError` so callers branch on the neutral
 * type, never on this one.
 */
export class XenditApiError extends PaymentProviderError {
  constructor(status: number, errorCode: string | null) {
    super(XENDIT_PROVIDER_SLUG, status, errorCode);
    this.name = 'XenditApiError';
    // Keep the original wording — this string appears in existing logs/alerts.
    this.message = `Xendit API error: ${status}`;
  }
}

interface XenditCustomer {
  id: string;
  reference_id: string;
  [key: string]: unknown;
}

/** Response from `POST /sessions` (session_type=SUBSCRIPTION). */
interface XenditSubscriptionSession {
  payment_session_id: string;
  /** Hosted checkout URL the client is redirected to. */
  payment_link_url: string;
  reference_id: string;
  status?: string;
  [key: string]: unknown;
}

/** Response from `GET /recurring/plans/{id}` (id = repl_...). */
interface XenditRecurringPlan {
  id: string;
  reference_id: string;
  customer_id: string;
  status: string;
  currency: string;
  amount: number;
  [key: string]: unknown;
}

/**
 * Exact webhook event-name strings for the current Subscriptions product.
 * Confirmed against the docs (see PR description). Envelope is nested:
 * `{ event, business_id, created, api_version, data }`. The dotted forms are
 * the canonical ones. Centralised so a single edit reconciles every consumer.
 */
export const XENDIT_RECURRING_EVENTS = {
  PLAN_ACTIVATED: 'recurring.plan.activated',
  PLAN_INACTIVATED: 'recurring.plan.inactivated',
  CYCLE_CREATED: 'recurring.cycle.created',
  CYCLE_SUCCEEDED: 'recurring.cycle.succeeded',
  CYCLE_RETRYING: 'recurring.cycle.retrying',
  CYCLE_FAILED: 'recurring.cycle.failed',
  /** Fires alongside `recurring.cycle.succeeded` when the charge captures. */
  PAYMENT_SUCCEEDED: 'payment.succeeded',
} as const;

/** Recurring webhook envelope: `{ event, business_id, created, api_version, data }`. */
interface XenditRecurringWebhookEvent {
  event: string;
  business_id?: string;
  created?: string;
  api_version?: string;
  data: XenditRecurringData;
  [key: string]: unknown;
}

interface XenditRecurringData {
  /** For plan.* events: the plan id (repl_...). For cycle.* events: the cycle id. */
  id: string;
  /**
   * The recurring plan id (repl_...). Field name varies by event/surface, so we
   * accept both; cycle.* events carry the plan via `recurring_plan_id`.
   */
  plan_id?: string;
  recurring_plan_id?: string;
  /** Our local Subscription id (we set `reference_id` on the session). */
  reference_id?: string;
  customer_id?: string;
  status?: string;
  /** Charge amount in WHOLE PHP. */
  amount?: number;
  currency?: string;
  [key: string]: unknown;
}

/** Prefixes that identify the nested recurring envelope. */
const RECURRING_EVENT_PREFIXES = ['recurring.', 'payment.'];

@Injectable()
export class XenditService implements PaymentProvider {
  readonly slug = XENDIT_PROVIDER_SLUG;

  private readonly logger = new Logger(XenditService.name);
  private readonly baseUrl = 'https://api.xendit.co';
  private readonly secretKey: string;
  private readonly webhookCallbackToken: string;

  constructor(private readonly config: ConfigService) {
    this.secretKey = this.config.get<string>('XENDIT_SECRET_KEY', '');
    this.webhookCallbackToken = this.config.get<string>('XENDIT_WEBHOOK_CALLBACK_TOKEN', '');
  }

  /**
   * Create a Xendit Invoice.
   * Returns the invoice object with a hosted URL for redirect.
   */
  async createInvoice(params: CreateInvoiceParams): Promise<ProviderInvoice> {
    const body = {
      external_id: params.externalId,
      amount: params.amount,
      currency: params.currency,
      description: params.description,
      success_redirect_url: params.successRedirectUrl,
      failure_redirect_url: params.failureRedirectUrl,
      invoice_duration: 1800,
      payment_methods: ['CREDIT_CARD', 'GCASH', 'GRABPAY', 'MAYA'],
      metadata: params.metadata,
    };

    const invoice = await this.request<XenditInvoice>('POST', '/v2/invoices', body);
    return XenditService.toProviderInvoice(invoice);
  }

  /**
   * Retrieve an invoice by ID.
   */
  async retrieveInvoice(id: string): Promise<ProviderInvoice> {
    const invoice = await this.request<XenditInvoice>('GET', `/v2/invoices/${id}`);
    return XenditService.toProviderInvoice(invoice);
  }

  // ---- Recurring subscriptions (Customers + Payment Sessions + Recurring Plans) ----
  //
  // Endpoint paths, body shapes and webhook event names are confirmed against
  // the current Xendit Subscriptions docs (see PR description). Centralised here
  // so any future API change only touches this file.

  /**
   * Create (or idempotently reference) a Xendit Customer for an organization.
   * `reference_id` is the org id so repeat calls map to the same customer.
   */
  async createCustomer(params: CreateCustomerParams): Promise<ProviderCustomer> {
    const body: Record<string, unknown> = {
      reference_id: params.referenceId,
      type: 'INDIVIDUAL',
      ...(params.email && { email: params.email }),
      ...(params.mobileNumber && { mobile_number: params.mobileNumber }),
      ...(params.givenNames && {
        individual_detail: { given_names: params.givenNames },
      }),
    };

    const customer = await this.request<XenditCustomer>('POST', '/customers', body);
    return { id: customer.id, referenceId: customer.reference_id };
  }

  /**
   * Look up an existing Xendit Customer by its `reference_id` (our org id).
   * Returns null when none exists. Used to make customer resolution
   * idempotent: reference_id is unique at Xendit, so a blind re-POST after a
   * lost local pointer 409s with DUPLICATE_ERROR.
   */
  async getCustomerByReferenceId(referenceId: string): Promise<ProviderCustomer | null> {
    const result = await this.request<{ data?: XenditCustomer[] }>(
      'GET',
      `/customers?reference_id=${encodeURIComponent(referenceId)}`,
    );
    const customer = result.data?.[0];
    return customer ? { id: customer.id, referenceId: customer.reference_id } : null;
  }

  /**
   * Create a SUBSCRIPTION-mode Payment Session and return the hosted checkout
   * URL. Xendit auto-creates a Recurring Plan once the customer authorises,
   * then owns scheduling, auto-debit (cards AND GCash/Maya), retries and
   * dunning. The `repl_` plan id arrives later via `recurring.plan.activated`
   * — subscriptions are linked back by `reference_id`.
   */
  async createSubscriptionSession(
    params: CreateSubscriptionSessionParams,
  ): Promise<ProviderSubscriptionSession> {
    const body = {
      reference_id: params.referenceId,
      session_type: 'SUBSCRIPTION',
      mode: 'PAYMENT_LINK',
      amount: params.amount,
      currency: params.currency,
      country: 'PH',
      customer_id: params.customerId,
      description: params.description,
      subscription: {
        schedule: {
          interval: params.interval,
          interval_count: params.intervalCount,
          // REQUIRED — and Xendit enforces anchor_date >= the session's
          // expires_at (30 min from creation), so "now" is rejected. The
          // anchor starts the SECOND cycle, one billing period out; the first
          // charge is collected at completion via immediate_payment.
          anchor_date: XenditService.subscriptionAnchorDate(
            params.interval,
            params.intervalCount,
          ),
        },
        // Collect the first charge at session completion
        // (charge-now-then-recur). Without this the customer pays NOTHING
        // until anchor_date.
        immediate_payment: true,
        // Let Xendit retry a failed cycle (dunning) before giving up.
        failed_cycle_action: 'STOP',
      },
      // Cards + PH e-wallets for auto-debit.
      allowed_payment_channels: ['CARDS', 'GCASH', 'PAYMAYA'],
      success_return_url: params.successReturnUrl,
      cancel_return_url: params.cancelReturnUrl,
      metadata: params.metadata,
    };

    const session = await this.request<XenditSubscriptionSession>(
      'POST',
      '/sessions',
      body,
      XENDIT_RECURRING_API_VERSION,
    );

    return {
      sessionId: session.payment_session_id,
      checkoutUrl: session.payment_link_url ?? null,
      referenceId: session.reference_id,
      status: session.status,
    };
  }

  /** Retrieve a recurring plan by id (id = repl_...). */
  async retrieveSubscription(id: string): Promise<ProviderSubscription> {
    const plan = await this.request<XenditRecurringPlan>(
      'GET',
      `/recurring/plans/${id}`,
      undefined,
      XENDIT_RECURRING_API_VERSION,
    );
    return XenditService.toProviderSubscription(plan);
  }

  /**
   * Deactivate (cancel) a recurring plan immediately — Xendit exposes no
   * cancel-at-period-end parameter, so we model that distinction at our layer
   * (REQUEST_CANCEL keeps entitlements until currentPeriodEnd; either way we
   * deactivate now so no further auto-debit occurs).
   */
  async cancelSubscription(id: string): Promise<ProviderSubscription> {
    const plan = await this.request<XenditRecurringPlan>(
      'POST',
      `/recurring/plans/${id}/deactivate`,
      undefined,
      XENDIT_RECURRING_API_VERSION,
    );
    return XenditService.toProviderSubscription(plan);
  }

  /**
   * Anchor date for a new subscription schedule: the start of the NEXT cycle
   * (`from` + one billing period), as ISO 8601 UTC without milliseconds.
   *
   * The first charge is collected at session completion
   * (`immediate_payment: true`), so the anchor is when the SECOND charge is
   * due. It cannot be "now": Xendit enforces anchor_date >= the session's
   * expires_at (sessions expire 30 min after creation) and rejects otherwise
   * with API_VALIDATION_ERROR.
   *
   * Day-of-month is clamped to 28 BEFORE adding the period: Xendit caps the
   * anchor day at 28 ("Max allowed day of the month is 28"), and clamping
   * first also prevents JS month rollover (Jan 31 + 1 month via setUTCMonth
   * would land on Mar 3; clamped it lands on Feb 28).
   */
  static subscriptionAnchorDate(
    interval: 'MONTH' | 'YEAR',
    intervalCount: number,
    from: Date = new Date(),
  ): string {
    const d = new Date(from);
    if (d.getUTCDate() > 28) {
      d.setUTCDate(28);
    }
    if (interval === 'YEAR') {
      d.setUTCFullYear(d.getUTCFullYear() + intervalCount);
    } else {
      d.setUTCMonth(d.getUTCMonth() + intervalCount);
    }
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  /**
   * Verify the inbound webhook credential.
   * Xendit sends a shared secret via the X-CALLBACK-TOKEN header; verification
   * is a constant-time string comparison (there is no body signature).
   */
  verifyWebhookSignature(
    _rawBody: string,
    headers: Record<string, string | undefined>,
  ): WebhookVerification {
    const callbackToken = headers['x-callback-token'];
    if (!callbackToken) {
      return 'missing';
    }
    if (!this.webhookCallbackToken) {
      this.logger.warn('Webhook callback token missing');
      return 'invalid';
    }

    const tokenBuffer = Buffer.from(callbackToken);
    const expectedBuffer = Buffer.from(this.webhookCallbackToken);

    if (tokenBuffer.length !== expectedBuffer.length) {
      return 'invalid';
    }

    return timingSafeEqual(tokenBuffer, expectedBuffer) ? 'valid' : 'invalid';
  }

  /**
   * Parse a raw webhook body and translate it into the internal vocabulary.
   *
   * Three payload shapes arrive on the single webhook endpoint:
   *   - flat invoice      ({ id, status })                     → payment.*
   *   - envelope refund   ({ event: 'refund.*', data })         → refund.*
   *   - envelope recurring ({ event: 'recurring.*'|'payment.*', data })
   *                                                            → subscription.*
   *
   * `idempotencyScope`, `auditSuffix` and `auditMetadata` are produced here so
   * the Redis keys and audit rows written downstream are byte-identical to the
   * pre-abstraction behaviour.
   */
  parseWebhookEvent(rawBody: string): NormalizedWebhookEvent {
    const parsed = JSON.parse(rawBody) as XenditWebhookEvent &
      Partial<XenditRefundWebhookEvent> &
      Partial<XenditRecurringWebhookEvent>;

    if (typeof parsed.event === 'string') {
      if (parsed.event.startsWith('refund.')) {
        return this.normalizeRefundEvent(parsed.event, parsed.data as XenditRefundData);
      }
      if (RECURRING_EVENT_PREFIXES.some((p) => parsed.event!.startsWith(p))) {
        return this.normalizeRecurringEvent(parsed.event, parsed.data as XenditRecurringData);
      }
    }

    return this.normalizeInvoiceEvent(parsed);
  }

  /** Flat invoice webhook (PAID / EXPIRED). */
  private normalizeInvoiceEvent(event: XenditWebhookEvent): NormalizedWebhookEvent {
    const status = event.status;
    const base = {
      provider: this.slug,
      providerEventName: status,
      idempotencyScope: 'invoice',
      // Matches the previous `${eventStatus?.toLowerCase()}` interpolation,
      // including the literal "undefined" for a status-less payload.
      auditSuffix: status === undefined ? 'undefined' : String(status).toLowerCase(),
      entityId: event.id,
      auditMetadata: { status },
    };

    const data = {
      id: event.id,
      status,
      failureReason: event['failure_reason'] as string | undefined,
    };

    if (status === 'PAID') {
      return { ...base, type: 'payment.succeeded', data };
    }
    if (status === 'EXPIRED') {
      return { ...base, type: 'payment.expired', data };
    }
    return { ...base, type: 'unknown', data: event as Record<string, unknown> };
  }

  /** Envelope refund webhook (refund.succeeded / refund.failed). */
  private normalizeRefundEvent(
    eventName: string,
    data: XenditRefundData,
  ): NormalizedWebhookEvent {
    // Anything under `refund.` that is not an explicit success is treated as a
    // failure, exactly as the previous controller did.
    const isSuccess = eventName === 'refund.succeeded';
    return {
      provider: this.slug,
      providerEventName: eventName,
      idempotencyScope: 'refund',
      auditSuffix: isSuccess ? 'refund_succeeded' : 'refund_failed',
      entityId: data?.id,
      auditMetadata: {
        event: eventName,
        invoiceId: data?.invoice_id,
        status: data?.status,
      },
      type: isSuccess ? 'refund.succeeded' : 'refund.failed',
      data: {
        id: data?.id,
        invoiceId: data?.invoice_id,
        paymentRequestId: data?.payment_request_id,
        amount: data?.amount,
        currency: data?.currency,
        status: data?.status,
        reason: data?.reason,
      },
    };
  }

  /** Envelope recurring webhook (plan/cycle lifecycle + capture notification). */
  private normalizeRecurringEvent(
    eventName: string,
    data: XenditRecurringData,
  ): NormalizedWebhookEvent {
    const planId = data?.plan_id ?? data?.recurring_plan_id;
    const base = {
      provider: this.slug,
      providerEventName: eventName,
      // Per-event-name scope, as before: `billing:webhook:<eventName>:<id>`.
      idempotencyScope: eventName,
      auditSuffix: eventName.replace(/\./g, '_'),
      entityId: data?.id,
      auditMetadata: { event: eventName, planId, status: data?.status },
    };

    const neutralData = {
      id: data?.id,
      planId,
      referenceId: data?.reference_id,
      customerId: data?.customer_id,
      status: data?.status,
      amount: data?.amount,
      currency: data?.currency,
      paymentMethodId:
        (data?.['payment_method_id'] as string | undefined) ??
        (data?.['payment_token_id'] as string | undefined),
      paymentMethodType: data?.['payment_method_type'] as string | undefined,
    };

    switch (eventName) {
      case XENDIT_RECURRING_EVENTS.PLAN_ACTIVATED:
        return { ...base, type: 'subscription.activated', data: neutralData };
      case XENDIT_RECURRING_EVENTS.CYCLE_SUCCEEDED:
        return { ...base, type: 'subscription.cycle.succeeded', data: neutralData };
      case XENDIT_RECURRING_EVENTS.PAYMENT_SUCCEEDED:
        return { ...base, type: 'payment.captured', data: neutralData };
      case XENDIT_RECURRING_EVENTS.CYCLE_FAILED:
        return { ...base, type: 'subscription.cycle.failed', data: neutralData };
      case XENDIT_RECURRING_EVENTS.PLAN_INACTIVATED:
        return { ...base, type: 'subscription.deactivated', data: neutralData };
      case XENDIT_RECURRING_EVENTS.CYCLE_CREATED:
        return { ...base, type: 'subscription.cycle.created', data: neutralData };
      default:
        return { ...base, type: 'unknown', data: neutralData as Record<string, unknown> };
    }
  }

  private static toProviderInvoice(invoice: XenditInvoice): ProviderInvoice {
    return {
      id: invoice.id,
      externalId: invoice.external_id,
      invoiceUrl: invoice.invoice_url,
      status: invoice.status,
      amount: invoice.amount,
      currency: invoice.currency,
      description: invoice.description,
    };
  }

  private static toProviderSubscription(plan: XenditRecurringPlan): ProviderSubscription {
    return {
      id: plan.id,
      referenceId: plan.reference_id,
      customerId: plan.customer_id,
      status: plan.status,
      currency: plan.currency,
      amount: plan.amount,
    };
  }

  /**
   * Internal HTTP request helper using native fetch.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    apiVersion?: string,
  ): Promise<T> {
    const authHeader = Buffer.from(`${this.secretKey}:`).toString('base64');
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${authHeader}`,
      ...(apiVersion ? { 'api-version': apiVersion } : {}),
    };

    const response = await fetch(url, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(
        `Xendit API error: ${response.status} ${method} ${path} — ${errorBody}`,
      );
      let errorCode: string | null = null;
      try {
        const parsed = JSON.parse(errorBody) as { error_code?: unknown };
        if (typeof parsed.error_code === 'string') {
          errorCode = parsed.error_code;
        }
      } catch {
        // Non-JSON error body — status alone still identifies the failure.
      }
      throw new XenditApiError(response.status, errorCode);
    }

    return (await response.json()) as T;
  }
}
