/**
 * Provider-agnostic payment port.
 *
 * Everything in this file is written in OUR vocabulary, not a gateway's. The
 * concrete adapter (today: `XenditService`) owns the wire formats, endpoint
 * paths and event-name strings; nothing outside the adapter file may import a
 * `Xendit*` type.
 *
 * The surface is deliberately narrow: it covers exactly the calls the
 * application makes today and nothing speculative. Adding PayMongo / Maya /
 * Dragonpay means writing one more class that implements `PaymentProvider` and
 * binding it to the `PAYMENT_PROVIDER` token — no call-site changes.
 */

/** DI token for the configured provider adapter. */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/**
 * Canonical provider slugs. Used as the `provider` discriminator column on
 * Subscription / PaymentMethod / Payment, as the `:provider` webhook path
 * segment, and in audit action names (`billing.webhook.<slug>.<event>`).
 */
export const PAYMENT_PROVIDERS = ['xendit', 'paymongo'] as const;
export type PaymentProviderSlug = (typeof PAYMENT_PROVIDERS)[number];

/**
 * A non-2xx response from the gateway. Adapters MUST throw this (or a subclass)
 * so callers can branch on `errorCode` without knowing which gateway spoke.
 */
export class PaymentProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    /** Gateway-specific machine code, when the body carried one. */
    readonly errorCode: string | null,
  ) {
    super(`${provider} API error: ${status}`);
    this.name = 'PaymentProviderError';
  }
}

// ---- Customers ----

export interface CreateCustomerParams {
  /** Idempotent external reference (we use the organization id). */
  referenceId: string;
  email?: string;
  mobileNumber?: string;
  givenNames?: string;
}

export interface ProviderCustomer {
  id: string;
  referenceId: string;
}

// ---- Subscription sessions ----

export interface CreateSubscriptionSessionParams {
  /** Idempotent external reference (we use the local Subscription id). */
  referenceId: string;
  customerId: string;
  /** Amount in WHOLE currency units (not minor units). */
  amount: number;
  currency: string;
  interval: 'MONTH' | 'YEAR';
  intervalCount: number;
  description: string;
  successReturnUrl: string;
  cancelReturnUrl: string;
  metadata: Record<string, string>;
}

export interface ProviderSubscriptionSession {
  /** Gateway's id for the checkout session. */
  sessionId: string;
  /** Hosted checkout URL the client is redirected to (null if none issued). */
  checkoutUrl: string | null;
  referenceId: string;
  status?: string;
  /**
   * The gateway subscription id, when it is known at session-creation time.
   * PayMongo returns it immediately; Xendit leaves it undefined (the Xendit
   * recurring-plan id only arrives on plan activation), so callers MUST treat
   * it as optional and behave exactly as before when it is absent.
   * BillingService persists it onto the local Subscription when present.
   */
  providerSubscriptionId?: string;
}

/** A recurring plan / subscription as the gateway sees it. */
export interface ProviderSubscription {
  id: string;
  referenceId?: string;
  customerId?: string;
  status?: string;
  currency?: string;
  amount?: number;
}

// ---- One-off invoices ----

export interface CreateInvoiceParams {
  amount: number;
  currency: string;
  description: string;
  externalId: string;
  metadata: Record<string, string>;
  successRedirectUrl: string;
  failureRedirectUrl: string;
}

export interface ProviderInvoice {
  id: string;
  externalId: string;
  invoiceUrl: string;
  status: string;
  amount: number;
  currency: string;
  description: string;
}

// ---- Webhooks ----

/**
 * Internal, provider-neutral event vocabulary. Adapters translate their own
 * strings (Xendit's `PAID` / `EXPIRED` / `recurring.plan.activated` / …) into
 * exactly one of these.
 *
 * `payment.failed` is reserved for gateways that emit an explicit charge
 * failure; Xendit only expresses invoice failure as expiry, which maps to
 * `payment.expired`. Both route to the same handler.
 */
export type WebhookEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.expired'
  | 'payment.captured'
  | 'refund.succeeded'
  | 'refund.failed'
  | 'subscription.activated'
  | 'subscription.deactivated'
  | 'subscription.cycle.created'
  | 'subscription.cycle.succeeded'
  | 'subscription.cycle.failed'
  | 'unknown';

/** Payload for `payment.succeeded` / `payment.failed` / `payment.expired`. */
export interface PaymentEventData {
  /** Gateway invoice id — matches `Payment.providerInvoiceId`. */
  id: string;
  /** Gateway-native status, kept for logging/audit only. */
  status?: string;
  failureReason?: string;
}

