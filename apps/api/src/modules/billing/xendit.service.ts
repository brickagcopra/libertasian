import { timingSafeEqual } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface XenditInvoiceParams {
  amount: number;
  currency: string;
  description: string;
  externalId: string;
  metadata: Record<string, string>;
  successRedirectUrl: string;
  failureRedirectUrl: string;
}

export interface XenditInvoice {
  id: string;
  external_id: string;
  invoice_url: string;
  status: string;
  amount: number;
  currency: string;
  description: string;
}

export interface XenditWebhookEvent {
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
export interface XenditRefundData {
  /** The refund's own id (used as the idempotency key for refund events). */
  id: string;
  /**
   * Invoice id the refund originated from. Present (though deprecated by
   * Xendit) for invoice-originated refunds — this is how we link back to a
   * local Payment via `xenditInvoiceId`.
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

export interface XenditRefundWebhookEvent {
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

/**
 * Error thrown for non-2xx Xendit responses. Carries the HTTP status and the
 * Xendit `error_code` from the response body (e.g. `DUPLICATE_ERROR` on
 * `POST /customers` with an already-used reference_id) so callers can branch
 * on specific failures instead of treating every Xendit error as a 500.
 */
export class XenditApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string | null,
  ) {
    super(`Xendit API error: ${status}`);
    this.name = 'XenditApiError';
  }
}

export interface XenditCustomerParams {
  /** Idempotent external reference (we use the organization id). */
  referenceId: string;
  email?: string;
  mobileNumber?: string;
  givenNames?: string;
}

export interface XenditCustomer {
  id: string;
  reference_id: string;
  [key: string]: unknown;
}

export interface XenditSubscriptionSessionParams {
  /** Idempotent external reference (we use the local Subscription id). */
  referenceId: string;
  customerId: string;
  /** Amount in WHOLE PHP (Xendit `amount` is whole currency units). */
  amount: number;
  currency: string;
  /** Billing cadence — Xendit `schedule.interval` + `interval_count`. */
  interval: 'MONTH' | 'YEAR';
  intervalCount: number;
  description: string;
  /** Hosted-flow redirect targets (no separate failure URL on sessions). */
  successReturnUrl: string;
  cancelReturnUrl: string;
  metadata: Record<string, string>;
}

/** Response from `POST /sessions` (session_type=SUBSCRIPTION). */
export interface XenditSubscriptionSession {
  payment_session_id: string;
  /** Hosted checkout URL the client is redirected to. */
  payment_link_url: string;
  reference_id: string;
  status?: string;
  [key: string]: unknown;
}

/** Response from `GET /recurring/plans/{id}` (id = repl_...). */
export interface XenditRecurringPlan {
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
export interface XenditRecurringWebhookEvent {
  event: string;
  business_id?: string;
  created?: string;
  api_version?: string;
  data: XenditRecurringData;
  [key: string]: unknown;
}

export interface XenditRecurringData {
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

@Injectable()
export class XenditService {
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
   * Returns the invoice object with invoice_url for redirect.
   */
  async createInvoice(params: XenditInvoiceParams): Promise<XenditInvoice> {
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

    return this.request<XenditInvoice>('POST', '/v2/invoices', body);
  }

  /**
   * Retrieve an invoice by ID.
   */
  async retrieveInvoice(id: string): Promise<XenditInvoice> {
    return this.request<XenditInvoice>('GET', `/v2/invoices/${id}`);
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
  async createCustomer(params: XenditCustomerParams): Promise<XenditCustomer> {
    const body: Record<string, unknown> = {
      reference_id: params.referenceId,
      type: 'INDIVIDUAL',
      ...(params.email && { email: params.email }),
      ...(params.mobileNumber && { mobile_number: params.mobileNumber }),
      ...(params.givenNames && {
        individual_detail: { given_names: params.givenNames },
      }),
    };

    return this.request<XenditCustomer>('POST', '/customers', body);
  }

  /**
   * Look up an existing Xendit Customer by its `reference_id` (our org id).
   * Returns null when none exists. Used to make customer resolution
   * idempotent: reference_id is unique at Xendit, so a blind re-POST after a
   * lost local pointer 409s with DUPLICATE_ERROR.
   */
  async getCustomerByReferenceId(referenceId: string): Promise<XenditCustomer | null> {
    const result = await this.request<{ data?: XenditCustomer[] }>(
      'GET',
      `/customers?reference_id=${encodeURIComponent(referenceId)}`,
    );
    return result.data?.[0] ?? null;
  }

  /**
   * Create a SUBSCRIPTION-mode Payment Session and return the hosted checkout
   * (`payment_link_url`). Xendit auto-creates a Recurring Plan once the customer
   * authorises, then owns scheduling, auto-debit (cards AND GCash/Maya), retries
   * and dunning. The `repl_` plan id arrives later via `recurring.plan.activated`
   * — subscriptions are linked back by `reference_id`.
   */
  async createSubscriptionSession(
    params: XenditSubscriptionSessionParams,
  ): Promise<XenditSubscriptionSession> {
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

    return this.request<XenditSubscriptionSession>(
      'POST',
      '/sessions',
      body,
      XENDIT_RECURRING_API_VERSION,
    );
  }

  /** Retrieve a recurring plan by id (id = repl_...). */
  async retrieveSubscription(id: string): Promise<XenditRecurringPlan> {
    return this.request<XenditRecurringPlan>(
      'GET',
      `/recurring/plans/${id}`,
      undefined,
      XENDIT_RECURRING_API_VERSION,
    );
  }

  /**
   * Deactivate (cancel) a recurring plan immediately — Xendit exposes no
   * cancel-at-period-end parameter, so we model that distinction at our layer
   * (REQUEST_CANCEL keeps entitlements until currentPeriodEnd; either way we
   * deactivate now so no further auto-debit occurs).
   */
  async cancelSubscription(id: string): Promise<XenditRecurringPlan> {
    return this.request<XenditRecurringPlan>(
      'POST',
      `/recurring/plans/${id}/deactivate`,
      undefined,
      XENDIT_RECURRING_API_VERSION,
    );
  }

  /** Extract the hosted checkout URL from a freshly-created session. */
  static hostedUrl(session: XenditSubscriptionSession): string | null {
    return session.payment_link_url ?? null;
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
   * Verify webhook callback token.
   * Xendit sends the token via X-CALLBACK-TOKEN header.
   * Verification is a simple constant-time string comparison.
   */
  verifyWebhookToken(callbackToken: string): boolean {
    if (!callbackToken || !this.webhookCallbackToken) {
      this.logger.warn('Webhook callback token missing');
      return false;
    }

    const tokenBuffer = Buffer.from(callbackToken);
    const expectedBuffer = Buffer.from(this.webhookCallbackToken);

    if (tokenBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(tokenBuffer, expectedBuffer);
  }

  /**
   * Parse a webhook event payload.
   * Xendit sends a flat JSON payload (no nested wrapper).
   */
  parseWebhookEvent(rawBody: string): XenditWebhookEvent {
    return JSON.parse(rawBody) as XenditWebhookEvent;
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
