# In-App Purchase Entitlement Design — iOS and Android

**Status:** proposed, not built. No code, no migration, no client work has landed.
**Audience:** review before implementation. The entitlement-reconciliation model is
expensive to change once real subscribers exist, which is the whole reason this
document exists ahead of the branch that implements it.

**How to review this:** every decision is numbered `D1`–`D14` and carries its own
*Decision / Why / If you disagree* block. They are deliberately separable — you can
reject `D9` (grace period) or `D14` (SurfaceGuard) without touching the port, the
schema or the state mapping. Open questions for brick are numbered `Q1`–`Q8` and
collected in §13.4.

**Sourcing rule used throughout:** anything asserted about RevenueCat or the stores
is quoted from a doc fetched while writing this, with the URL in §15. Where I could
not verify something, it says so in the text rather than reading as fact. §14 lists
what stayed unverified.

---

## Table of contents

1. [Settled inputs](#1-settled-inputs)
2. [The new port](#2-the-new-port)
3. [Schema and migration](#3-schema-and-migration)
4. [Webhook event → state mapping](#4-webhook-event--state-mapping)
5. [The org grant rule](#5-the-org-grant-rule)
6. [The double-billing rule](#6-the-double-billing-rule)
7. [Restore Purchases](#7-restore-purchases)
8. [Refunds and clawback](#8-refunds-and-clawback)
9. [Reconciliation: the pull path](#9-reconciliation-the-pull-path)
10. [The copy-test collision](#10-the-copy-test-collision)
11. [The SurfaceGuard interaction](#11-the-surfaceguard-interaction)
12. [Store price points](#12-store-price-points)
13. [Rollout sequence and open questions](#13-rollout-sequence-and-open-questions)
14. [What I could not determine](#14-what-i-could-not-determine)
15. [References](#15-references)

---

## 1. Settled inputs

These are given. They are recorded so a later reader knows they were chosen, not
defaulted into.

| | |
|---|---|
| SDK | RevenueCat (`react-native-purchases`) for **both** stores. Not native StoreKit 2 / Play Billing. One SDK, one webhook, instead of Apple ASSN V2 + Google Pub/Sub RTDN. |
| Sellable via IAP | **`pro` only.** `edu`, `team`, `enterprise` remain web/sales-led and must be neither purchasable **nor unlockable** from mobile. |
| Platforms | iOS and Android, together. |
| Price intent | Mark up so net-after-store-commission ≈ the web net, at the 15% Small Business / reduced-service-fee rate. Web `pro` is ₱999/mo, ₱9,990/yr. |
| `PAYWALL_ENFORCED` | Stays `false`. Not touched by this design. **Verified `false` in production on 2026-08-29** (see below). See `Q2` for the sequencing consequence — flagging it is not the same as proposing to change it — and §13.1 for a finding about *how* it is `false`. |

**`PAYWALL_ENFORCED` is verified `false` in production**, three independent ways on
2026-08-29:

| Check | Result |
|---|---|
| Production `.env`, line 154 | `PAYWALL_ENFORCED=false` |
| Live API container, `printenv` | `false` |
| A free org's `GET /quotas/usage` | `previewOnly=false`, `digestsPerMonth=-1`, `cameraScansPerMonth=20` — i.e. the `pro` shape |

The third check is the one that matters, because it observes the *effect* rather
than the config: a free-tier org is resolving to `pro` entitlements today, which is
exactly what `getEntitlements()` does when the kill switch is off. This is no longer
an assumption the design rests on — `Q2` (when it flips, and globally or per-cohort)
stays open, but it is now a scheduling question rather than a premise.

Verified against the codebase while writing, so the design does not restate them as
questions:

- `apps/api/src/modules/billing/payment-provider.interface.ts` defines the
  `PaymentProvider` port and the `PAYMENT_PROVIDER` DI token.
- `apps/api/src/modules/subscriptions/subscription-state-machine.ts` defines the
  states, actions, transitions, side effects and `ACCESSIBLE_STATES`.
- `subscriptions.provider` is `varchar(20)`, default `'xendit'`, **no check
  constraint**. 39 rows, all `xendit`. New slugs need no DDL.
- `Subscription` already carries `provider` / `providerCustomerId` /
  `providerSubscriptionId` (unique). `Payment` carries `provider` /
  `providerInvoiceId` (unique), amounts in centavos.
- `main.ts:13` sets `rawBody: true`; raw-body webhook auth works with no change.
- `ComplimentaryAccess` (`prisma/schema.prisma:2316`) is the existing precedent for
  granting entitlement with no gateway involved.
- `EntitlementService.resolveEffectiveEntitlements()` is Redis-cached under
  `cache:entitlements:{orgId}` for 120s; `billing.service.ts` calls
  `invalidateEntitlementCache()` after every state change.
- `Organization` has `type` (default `'individual'`) and `billingOwnerUserId`.
  34 orgs / 38 users / 38 memberships — effectively one personal org per signup,
  with **one seed org holding 5 members**, which is why §5 writes the mapping rule
  down instead of assuming 1:1.

---

## 2. The new port

### D1 — IAP gets a parallel port, not a third `PaymentProvider` adapter

**Decision.** Add `StorePurchaseProvider` in a new module
`apps/api/src/modules/store-purchases/`, with its own DI token
`STORE_PURCHASE_PROVIDER`. `PaymentProvider` / `PAYMENT_PROVIDER` are untouched.

**Why.** Two independent reasons, either of which is sufficient.

*Shape.* `PaymentProvider` has ten methods. IAP can implement two of them:

| `PaymentProvider` method | IAP |
|---|---|
| `createCustomer` | ✗ — the store owns the customer; we never create one |
| `getCustomerByReferenceId` | ✗ |
| `createSubscriptionSession` | ✗ — there is no hosted checkout URL; the purchase happens in-process on the device |
| `retrieveSubscription` | ✗ — a RevenueCat customer fetch is not this shape |
| `cancelSubscription` | ✗ — **server-side cancellation is impossible**; only the user can cancel, in the store's own UI |
| `attachSubscriptionPaymentMethod` | ✗ — the store holds the instrument |
| `createInvoice` | ✗ |
| `retrieveInvoice` | ✗ |
| `verifyWebhookSignature` | ~ — RevenueCat authenticates with a configured `Authorization` header, not an HMAC over the body |
| `parseWebhookEvent` | ~ — but into a vocabulary (`payment.succeeded`, `subscription.cycle.created`) that does not describe store events |

Eight `NotImplementedException`s and a fake customer object is not an
implementation of a port; it is a port being lied to.

*Binding.* `PAYMENT_PROVIDER` is bound by a factory in `billing.module.ts` that
picks **exactly one** adapter from the `PAYMENT_PROVIDER` env var — it is an
exclusive-or. IAP is not an alternative to Xendit; it runs **alongside** it, at the
same time, for different subscribers. A token that resolves to one adapter cannot
express that. This is the structural argument and it does not depend on the method
count.

**If you disagree:** the fallback is a third adapter with eight throwing methods
plus a `capabilities` flag on the port so call sites can branch. That leaks IAP
into `BillingService`, `AccountDeletionService` (which calls `cancelSubscription`
on the injected provider) and `WebhookController`, and every future gateway then
has to answer "am I a real gateway?". Not recommended.

### D2 — the port is inbound-first, with exactly one outbound call

```ts
// apps/api/src/modules/store-purchases/store-purchase-provider.interface.ts

/** DI token for the configured store-purchase conduit adapter. */
export const STORE_PURCHASE_PROVIDER = Symbol('STORE_PURCHASE_PROVIDER');

/**
 * Canonical STORE slugs, written to `subscriptions.provider`. These name the
 * store, not the conduit: refunds, restores and the entitlement itself belong
 * to Apple/Google. RevenueCat is swappable; the store of record is not.
 */
export const STORE_PROVIDERS = ['app_store', 'play_store'] as const;
export type StoreProviderSlug = (typeof STORE_PROVIDERS)[number];

/** Internal, conduit-neutral event vocabulary. */
export type StoreEventType =
  | 'purchase.initial'
  | 'purchase.renewed'
  | 'purchase.cancelled'       // auto-renew off; access continues
  | 'purchase.uncancelled'
  | 'purchase.billing_issue'
  | 'purchase.expired'         // definitive; revoke
  | 'purchase.refunded'
  | 'purchase.refund_reversed'
  | 'purchase.product_changed'
  | 'purchase.paused'
  | 'purchase.extended'
  | 'purchase.transferred'
  | 'informational'            // TEST, EXPERIMENT_ENROLLMENT, … ack and log
  | 'unknown';

export interface NormalizedStoreEvent {
  /** Conduit slug for the webhook path segment (`revenuecat`). */
  conduit: string;
  /** The conduit's own event id — the durable idempotency key. */
  eventId: string;
  /** The conduit's own event name (`INITIAL_PURCHASE`), kept verbatim for audit. */
  providerEventName: string;
  type: StoreEventType;
  store: StoreProviderSlug;
  environment: 'production' | 'sandbox';
  /** RevenueCat App User ID — our `organizationId`. See §5. */
  appUserId: string;
  aliases: string[];
  productId: string | null;
  entitlementIds: string[];
  periodType: 'TRIAL' | 'INTRO' | 'NORMAL' | 'PROMOTIONAL' | 'PREPAID' | null;
  transactionId: string | null;
  originalTransactionId: string | null;
  purchasedAt: Date | null;
  expiresAt: Date | null;
  /** CANCELLATION only. Drives the §4 branch. */
  cancelReason: string | null;
  /** EXPIRATION only. */
  expirationReason: string | null;
  /** PII-safe audit metadata. */
  auditMetadata: Record<string, unknown>;
}

/** A pull-side snapshot, used by restore and by the reconciliation job (§9). */
export interface StoreEntitlementSnapshot {
  appUserId: string;
  entitlements: {
    id: string;
    productId: string;
    store: StoreProviderSlug;
    expiresAt: Date | null;
    willRenew: boolean;
    periodType: string;
  }[];
}

export interface StorePurchaseProvider {
  /** Conduit slug, used in the webhook path. */
  readonly slug: string;

  /**
   * Authenticate an inbound webhook. Reuses the three-valued
   * `WebhookVerification` type from payment-provider.interface.ts — that type is
   * a genuine shared concept, and importing it is not the same as implementing
   * the port.
   */
  verifyWebhookAuthorization(
    headers: Record<string, string | undefined>,
  ): WebhookVerification;

  parseStoreEvent(rawBody: string): NormalizedStoreEvent;

  /** The ONLY outbound call. See §9. */
  fetchSubscriberSnapshot(appUserId: string): Promise<StoreEntitlementSnapshot>;
}
```

Two methods in, one out. There is no `cancel`, no `refund`, no `charge` — the
absence is the point, and a reviewer who spots a "missing" method is spotting
something the stores genuinely do not let a server do.

**Note on `conduit` vs `store`.** `slug` on the port is `'revenuecat'` (a webhook
path segment). `subscriptions.provider` gets `'app_store'` / `'play_store'`. Both
fit `varchar(20)`. Keeping them distinct means swapping conduits later does not
rewrite subscription rows.

### D3 — what is shared, what is owned

**Shared (reused verbatim, never forked):**

- The `Subscription` row itself. An IAP subscriber is a `Subscription` with
  `planCode='pro'` and a store `provider`. Everything downstream —
  `getActiveSubscription`, `ACCESSIBLE_STATE_VALUES`, `SubscriptionGuard`,
  `/quotas/usage` — keeps working with no knowledge of IAP.
- `subscription-state-machine.ts`. Not one new state, not one new action. §4 maps
  every store event onto the existing vocabulary; where nothing fits, that is
  reported as a finding rather than papered over with a new transition.
- `SubscriptionLifecycleService.executeTransition()` — so audit logs,
  `SubscriptionHistory` rows, scheduled events and quota resets are identical
  across gateways.
- `EntitlementService.invalidateEntitlementCache(organizationId)` after every
  grant, revoke or period change. Non-negotiable: without it a revoked org keeps
  paid entitlements for up to 120s.
- `AuditService`, `PlansService`, plan codes.

**Owned by the new module:**

- The webhook route, its `Authorization` check and its idempotency.
- Event → action resolution (§4) — which is *state-dependent*, not a lookup.
- `appUserId` ↔ `organizationId` resolution (§5).
- `store_purchases` / `store_webhook_events` rows (§3).
- The purchase-intent endpoint and the double-billing guard (§6).
- The reconciliation pull (§9).

### D4 — the webhook route is `POST /store/webhooks/:conduit`, not under `billing/webhooks`

**Decision.** `POST /store/webhooks/revenuecat`.

**Why.** `WebhookController` is `@Controller('billing/webhooks')` with
`@Post(':provider')`, and its `resolveProvider()` 404s any slug that is not the
single bound `PAYMENT_PROVIDER`. Mounting IAP at `billing/webhooks/revenuecat`
would be swallowed by that route and rejected before the IAP controller ever saw
it. A separate prefix avoids a routing collision that would only show up at
runtime.

Copy from the existing controller, deliberately: `@SkipThrottle()` (a store's retry
storm must not be rate-limited into failure), 400 on missing vs invalid credential
as two distinct messages, and the raw body from `rawBody: true`.

### D5 — IAP writes no `Payment`, `Invoice` or `PaymentMethod` rows

**Decision.** A store purchase creates a `Subscription` and a `store_purchases`
row. It does **not** create `Payment`, `Invoice` or `PaymentMethod` rows.

**Why.** We never touch the money. `Payment.providerInvoiceId` is `NOT NULL UNIQUE`
and there is no invoice to put in it. Worse, the amounts we could write are
RevenueCat's estimates — gross of store commission, of the storefront's own FX, and
of whatever VAT the store withheld (`Q1`) — and `payments` is read by
`JournalEntryLine` and `RevenueSchedule`. Feeding unreconcilable numbers into the
accounting tables is a bigger problem than having no rows there at all. Store
revenue reconciles **monthly, from App Store Connect and Play Console financial
reports**, which is how store revenue is reconciled anyway.

**If you disagree:** the alternative is `Payment` rows with
`provider='app_store'`, `providerInvoiceId=<rc_transaction_id>`, an explicit
`is_estimated` flag, and an accounting-side exclusion filter. That is a real option
— it gives the billing-history screen something to show — but it needs the
accounting module to opt out explicitly, and that work is not in this design.
Deciding this later costs one migration; deciding it wrong costs a restated ledger.

---

## 3. Schema and migration

### D6 — two new tables; `subscriptions` is altered not at all

**Decision.** The migration is **additive only**. `subscriptions` needs no `ALTER`:
`provider` is `varchar(20)` with no check constraint, so `'app_store'` /
`'play_store'` are already legal values.

What the existing `Subscription` columns hold for an IAP row:

| Column | Value |
|---|---|
| `provider` | `'app_store'` \| `'play_store'` |
| `providerCustomerId` | the RevenueCat App User ID — i.e. the `organizationId` (§5) |
| `providerSubscriptionId` | RevenueCat `original_transaction_id` (globally unique; the column is already `@unique`) |
| `planCode` | `'pro'` |
| `billingPeriod` | `'monthly'` \| `'annual'`, resolved from the product id |
| `currentPeriodEnd` | `expiration_at_ms` |
| `status` | a `SubscriptionState`, driven by §4 |

That is genuinely enough to *grant* entitlement. It is not enough to *audit* one,
which is what the two new tables are for.

**Why `store_purchases` is needed anyway:**

1. `Subscription` has exactly one provider-id slot. A `PRODUCT_CHANGE`
   (monthly ↔ annual) changes `product_id` without changing
   `original_transaction_id`; there is nowhere to record the product actually sold.
2. `environment` (`SANDBOX` vs `PRODUCTION`) must be recorded per transaction. A
   sandbox purchase must never grant production entitlement, and "we dropped it" is
   not an auditable answer.
3. Refund clawback (§8) needs an append-only record of the transaction being clawed
   back, months after the fact.
4. `appUserId` ↔ `organizationId` history must survive an org having no active
   subscription — otherwise a `TRANSFER` or a restore has nothing to resolve
   against.

**Why `store_webhook_events` is needed even though Redis idempotency exists:** the
existing webhook idempotency is a 7-day Redis key, and this Redis runs `noeviction`
with TTL-on-everything — it is a cache, not a record. RevenueCat retries within
~155 minutes, so Redis alone covers *retries*; it does not cover a refund arriving
60 days later whose original purchase event we must produce for audit. The Redis
key stays as the hot path; the `UNIQUE` on `rc_event_id` is the durable one.

```sql
-- ==========================================================================
-- Store purchases (IAP). Additive: nothing existing is altered.
-- Shown here for review. NOT committed as a Prisma migration by this PR.
-- ==========================================================================

-- 1. One row per store transaction RevenueCat reports to us.
CREATE TABLE store_purchases (
  id                          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id             uuid         REFERENCES subscriptions(id) ON DELETE SET NULL,

  -- 'app_store' | 'play_store'. Mirrors subscriptions.provider.
  store                       varchar(20)  NOT NULL,
  -- 'production' | 'sandbox'. A sandbox row NEVER grants entitlement in prod.
  environment                 varchar(10)  NOT NULL,

  -- RevenueCat App User ID. Equals organization_id today (see D11), stored
  -- verbatim so a future change of convention stays diagnosable.
  app_user_id                 varchar(255) NOT NULL,

  product_id                  varchar(255) NOT NULL,
  entitlement_ids             jsonb        NOT NULL DEFAULT '[]',
  -- Resolved from product_id via STORE_PRODUCT_MAP (D7), denormalised so a
  -- later map change cannot rewrite history.
  plan_code                   varchar(50)  NOT NULL,
  billing_period              varchar(20)  NOT NULL,

  rc_transaction_id           varchar(255) NOT NULL,
  rc_original_transaction_id  varchar(255) NOT NULL,
  -- The raw store token when it differs from RevenueCat's id. TEXT on purpose:
  -- a Google Play purchase token is long and its ceiling is undocumented (§14).
  store_transaction_id        text,

  -- TRIAL | INTRO | NORMAL | PROMOTIONAL | PREPAID
  period_type                 varchar(20)  NOT NULL,
  purchased_at                timestamptz  NOT NULL,
  expires_at                  timestamptz,

  -- active | expired | refunded | transferred
  status                      varchar(20)  NOT NULL DEFAULT 'active',
  refunded_at                 timestamptz,
  transferred_at              timestamptz,
  transferred_to_org_id       uuid         REFERENCES organizations(id) ON DELETE SET NULL,

  metadata_json               jsonb        NOT NULL DEFAULT '{}',
  created_at                  timestamptz  NOT NULL DEFAULT now(),
  updated_at                  timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_store_purchases_txn
  ON store_purchases (store, rc_transaction_id);
CREATE INDEX idx_store_purchases_org
  ON store_purchases (organization_id);
CREATE INDEX idx_store_purchases_original
  ON store_purchases (store, rc_original_transaction_id);
CREATE INDEX idx_store_purchases_app_user
  ON store_purchases (app_user_id);
CREATE INDEX idx_store_purchases_sub
  ON store_purchases (subscription_id);

-- 2. Append-only receipt log: durable idempotency, plus the audit artefact a
--    refund months later has to be explained against.
CREATE TABLE store_webhook_events (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RevenueCat's own event id. The durable idempotency key.
  rc_event_id       varchar(255) NOT NULL UNIQUE,
  conduit           varchar(20)  NOT NULL DEFAULT 'revenuecat',
  event_type        varchar(50)  NOT NULL,
  store             varchar(20),
  environment       varchar(10)  NOT NULL,
  app_user_id       varchar(255) NOT NULL,
  -- Nullable: an event can arrive for an app_user_id we cannot resolve, and
  -- that fact must be recorded rather than dropped.
  organization_id   uuid         REFERENCES organizations(id) ON DELETE SET NULL,
  payload_json      jsonb        NOT NULL,
  received_at       timestamptz  NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  processing_error  text
);

CREATE INDEX idx_store_webhook_events_org_received
  ON store_webhook_events (organization_id, received_at DESC);
CREATE INDEX idx_store_webhook_events_app_user
  ON store_webhook_events (app_user_id);
CREATE INDEX idx_store_webhook_events_unprocessed
  ON store_webhook_events (received_at) WHERE processed_at IS NULL;
```

`store_webhook_events` should be granted like `audit_logs`: the application role
gets `INSERT` and a narrow `UPDATE` on `processed_at` / `processing_error` only,
never `DELETE`. `payload_json` carries no PII — the App User ID is an org uuid
(D11), and RevenueCat is never sent an email address.

### D7 — product ids map to plans in typed config, not a table

**Decision.** A constant, validated at boot:

```ts
export const STORE_PRODUCT_MAP = {
  'com.libertasian.pro.monthly': { planCode: 'pro', billingPeriod: 'monthly' },
  'com.libertasian.pro.annual':  { planCode: 'pro', billingPeriod: 'annual'  },
} as const satisfies Record<
  string,
  { planCode: 'pro'; billingPeriod: 'monthly' | 'annual' }
>;
```

An event whose `product_id` is absent from this map is **recorded and refused** — it
never grants anything. This is the enforcement point for "only `pro` is sold as
IAP": there is no product id in the map that resolves to `edu`, `team` or
`enterprise`, so no store event, however malformed or hostile, can unlock them. The
literal type on `planCode` makes adding one a compile error rather than a config
mistake.

**Why not a `plan_store_products` table.** Two rows, changed only when a product is
created in App Store Connect, which is itself a manual act. A table adds a
migration, a seed and an admin surface to manage two constants, and turns the "only
`pro`" guarantee into a runtime data question instead of a compile-time one.

**If you disagree:** promoting this to a table later is a pure add — the map becomes
the seed. Cheap to revisit; that is what makes it safe to start narrow.

---

## 4. Webhook event → state mapping

> **The central point of this section:** the mapping is **not** `event → action`. It
> is `(event, current state) → action`. RevenueCat says the same event means
> different things depending on where the subscription is — most sharply, `RENEWAL`
> covers both "renewed" and *"a lapsed user resubscribed"* ([rc-events]) — and our
> machine has different legal transitions from each state. A flat lookup table would
> be wrong, and would throw `BadRequestException` out of `executeTransition` on the
> states it got wrong.

Every event is first written to `store_webhook_events`, then resolved, then — if it
resolves to an action — passed to `SubscriptionLifecycleService`. Every path that
changes state ends with `invalidateEntitlementCache(organizationId)`.

Event semantics below are quoted from RevenueCat's [Webhook Event Types and
Fields][rc-events].

### 4.1 The mapping

| RevenueCat event | Current state | Action | Resulting state | Notes |
|---|---|---|---|---|
| **`INITIAL_PURCHASE`** `period_type != TRIAL` | *(none)* | create row `provisioning`, then `ACTIVATE` | `active` | Row created with `provider='app_store'\|'play_store'`, `planCode='pro'` |
| **`INITIAL_PURCHASE`** `period_type == TRIAL` | *(none)* | create row `provisioning`, then `START_TRIAL` | `trialing` | `trialing` ∈ `ACCESSIBLE_STATES`, so entitlement holds. Schedules `trial_expiry` — see finding (f) |
| `INITIAL_PURCHASE` | `active` / `trialing` already | *(none)* | unchanged | Idempotent replay. Log and ack |
| `INITIAL_PURCHASE` | a web sub is accessible | **honour + cancel web** | see §6 | §6.1 |
| **`RENEWAL`** | `active` | `RENEW` | `active` | Resets quotas, reschedules renewal |
| `RENEWAL` | `past_due` | `RENEW` | `active` | The store recovered the charge |
| `RENEWAL` | `grace_period` | `RENEW` | `active` | |
| `RENEWAL` | `trialing` | `CONVERT_TRIAL` | `active` | Trial converted; `period_type` is `NORMAL` on this event |
| `RENEWAL` | `cancelling` | `RENEW` | `active` | Auto-renew was re-enabled without an `UNCANCELLATION` reaching us |
| `RENEWAL` | `cancelled` | `REACTIVATE` | `active` | The "lapsed user resubscribed" case. **`RENEW` is illegal from `cancelled`** |
| `RENEWAL` | `expired` | `ACTIVATE` | `active` | **`RENEW` is illegal from `expired`** |
| `RENEWAL` | `trial_expired` | `ACTIVATE` | `active` | |
| **`CANCELLATION`** reason ∈ `{UNSUBSCRIBE, PRICE_INCREASE, DEVELOPER_INITIATED}` | `active` | `REQUEST_CANCEL` | `cancelling` | `cancelling` ∈ `ACCESSIBLE_STATES` — access runs to `currentPeriodEnd`, which is correct: the store does not refund the current period |
| `CANCELLATION` same reasons | `trialing` | **none — finding (a)** | unchanged | |
| `CANCELLATION` reason `CUSTOMER_SUPPORT` | any accessible | `CANCEL_IMMEDIATELY` | `cancelled` | This is the refund path. §8 |
| `CANCELLATION` reason `BILLING_ERROR` | any | **none — finding (b)** | unchanged | |
| `CANCELLATION` reason `UNKNOWN` | `active` | `REQUEST_CANCEL` | `cancelling` | Conservative: keep access until `EXPIRATION` is definitive |
| **`UNCANCELLATION`** | `cancelling` | `UNDO_CANCEL` | `active` | |
| `UNCANCELLATION` | `trialing` | none | unchanged | Consistent with finding (a): we never left `trialing` |
| **`BILLING_ISSUE`** | `active` | `PAYMENT_FAILED` | `past_due` | `past_due` ∈ `ACCESSIBLE_STATES` — access continues, matching the stores' own billing retry. RevenueCat: *"This doesn't mean the subscription has expired."* |
| `BILLING_ISSUE` | `past_due` / `grace_period` | **none — finding (c)** | unchanged | |
| `BILLING_ISSUE` | `trialing` | none | unchanged | A trial has no charge to fail; informational |
| **`EXPIRATION`** | `trialing` | `EXPIRE_TRIAL` | `trial_expired` | Not accessible → entitlement drops |
| `EXPIRATION` | `active` / `past_due` / `grace_period` / `cancelling` | `CANCEL_IMMEDIATELY` | `cancelled` | Mirrors `handlePlanDeactivated` exactly: transition → `createFreeFallback(orgId)` → `invalidateEntitlementCache(orgId)` → `cancelPendingRenewalReminders` |
| `EXPIRATION` | `cancelled` / `expired` / `trial_expired` | none | unchanged | Already terminal — the same guard `handlePlanDeactivated` uses |
| **`REFUND_REVERSED`** | `cancelled` | `REACTIVATE` | `active` | §8 |
| `REFUND_REVERSED` | `active` | none | unchanged | Nothing was revoked |
| **`PRODUCT_CHANGE`** | any | **none — D8** | unchanged | Record the pending product; the following `RENEWAL` applies it |
| **`SUBSCRIPTION_PAUSED`** | any | **none — D9** | unchanged | Play-only. The later `EXPIRATION` (`expiration_reason = SUBSCRIPTION_PAUSED`) does the work |
| **`SUBSCRIPTION_EXTENDED`** | any accessible | none | unchanged | Update `currentPeriodEnd` and `store_purchases.expires_at` only |
| **`TRANSFER`** | — | see §5.3 | — | Revoke on the losing org, grant on the gaining one |
| **`TEMPORARY_ENTITLEMENT_GRANT`** | any | none | unchanged | RevenueCat covering its own outage. Extend `currentPeriodEnd` if already accessible; **never create a subscription from it** — it is not evidence of a purchase |
| `NON_RENEWING_PURCHASE`, `INVOICE_ISSUANCE`, `PURCHASE_REDEEMED`, `PRICE_INCREASE_CONSENT_*`, `EXPERIMENT_ENROLLMENT`, `VIRTUAL_CURRENCY_TRANSACTION`, `SUBSCRIBER_ALIAS`, `TEST` | any | none | unchanged | Persist, log, `200`. We sell no consumables and run no experiments, so if one of these ever appears in production it is a signal — alert, do not ignore silently |

### 4.2 Findings — events with no legal transition

These are reported, not papered over. In each case the recommendation is a
deliberate no-op, and in each case the *access* outcome is still correct because a
later event or an already-scheduled job closes it out. **No new transitions are
proposed for the shared state machine.**

**(a) `CANCELLATION` while `trialing` has no legal transition.** `REQUEST_CANCEL`
is defined only from `ACTIVE`. Cancelling during a free trial is the single most
common cancellation there is, so this would fire constantly: `executeTransition`
would throw `BadRequestException`, the webhook would 500, RevenueCat would retry
five times over ~155 minutes and then give up.
*Recommendation:* no-op. Record the event, set
`store_purchases.metadata_json.auto_renew = false`, leave the row `trialing`. The
`trial_expiry` scheduled event and the eventual `EXPIRATION` both land on
`EXPIRE_TRIAL → trial_expired`, which is the right outcome. Adding a
`TRIALING + REQUEST_CANCEL → CANCELLING` transition would also work, but it changes
shared machine semantics for the Xendit path too, and `TRIALING +
CANCEL_IMMEDIATELY` already exists meaning something different (immediate).

**(b) `CANCELLATION` with `cancel_reason = BILLING_ERROR` overlaps `BILLING_ISSUE`.**
RevenueCat lists `BILLING_ERROR` under both `CANCELLATION` and `EXPIRATION` reasons.
Treating it as a cancellation would move an already-`past_due` row into `cancelling`
on the way to `cancelled`, double-driving one real-world event from two directions.
*Recommendation:* no-op on `CANCELLATION/BILLING_ERROR`; `BILLING_ISSUE` and
`EXPIRATION` own that lifecycle.

**(c) `BILLING_ISSUE` from `past_due` has no transition.** `PAYMENT_FAILED` is
defined only from `ACTIVE`. The stores retry a failed charge several times and
RevenueCat emits `BILLING_ISSUE` each time. *Recommendation:* no-op after the first.
This is the machine being correct, not incomplete.

**(d) `PRODUCT_CHANGE` has no honest transition.** See D8.

**(e) `SUBSCRIPTION_PAUSED` has a transition that is actively harmful.** See D9.

**(f) The `trial_expiry` scheduled event is ours, but the trial is the store's.**
`START_TRIAL` declares `SCHEDULE_EVENT{trial_expiry}`. On the IAP path the store
decides when the trial ends and tells us via `RENEWAL` or `EXPIRATION`. Our
scheduled job could fire first — clock skew, or a store-side extension — and expire
a trial the store still considers live. *Recommendation:* on the store path,
schedule `trial_expiry` at `expiration_at_ms + 24h` rather than at our computed
trial end, so the store event always wins and the job is only a backstop for a
webhook that never arrived. Small, isolated, and it belongs in the implementation
PR's tests.

### D8 — `PRODUCT_CHANGE` changes nothing until the next `RENEWAL`

**Decision.** On `PRODUCT_CHANGE`, write the new `product_id` to
`store_purchases.metadata_json.pending_product_id`. Do not transition. The next
`RENEWAL` carries the new `product_id`, which updates `billing_period` and creates
the new `store_purchases` row.

**Why.** The machine's `UPGRADE` / `DOWNGRADE` both go to `MIGRATING` and declare
`PRORATE_PAYMENT` and `CREATE_MIGRATION_RECORD` side effects. Both are wrong here:
the store already prorated (or deferred), and we hold no money to prorate with —
`SubscriptionMigration` rows would carry fabricated centavo amounts into the
accounting tables. Separately, monthly ↔ annual within `pro` is not a plan change at
all: `planCode` is `'pro'` before and after, entitlements are identical, and
`MIGRATING` — while accessible — is a state nothing on this path would ever move it
out of.

**If you disagree:** the alternative is `UPGRADE`/`DOWNGRADE` with the two money
side effects suppressed for store providers. That means a `provider ===` branch
inside the shared lifecycle service, which is exactly the leakage D1 exists to
avoid.

### D9 — we do not run our own grace period for store subscriptions

**Decision.** No store event maps to `ENTER_GRACE_PERIOD`, and `SUBSCRIPTION_PAUSED`
maps to nothing. `past_due` (accessible) is where a failed store charge sits until
`EXPIRATION`.

**Why.** Both stores run their own billing grace period and account-hold behaviour,
and RevenueCat's `EXPIRATION` is the definitive end of access — *"The associated
user's access should be removed."* Layering our own `grace_period_end` scheduled job
on top would either revoke before the store does (a paying user loses access) or
after (free access we did not intend). One authority beats two that agree most of
the time.

`SUBSCRIPTION_PAUSED` is worse than redundant. RevenueCat: *"The subscription was
scheduled to pause **at the end of the current period**."* Our `PAUSE` action moves
to `SUSPENDED`, and `SUSPENDED` is **not** in `ACCESSIBLE_STATES` — so acting on the
event would revoke a paid-through user's access days or weeks early. Explicitly
rejected.

**If you disagree:** see `Q5`. Running our own grace period is defensible if we want
one dunning experience across web and mobile, but it needs the store treated as
advisory and a written rule for what happens when the two disagree.

### D10 — sandbox events never grant production entitlement

**Decision.** When `NODE_ENV === 'production'` and `environment === 'SANDBOX'`:
persist to `store_webhook_events`, return `200`, take no other action. When
`NODE_ENV !== 'production'`, sandbox events process normally and production events
are persisted-and-ignored (the mirror rule).

**Why.** A sandbox tester's Apple ID can drive `INITIAL_PURCHASE` against the
production webhook if the RevenueCat project is misconfigured. Returning `200` and
doing nothing is the only safe response — a non-2xx would make RevenueCat retry a
thing we will never accept. Two lines of guard that remove an entire class of "free
pro on prod" incident.

---

## 5. The org grant rule

### D11 — `app_user_id` is the `organizationId`

**Decision.** The client calls `Purchases.logIn(organizationId)`. The RevenueCat App
User ID **is** the org uuid, and `Subscription.providerCustomerId` stores it.

**Why.**

- Entitlement in this system is org-scoped end to end:
  `resolveEffectiveEntitlements(organizationId)`, `Subscription.organizationId`, the
  Prisma tenant middleware, `SubscriptionGuard`. Keying the store on a user id would
  mean a lookup on every webhook and an ambiguity for the 5-member seed org.
- It is stable, opaque and not PII. RevenueCat explicitly warns against email
  addresses (*"we don't recommend using email addresses as App User IDs"*, for
  guessability and GDPR reasons), against advertising identifiers (*"can be easily
  rotated"*) and against hardcoded strings ([rc-ids]). A uuid is none of those.
- It matches the existing convention: `CreateCustomerParams.referenceId` on the
  Xendit path is already the organization id. One convention across providers.
- It keeps `store_webhook_events.payload_json` free of PII, which matters because
  that table is retained like an audit log.

**Client rule, stated so it is not invented at implementation time:** call
`logIn(organizationId)` **on session start and on any org switch — never on user
login alone**, and `logOut()` on sign-out. A user who belongs to two orgs and
switches context must switch App User ID with it, or a purchase lands on the wrong
tenant.

**If you disagree:** `userId` is the other candidate and it is what most apps do. It
makes "one store account = one person" natural and makes `TRANSFER` match the
store's mental model. The cost is a `user → org` resolution on every webhook, a rule
for multi-org users, and a multi-member org whose subscription belongs to a person
who can be removed from it. Recorded as the runner-up, not dismissed.

### 5.2 Which org a purchase entitles, and who may buy

**The org whose id was the `app_user_id` at purchase time** — the buyer's current
org. If that org has 5 members, **all 5 get `pro`**. There is no seat accounting on
the IAP path: `pro` is `defaultSeats: 1, maxSeats: 1` in the plan seed, so a
multi-member org on `pro` is already a state web checkout would not have sold.

Two guards follow:

1. **Only the org's `billingOwnerUserId` may initiate an IAP purchase.** The
   purchase surface is hidden for other members, and `POST /store/purchase-intent`
   returns `403` for them. An IAP is charged to one person's store account and
   refundable only by them, but it grants the whole tenant — a non-owner buying for
   an org they can be removed from tomorrow is a support ticket with no clean
   resolution.
2. **Recommended: orgs with more than one active member cannot buy `pro` via IAP at
   all.** `purchase-intent` returns `409 multi_member_org` and the surface stays
   hidden. Those orgs are `team`/`enterprise` prospects and stay web/sales-led,
   which is already the settled rule for those plans.

Guard 2 is a product decision — see `Q3`. Guard 1 stands either way.

If an `INITIAL_PURCHASE` arrives for a multi-member org anyway (old client, or the
org grew between intent and purchase): **honour it.** The money is already taken and
cannot be returned by us. Grant `pro` to the org and raise
`billing.iap.multi_member_grant` for support to follow up. Refusing entitlement for
a completed store purchase is the one failure mode that gets an app pulled.

### 5.3 One store account, two app accounts

Not hypothetical: shared family devices are common, and a user who deletes and
re-creates an account gets a new org id.

**Recommendation: set the RevenueCat project's restore behaviour to "Transfer if
there are no active subscriptions."** RevenueCat's four options ([rc-restore]):

| Option | What it does | Fit |
|---|---|---|
| **Transfer to new App User ID** (RevenueCat default) | *"transfer purchases between identified App User IDs if needed"* | ✗ — silently yanks an **active** subscription off the org currently using it |
| **Transfer if there are no active subscriptions** | *"will transfer the purchases to the new App User ID unless they contain an active subscription"* | ✓ **recommended** |
| **Keep with original App User ID** | *"Returns an error if the App User ID attempting to restore purchase or make a new purchase is different from the original App User ID that made the purchase"* | ✗ — a user who deletes and recreates their account can never recover their purchase |
| **Share between App User IDs (legacy)** | *"merge (alias) any App User IDs that restore the same underlying subscription and treat them as the same subscriber"* | ✗ — aliases two orgs into one subscriber; two tenants would share one entitlement |

With the recommended setting: a second org restoring while the first org's
subscription is still active gets nothing and sees a neutral message (§7); once the
first subscription lapses, a restore transfers cleanly.

**Handling `TRANSFER`.** RevenueCat: *"A transfer of transactions and entitlements
was initiated between App User ID(s)."* The handler must, in one transaction:

1. Resolve the losing and gaining orgs from the event's App User IDs.
2. On the losing org: `CANCEL_IMMEDIATELY → cancelled`, `createFreeFallback`,
   `invalidateEntitlementCache`.
3. On the gaining org: create or reactivate the `Subscription` with the same
   `providerSubscriptionId`. **Note:** `providerSubscriptionId` is globally
   `@unique`, so the losing row's value must be cleared **in the same transaction**
   or the insert violates the constraint. This is the single most likely
   implementation bug in this whole design, and it belongs in a test.
4. Mark the `store_purchases` row `transferred`; set `transferred_to_org_id`.
5. Audit rows on **both** orgs.

`Q6` records the transfer-behaviour setting as brick's to confirm: it is a dashboard
toggle with no code change, whose default is wrong for us, and it fails silently.

---

## 6. The double-billing rule

An org with an active web subscription must not also be charged by a store, and vice
versa. Two enforcement points, because the first can be skipped and the second
cannot.

### 6.1 Web subscription exists, user tries to buy IAP

**At `POST /store/purchase-intent`** (called by the client *before* it presents the
store sheet): if `getActiveSubscription(orgId)` returns a row whose `provider` is
`xendit` or `paymongo`, return `409 already_subscribed_elsewhere`. The client never
renders the purchase button, so the store sheet never opens.

**At `INITIAL_PURCHASE`** (the race: web checkout completed between intent and
purchase, or an old client): **honour the store purchase.** Concretely —

1. Create the store `Subscription` and `ACTIVATE` it.
2. `REQUEST_CANCEL` the **web** subscription → `cancelling`. It stops renewing at
   period end; the user keeps what they already paid for.
3. Write `billing.iap.double_subscription_detected` to `audit_logs` with both
   subscription ids, and alert.
4. Leave the proration/refund of the web subscription's unused remainder to support.
   Do not automate a refund here — the cases are rare and an automated refund path
   is a larger attack surface than a support queue.

**Why this direction.** The store charge is irreversible by us: we cannot cancel or
refund an Apple or Google subscription server-side. The web charge is ours and we
can stop it. Cancelling the reversible one is the only choice that does not require
the user to file a store refund request.

**What the user sees.** A one-line notice on the purchase surface confirming the
purchase and stating that their existing web subscription will not renew. That copy
names a subscription and therefore **must live in the allowlisted purchase-surface
directory** (§10) — it cannot be dropped onto a settings screen.

### 6.2 IAP subscription exists, user tries to buy on web

`BillingService.createCheckout()` gains the mirror guard: if the org's accessible
subscription has `provider ∈ STORE_PROVIDERS`, return `409` and point the user at
their store's manage-subscription screen. **Web is our surface** — Guideline 3.1.3's
restriction on steering applies inside the iOS app, not on our own website — so web
copy may name the store, the price and the plan freely.

### 6.3 If two accessible rows exist anyway

`getActiveSubscription` orders `createdAt DESC, id DESC` and returns one row, so
tier resolution stays deterministic — and since both rows are `pro`, the
*entitlement* is identical either way. **The risk here is money, not access.** Worth
stating plainly: a double-billed user is not broken, they are overcharged, and the
detection path is the audit alert in 6.1, not a user-visible failure.

---

## 7. Restore Purchases

Required. Guideline 3.1.1: *"you should make sure you have a restore mechanism for
any restorable in-app purchases"* ([asrg]).

**Placement.** A "Restore Purchases" row in Settings, always visible on iOS and
Android once IAP is live — including for accounts with no current entitlement, since
that is exactly the state a restoring user is in and the state App Review will test
it from. It requires a signed-in session, because `app_user_id` is the org id (D11);
that is acceptable and conventional, but it means the first-run flow must reach
login before Settings.

**What it restores.** `Purchases.restorePurchases()` reactivates *"any content that
had previously been purchased from the same store account"* ([rc-restoring]) — it is
scoped to the **store account signed into the device**, not to our account.

**When the store account and the signed-in account disagree** — the case worth
designing for — behaviour follows the §5.3 transfer setting:

| Situation | Outcome |
|---|---|
| The store account's purchase already belongs to this org | No-op; entitlement already correct |
| It belongs to another org whose subscription has **lapsed** | `TRANSFER` fires → this org is granted (§5.3) |
| It belongs to another org and is **still active** | No entitlement returned. Neutral message + support link |
| The store account owns nothing | Neutral "nothing to restore" message |

The "already in use" message must not name the other account, must not name a plan,
and must be short. Suggested: *"This purchase is already in use on another
account."* It lives in the purchase-surface directory (§10) because it is about a
purchase, even though it names no price.

### D12 — restore reconciles by server-side pull, not by trusting the client

**Decision.** There is **no** `POST /store/restore` endpoint that accepts a receipt
or an entitlement claim from the client. After `restorePurchases()` resolves, the
client calls `POST /store/sync`, which triggers a server-side
`fetchSubscriberSnapshot(app_user_id)` against RevenueCat's REST API and reconciles
the result (§9).

**Why.** A client-asserted entitlement is a client-forgeable entitlement. Pulling
means the server's only input is the org id it already knows, and the answer comes
from RevenueCat directly. It also gives us the reconciliation primitive for free.

---

## 8. Refunds and clawback

Apple and Google refund without asking us, and tell us afterwards.

**Detection.** `CANCELLATION` with `cancel_reason = CUSTOMER_SUPPORT` — RevenueCat's
definition is *"Customer received a refund from Apple support, a Google Play
subscription was refunded through RevenueCat, etc."* Note that `CANCELLATION` is
documented as covering both cases (*"A subscription or non-renewing purchase was
canceled or refunded"*), which is exactly why §4 branches on `cancel_reason` rather
than on the event name.

**A limitation that must be written down.** RevenueCat: *"In the case of
subscription refunds, this event fires only when the **latest** subscription period
is refunded; refunds for earlier periods do not trigger it."* So a refund of a
period that has already rolled over is **invisible to this pipeline**. It surfaces
only in the monthly reconciliation against App Store Connect / Play Console
financial reports. That is a revenue-reporting gap, not an entitlement gap — the
user is not keeping anything they should not have — but it means "our refund total"
and "the store's refund total" will not match, and nobody should spend a day hunting
that discrepancy later.

**What the server does, in order:**

1. `store_purchases`: `status='refunded'`, `refunded_at=now()`.
2. `SubscriptionLifecycleService.executeTransition(CANCEL_IMMEDIATELY)` →
   `cancelled`. `cancelled ∉ ACCESSIBLE_STATES`, so `getActiveSubscription` stops
   returning it and the org resolves to `free`.
3. `createFreeFallback(organizationId)` — same as `handlePlanDeactivated`.
4. `invalidateEntitlementCache(organizationId)` **immediately**. Without it the org
   keeps `pro` entitlements for up to the 120s cache TTL. That window is acceptable;
   it is written down here so it is a known bound rather than a surprise.
5. `cancelPendingRenewalReminders(subscriptionId)`.

**Audit trail.** Three records, all append-only, none optional:

| Where | Action | Written by |
|---|---|---|
| `store_webhook_events` | full `payload_json`, `rc_event_id` | the webhook controller, before processing |
| `audit_logs` | `billing.webhook.revenuecat.cancellation` | the controller, mirroring the existing `billing.webhook.<provider>.<suffix>` convention |
| `audit_logs` + `subscription_history` | the `AUDIT_LOG` / `HISTORY_LOG` side effects of `CANCEL_IMMEDIATELY`, with `fromState`/`toState`, `actorType='system'` | `SubscriptionLifecycleService` |

Audit metadata: `rc_event_id`, `store`, `environment`, `product_id`,
`cancel_reason`, `rc_original_transaction_id`, `organization_id`. **No PII** — and
note this falls out of D11 for free, because the App User ID is an org uuid rather
than an email. That is a second, independent reason for that decision.

**`REFUND_REVERSED`** (*"A refund was reversed"*) reverses the clawback:
`REACTIVATE → active`, `store_purchases.status='active'`, `refunded_at=NULL`,
invalidate cache. Audited the same way.

**What we deliberately do not do.** No account suspension, no clawback of generated
content, no negative balance. The store already took the money back; punishing the
account further would be inventing a policy nobody wrote down.

---

## 9. Reconciliation: the pull path

Webhooks are best-effort. RevenueCat: *"RevenueCat makes our best effort for 'at
least one delivery' … your application may receive a webhook for the same event more
than once,"* and non-2xx responses are retried *"up to 5 times … with an increasing
delay (5, 10, 20, 40, and 80 minutes)"* ([rc-webhooks]). After ~155 minutes a
persistently failing event is gone. A paying user stranded on `free` because our API
was down for three hours is not acceptable.

Three uses of one primitive (`fetchSubscriberSnapshot`, D2):

1. **On `POST /store/sync`** — called after restore, and on app foreground at most
   once per hour. Cheap, and it self-heals the common case.
2. **Nightly job** — for every org with a store `Subscription` in a non-terminal
   state, pull the snapshot and reconcile drift. Log every correction as
   `billing.iap.reconciliation_drift`, so drift is measured rather than assumed
   absent.
3. **Manual admin action** — `POST /admin/store-purchases/:orgId/resync`.

Reconciliation compares only the fields the store owns — `expiresAt`, `willRenew`,
`productId`, and whether an entitlement is active at all — and applies the same
`(event, state) → action` resolution as §4. It never invents a state the webhook
path could not have produced.

Idempotency, both layers, per RevenueCat's own guidance (*"guard against duplicated
events by making your webhook processing idempotent … keep track of the event `id`
we send with each webhook"*):

- Redis `store:webhook:{rc_event_id}`, 7-day TTL — the hot path, matching the
  existing `WebhookController` pattern (set before handling, deleted on failure so a
  retry can re-process).
- `store_webhook_events.rc_event_id UNIQUE` — the durable one, since a refund can
  arrive long after any Redis key has expired.

---

## 10. The copy-test collision

### The conflict, stated exactly

`apps/mobile/src/features/entitlements/no-purchase-copy.test.ts` walks **all** of
`apps/mobile/src/`, extracts JSX text nodes and space-containing string literals, and
fails on any of: `Pro`, `Edu`, `Team`, `Enterprise`, `Premium`, `plan`, `pricing`,
`upgrade`, `subscription`, `tier`, `paid`, `billing`, `price`, `unlock`,
`libertasian.com`, `$`, `₱` — with four reviewed `ALLOWED` exemptions.

A compliant purchase surface must show the subscription's title, its duration and its
price before purchase (Guideline 3.1.2(c): *"Before asking a customer to subscribe,
you should clearly describe what the user will get for the price"*, reinforced by
Schedule 2 of the Apple Developer Program License Agreement). It is not possible to
do that and pass this test as written.

**The test is not deleted and `FORBIDDEN` is not shortened.** The guarantee it
encodes — that App Review cannot find a paywall on a screen with no way to buy — is
what got the freemium build through, and it must keep holding for every screen that
is not the purchase surface.

### D13 — scope by directory prefix, and assert the scope

**Decision.** Add exactly one exemption axis to the existing test: two directory
prefixes.

```ts
/**
 * The ONLY directories permitted to name a purchasable thing.
 *
 * Guideline 3.1.2 REQUIRES title, duration and price before purchase, which is
 * the exact opposite of what FORBIDDEN enforces everywhere else. The conflict is
 * resolved by LOCATION: these two trees are the purchase surface and may name a
 * plan and a price; nothing else in src/ may, and the test below proves the
 * confinement rather than assuming it.
 *
 * Adding a third prefix here is a REVIEW GATE, not a routine change.
 */
const PURCHASE_SURFACE_PREFIXES = ['app/purchase/', 'features/purchase/'] as const;

const inPurchaseSurface = (file: string): boolean =>
  PURCHASE_SURFACE_PREFIXES.some((prefix) => file.startsWith(prefix));
```

The existing `renders no purchase-implying copy anywhere in src/` test skips files
where `inPurchaseSurface(path)` is true. Everything else about it is unchanged: the
whole-`src/` walk, the JSX text scan, the space rule for literals, the four `ALLOWED`
entries, the stale-exemption test, and the two refusal-message assertions.

**Then add two tests that make the hole observable rather than trusted:**

```ts
it('confines every purchase-implying string to the purchase surface', () => {
  // The inverse of the guard above: scan src/ with NO prefix skipping, and
  // assert every hit sits inside the purchase surface. If someone adds
  // "Upgrade to Pro" to a settings screen, the main test now skips nothing —
  // so THIS is the test that catches it, and its failure names the file.
  const outside = allViolations().filter((v) => !inPurchaseSurface(v.file));
  expect(outside).toEqual([]);
});

it('keeps the purchase surface non-empty and reachable only through the gate', () => {
  // A prefix matching no files is a dead exemption; a purchase surface imported
  // from an unguarded screen is a paywall on an unguarded screen.
  const files = SOURCE_FILES.map(relativePath).filter(inPurchaseSurface);
  expect(files.length).toBeGreaterThan(0);

  const importers = SOURCE_FILES
    .map(relativePath)
    .filter((f) => !inPurchaseSurface(f))
    .filter((f) => /@\/(features|app)\/purchase/.test(read(f)));
  expect(importers).toEqual(PERMITTED_PURCHASE_ENTRY_POINTS);
});
```

`PERMITTED_PURCHASE_ENTRY_POINTS` is a short explicit list — the Settings row, plus
whichever surfaces §11 ends up allowing. Its diff is the review signal.

**Sibling tests that must NOT be scoped.** `features/chat/chat-knowledge-base.test.ts`
holds the assistant to the same word list. The chatbot must still never name a tier:
it is not a purchase surface, and a model can be talked into anything.
`NOT_INCLUDED_MESSAGE` / `NO_ACCESS_MESSAGE` stay exactly as they are.

**If you disagree:** the alternative is a per-string `ALLOWED`-style list covering
every purchase string. Stricter, but the purchase surface will have dozens of strings
and every price change would edit the test — which trains people to edit the test,
which is precisely how this guarantee dies.

---

## 11. The SurfaceGuard interaction

Today `SurfaceGuard` redirects to home when `useFreemiumSurfaces()` reports a surface
as hidden, driven by the server's `previewOnly` on `/quotas/usage`. Its own comment
states the reason: showing a feature and then refusing it *"is the shown-and-refused
pattern App Store 3.1.1 rejects."* Build 23 was rejected for exactly that.

**That reasoning is conditional on there being no way to buy, and IAP removes the
condition.** Once `pro` is purchasable in-app, showing Scan with a purchase entry
point is the ordinary, approvable pattern most subscription apps ship. So "keep
hiding" is no longer automatically right — but it is not automatically wrong either,
and this is a product call, not an engineering one.

| | **A — keep hiding** | **B — show with a purchase entry point** | **C — server-flagged, A→B without a release** |
|---|---|---|---|
| Discovery | None. A free user never learns Scan exists | Full | Off, then on |
| Conversion | Purchase surface reachable only from Settings | Best | Off, then best |
| Review risk | Lowest — identical to the approved build | Real: if IAP is broken or not yet approved on that platform, this **is** build 23 again | Lowest at submission; the flip happens after approval |
| Cost | None | None | One boolean on `/quotas/usage`, one branch in `useFreemiumSurfaces` |
| Reversibility | — | Requires a new build | Server-side, per-platform, instant |

### D14 — recommend C as the mechanism; A-vs-B as the end state is brick's call

**Decision.** Add `storePurchaseAvailable: boolean` to `/quotas/usage` alongside
`previewOnly`, resolved server-side per platform. `useFreemiumSurfaces` shows a paid
surface when `!previewOnly` **or** (`previewOnly && storePurchaseAvailable`) — where
the second case renders the surface with a purchase entry point instead of its paid
content.

**Why.** It decouples the code change from the behaviour change. The first IAP build
ships behaving **identically to today's approved build**, which is what makes it safe
to submit while the store products are still in review. The flip is a server config
change, per platform, reversible in seconds if review objects.

`storePurchaseAvailable` must be **false unless the store products are live and
approved on that platform**. An Android-approved / iOS-pending state is normal during
rollout, and a single global flag would get it wrong.

**Two details that will bite otherwise:**

- `useFreemiumSurfaces` defaults to hidden pre-resolution and persists the last
  answer in MMKV. A stale `visible` after a lapse is a shown-then-refused risk for a
  frame. The existing sync overwrites on every `/quotas/usage`, so the window is
  small — but the new flag must live in the **same persisted blob**, not a separate
  cache, or the two can disagree.
- `SurfaceGuard` currently `<Redirect>`s so the screen never mounts and fires no
  requests. Under B/C the screen *does* mount, so every guarded screen needs its data
  fetching gated on entitlement rather than on mounting. That is real work in the
  implementation PR and it is easy to miss.

**`Q4` records A-vs-B as brick's decision.** C is the mechanism either way: if the
answer is A, the flag simply never flips and nothing was wasted.

---

## 12. Store price points

### The target, and the number that decides it

Web `pro`: **₱999.00/mo** (`99900` centavos) and **₱9,990.00/yr** (`999000`), per
`prisma/seeds/plan-seed.ts`.

Netting the same at a 15% store commission, commission only:

- Monthly: `999 ÷ 0.85` = **₱1,175.29**
- Annual: `9,990 ÷ 0.85` = **₱11,752.94**

These match the ₱1,175 / ₱11,750 targets in the brief exactly, which tells us the
targets assume **commission only, with no VAT layer**.

**`Q1` — that assumption is the single biggest open number in this document.** The
Philippines now taxes non-resident digital services (RA 12023, 12% VAT), and Apple
and Google act as the collecting party on their storefronts. If the store price is
VAT-inclusive and 12% is removed *before* the 15% commission, then:

- Monthly to net ₱999: `999 × 1.12 ÷ 0.85` = **₱1,316.33**
- Annual to net ₱9,990: **₱13,163.29**

A **12% difference in the shelf price** — the gap between under- and over-shooting
the web net. It also depends on whether the web ₱999 is itself VAT-inclusive. This
needs brick's accountant, not an engineering guess, and no answer is asserted here.

### Candidate price points, under both readings

| Monthly candidate | Net @15%, no VAT | Net @15%, 12% VAT-inclusive | Verdict |
|---|---|---|---|
| ₱1,150 | ₱977.50 | ₱872.77 | short of ₱999 either way |
| **₱1,190** | **₱1,011.50** | ₱903.13 | ✓ under the no-VAT reading |
| ₱1,199 | ₱1,019.15 | ₱909.96 | ✓ under the no-VAT reading |
| ₱1,290 | ₱1,096.50 | ₱979.02 | just short under the VAT reading |
| **₱1,320** | ₱1,122.00 | **₱1,001.79** | ✓ under the VAT reading |

| Annual candidate | Net @15%, no VAT | Net @15%, 12% VAT-inclusive | Verdict |
|---|---|---|---|
| ₱11,500 | ₱9,775.00 | ₱8,727.68 | short either way |
| **₱11,750** | **₱9,987.50** | ₱8,917.41 | ✓ ≈ exact under the no-VAT reading |
| ₱11,990 | ₱10,191.50 | ₱9,099.55 | ✓ under the no-VAT reading |
| ₱13,150 | ₱11,177.50 | **₱9,979.91** | ✓ ≈ exact under the VAT reading |
| ₱13,200 | ₱11,220.00 | ₱10,017.86 | ✓ under the VAT reading |

At the **30%** rate — before Small Business Program enrolment, or after crossing the
threshold — every figure roughly halves the margin: ₱1,190 nets ₱833.00 and ₱11,750
nets ₱8,225.00, both **below** the web net. Enrolment in the reduced-rate programmes
is therefore not an optimisation, it is a precondition (§13.2).

### What is and is not verifiable about the price points themselves

**Apple no longer has global price tiers.** The current model is ~900 price points
per storefront, chosen per product, with the PHP list readable **only in App Store
Connect** or via the App Store Connect API
(`GET /v2/inAppPurchases/{id}/pricePoints`) ([apple-pricepoints]). There is no public
PHP list to cite. **So I cannot assert that any candidate above exists as a real PHP
price point.** The rule for whoever configures this: open the price-point picker for
the product, take the nearest available point to the chosen target, and record the
actual value back into this document.

**Google Play does not use a tier ladder** — prices are set per country in local
currency, with a PHP minimum of ₱15 and a maximum raisable on request
([play-pricing]). So **Play can match whatever price point Apple offers, exactly.**
That gives a clean rule: **pick the Apple price point first, then mirror it on
Play.** Identical shelf prices across platforms, which is what a user comparing them
will expect. (The "arbitrary local price" characterisation comes from secondary
sources summarising Play Console Help; treat the *exactness* as verified only once
someone has entered the number in Play Console.)

---

## 13. Rollout sequence and open questions

### 13.1 Prerequisite finding — `PAYWALL_ENFORCED` fails unsafe

This surfaced while verifying that the flag really is `false` in production (§1),
and it is a live risk to the **already-approved** iOS binary, independent of IAP.

**The finding.** Production is `false` because of one line in one file. Both
defaults point the other way:

| Location | Value |
|---|---|
| `.env.example:319` | `PAYWALL_ENFORCED=true` |
| `apps/api/src/app.module.ts:172` | `Joi.boolean().default(true)` |
| `apps/api/src/common/config/paywall.ts` | *"anything else — including the var being absent — means enforced"* |

So the flag is `false` only for as long as that one production `.env` line survives.
Lose it — a rebuilt environment, a new host, a deploy seeded from `.env.example`, a
container that comes up without the var — and the flag silently becomes `true`.
Freemium activates. `previewOnly` flips to `true`. The shipped, approved iOS binary
starts hiding paid surfaces and returning `402 subscription_required` on the paths
that can still refuse — and it does so **with no way to buy**, which is precisely
the Guideline 3.1.1 pattern build 23 was rejected for.

**What makes it worse than an ordinary misconfiguration:** there is no review gate
in the path. The binary is already approved and on devices; the behaviour change
happens server-side, instantly, to every installed copy, with nothing between the
missing env line and an App Store violation. It would be discovered by a user or by
Apple, not by a deploy check.

The `paywall.ts` comment (*"a typo can never silently open the paid surface"*) is
correct about the direction it was written to defend — a typo cannot accidentally
*disable* the paywall. But the current business need is the opposite direction, and
in that direction the same code fails open.

**Prerequisite: flip both defaults to `false`,** so the safe direction is the
default direction and the production `.env` line becomes a redundant restatement
rather than the only thing holding the line. The day IAP ships, both go back to
`true` deliberately — which is a reviewed change, not an absence.

**This is a separate one-line PR, not part of the IAP work.** It should land
immediately and independently: it protects the binary that is live today, and
nothing in this design depends on it.

### 13.2 Blocked on brick's Apple / Google account work

Nothing store-side can be configured until these land. In particular, **IAP products
cannot be created at all without an active Paid Applications Agreement.**

| Blocker | Blocks |
|---|---|
| Apple: entity conversion (individual → organization) | Everything downstream on iOS; also changes the seller name shown to users |
| Apple: Paid Applications Agreement (Schedule 2) accepted | Creating **any** IAP product in App Store Connect |
| Apple: banking + tax (W-8BEN-E as a PH entity) | Agreement activation, payouts |
| Apple: Small Business Program enrolment | The 15% rate. At 30% the §12 table does not net the web price |
| Google: payments profile + merchant setup | Creating subscription products in Play Console |
| Google: tax information | Payouts, and the reduced service fee |

The ASC app record (6788971669) and the iOS signing credentials already exist, so the
app-level prerequisites are done — this is purely the commercial/legal layer.

### 13.3 What can be built and tested first

| Phase | Needs | Work |
|---|---|---|
| **0** | Nothing | The port (D1/D2), both tables (D6), `STORE_PRODUCT_MAP` (D7), the webhook controller and its auth (D4), the full `(event, state) → action` resolver, the double-billing guards, the reconciliation pull, the purchase-intent endpoint. **All of §2–§9.** Tested against synthetic RevenueCat payloads: every row of §4.1 becomes a unit test, and every finding in §4.2 becomes a test asserting the no-op |
| **1** | RevenueCat account (free) | Dashboard project, webhook URL + `Authorization` header, the `pro` entitlement, transfer behaviour set per §5.3. Fire a `TEST` event end to end. Still no store products |
| **2** | Paid Apps agreements ✅ | Create the two products in ASC and Play Console at the §12 price points; add `react-native-purchases`; build the purchase surface under `features/purchase/`; land the D13 test scoping; plumb `storePurchaseAvailable` |
| **3** | Sandbox testers | TestFlight + Play internal testing. Walk **every row of §4.1** against real sandbox purchases — buy, cancel, uncancel, let it lapse, refund, product-change, restore, transfer |
| **4** | — | Submit with `storePurchaseAvailable=false` everywhere. The build behaves identically to the currently approved one |
| **5** | Approval | Flip the flag per platform. Then take the §11 A-vs-B decision with real data |

Phase 0 is the large majority of the engineering work and it is **completely
unblocked today**.

### 13.4 Open questions for brick

| # | Question | Why it cannot be defaulted |
|---|---|---|
| **Q1** | Is the web ₱999 VAT-inclusive, and do Apple/Google withhold 12% PH VAT before taking commission? | Moves the mobile shelf price by 12% (§12). An accountant's question, not an engineer's |
| **Q2** | `PAYWALL_ENFORCED` is `false` — **verified in production on 2026-08-29** (§1) — so `getEntitlements` returns `pro` (`previewOnly: false`) to **every** org. While that holds, an IAP purchase sells something the account already has, which App Review will notice and which makes the purchase surface untestable. When does it flip, and globally or per-cohort? | Not a proposal to change it, and no longer resting on an unverified premise. It is a hard sequencing dependency for Phase 5 and it has to be scheduled. Independently of the schedule, §13.1 must land first |
| **Q3** | Block IAP entirely for orgs with >1 member (recommended), or let the billing owner buy for the whole org? | `pro` is `maxSeats: 1`, and one seed org already has 5 members (§5.2) |
| **Q4** | After IAP is approved: keep hiding paid surfaces (A) or show them with a purchase entry point (B)? | Product/conversion call. C is the mechanism either way (§11) |
| **Q5** | Accept the stores' own grace-period behaviour (recommended), or run ours in parallel? | Two authorities that disagree revoke at the wrong time (D9) |
| **Q6** | Confirm the RevenueCat transfer behaviour setting = "Transfer if there are no active subscriptions" | A dashboard toggle whose default is wrong for us, and it fails silently (§5.3) |
| **Q7** | Offer a store free trial? `pro` is `trialEnabled: true, trialDurationDays: 14` on web | A user could take a web trial and a store trial. Also interacts with findings (a) and (f) in §4.2 |
| **Q8** | Do we honour a store refund of an *earlier* period, which RevenueCat never tells us about? | Documented gap (§8). Affects the monthly reconciliation, not entitlement |

---

## 14. What I could not determine

Listed rather than guessed.

1. **The actual PHP price points.** Apple's list is per-storefront and readable only
   in App Store Connect or via the ASC API; there is no public PHP list. §12 gives
   the targets, both VAT readings and candidates — the real values must be read off
   the picker and written back here.
2. **The maximum length of the store transaction identifier RevenueCat surfaces for
   Play.** Google Play purchase tokens are long, `Subscription.providerSubscriptionId`
   is `varchar(255)`, and I could not confirm from the docs whether RevenueCat's
   `original_transaction_id` for `PLAY_STORE` is its own short id or the raw token.
   The design works around it (`store_purchases.store_transaction_id` is `TEXT`), but
   **verify before the first Play sandbox purchase** — a truncation here fails at
   write time, in production, on someone's real money.
3. **Whether RevenueCat guarantees webhook ordering.** The docs state at-least-once
   delivery and warn about duplicates; they say nothing about order. §4's resolver is
   state-dependent and therefore order-tolerant by construction, and §9's
   reconciliation is the backstop — but that was designed around the uncertainty, not
   around a documented guarantee.
4. **PH VAT mechanics on store proceeds** (`Q1`). Apple's Small Business Program page
   and the general commission docs do not spell out the PH order of operations.

> **Resolved since the first draft.** "Whether `PAYWALL_ENFORCED` is actually `false`
> in production" was item 5 here. It was verified `false` three ways on 2026-08-29
> and the answer now lives in §1. Verifying it is what surfaced the fail-unsafe
> finding in §13.1.

---

## 15. References

Every quotation in this document comes from one of these, fetched while writing it.

- **[rc-events]** RevenueCat — Webhook Event Types and Fields —
  <https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields>
- **[rc-webhooks]** RevenueCat — Webhooks (authorization header, retries,
  at-least-once delivery, idempotency) —
  <https://www.revenuecat.com/docs/integrations/webhooks>
- **[rc-ids]** RevenueCat — Identifying Customers (App User ID guidance) —
  <https://www.revenuecat.com/docs/customers/identifying-customers>
- **[rc-restoring]** RevenueCat — Restoring Purchases —
  <https://www.revenuecat.com/docs/getting-started/restoring-purchases>
- **[rc-restore]** RevenueCat — Restore Behaviour (the four transfer options) —
  <https://www.revenuecat.com/docs/projects/restore-behavior>
- **[asrg]** Apple — App Review Guidelines 3.1.1 / 3.1.2 / 3.1.3 —
  <https://developer.apple.com/app-store/review/guidelines/>
- **[apple-pricepoints]** Apple — List all price points for an in-app purchase —
  <https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-pricepoints>
- Apple — App Store Small Business Program —
  <https://developer.apple.com/app-store/small-business-program/>
- **[play-pricing]** Google — Set up your app's prices (Play Console Help) —
  <https://support.google.com/googleplay/android-developer/answer/6334373>

[rc-events]: https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
[rc-webhooks]: https://www.revenuecat.com/docs/integrations/webhooks
[rc-ids]: https://www.revenuecat.com/docs/customers/identifying-customers
[rc-restoring]: https://www.revenuecat.com/docs/getting-started/restoring-purchases
[rc-restore]: https://www.revenuecat.com/docs/projects/restore-behavior
[asrg]: https://developer.apple.com/app-store/review/guidelines/
[apple-pricepoints]: https://developer.apple.com/documentation/appstoreconnectapi/get-v2-inapppurchases-_id_-pricepoints
[play-pricing]: https://support.google.com/googleplay/android-developer/answer/6334373