/** Payload for `refund.succeeded` / `refund.failed`. */
export interface RefundEventData {
  /** The refund's own id (idempotency key + `Payment.refundId`). */
  id: string;
  /** Invoice the refund originated from — links back to `Payment.providerInvoiceId`. */
  invoiceId?: string;
  /** Payments-API id the refund originated from, where the gateway exposes one. */
  paymentRequestId?: string;
  /** Refund amount in WHOLE currency units (mirrors the invoice unit). */
  amount: number;
  currency?: string;
  status?: string;
  reason?: string;
}

/** Payload for every `subscription.*` event. */
export interface SubscriptionEventData {
  /** Event object id: the plan id for plan events, the cycle id for cycle events. */
  id: string;
  /** The gateway's recurring-plan id — matches `Subscription.providerSubscriptionId`. */
  planId?: string;
  /** Our local Subscription id, echoed back from the session's reference. */
  referenceId?: string;
  customerId?: string;
  status?: string;
  /** Charge amount in WHOLE currency units. */
  amount?: number;
  currency?: string;
  /** Saved instrument from an activation payload, when the gateway supplies one. */
  paymentMethodId?: string;
  paymentMethodType?: string;
}

interface WebhookEventBase {
  /** Which adapter produced this event. */
  provider: string;
  /**
   * The gateway's own event name/status (`PAID`, `recurring.cycle.succeeded`).
   * Retained verbatim so audit-log actions and Redis idempotency keys stay
   * byte-identical across this refactor.
   */
  providerEventName: string;
  /** Redis idempotency namespace — `billing:webhook:<scope>:<entityId>`. */
  idempotencyScope: string;
  /** Audit action suffix — `billing.webhook.<provider>.<suffix>`. */
  auditSuffix: string;
  /** Entity the event concerns: invoice id, refund id, or plan/cycle id. */
  entityId: string | undefined;
  /** PII-safe audit metadata, shaped by the adapter. */
  auditMetadata: Record<string, unknown>;
}

/**
 * Outcome of authenticating an inbound webhook. Three-valued rather than
 * boolean so the controller can keep returning distinct 400 messages for a
 * missing credential vs. a wrong one, without knowing which header carries it.
 */
export type WebhookVerification = 'valid' | 'missing' | 'invalid';

export type NormalizedWebhookEvent = WebhookEventBase &
  (
    | {
        type: 'payment.succeeded' | 'payment.failed' | 'payment.expired';
        data: PaymentEventData;
      }
    | { type: 'payment.captured'; data: SubscriptionEventData }
    | { type: 'refund.succeeded' | 'refund.failed'; data: RefundEventData }
    | {
        type:
          | 'subscription.activated'
          | 'subscription.deactivated'
          | 'subscription.cycle.created'
          | 'subscription.cycle.succeeded'
          | 'subscription.cycle.failed';
        data: SubscriptionEventData;
      }
    | { type: 'unknown'; data: Record<string, unknown> }
  );

/**
 * The port every gateway adapter implements.
 *
 * Signature/verification note: gateways authenticate webhooks differently
 * (Xendit: a shared `x-callback-token`; PayMongo/Maya: an HMAC over the raw
 * body). `verifyWebhookSignature` therefore receives BOTH the raw body and the
 * request headers, and each adapter reads whatever it needs.
 */
export interface PaymentProvider {
  /** Canonical slug, persisted on billing rows and used in webhook paths. */
  readonly slug: string;

  createCustomer(params: CreateCustomerParams): Promise<ProviderCustomer>;
  getCustomerByReferenceId(referenceId: string): Promise<ProviderCustomer | null>;

  createSubscriptionSession(
    params: CreateSubscriptionSessionParams,
  ): Promise<ProviderSubscriptionSession>;
  retrieveSubscription(id: string): Promise<ProviderSubscription>;
  cancelSubscription(id: string): Promise<ProviderSubscription>;

  createInvoice(params: CreateInvoiceParams): Promise<ProviderInvoice>;
  retrieveInvoice(id: string): Promise<ProviderInvoice>;

  /** Authenticate an inbound webhook. Anything but 'valid' is rejected with 400. */
  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): WebhookVerification;
  /** Parse + translate a raw webhook body into the internal vocabulary. */
  parseWebhookEvent(rawBody: string): NormalizedWebhookEvent;
}
