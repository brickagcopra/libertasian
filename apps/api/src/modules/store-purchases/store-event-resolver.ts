/**
 * The §4 resolver: `(event, current state) → action`.
 *
 * THE CENTRAL POINT: this is NOT `event → action`. RevenueCat says the same
 * event means different things depending on where the subscription is — most
 * sharply, `RENEWAL` covers both "renewed" and "a lapsed user resubscribed" —
 * and our machine has different legal transitions from each state. A flat
 * lookup table would be wrong, and would throw `BadRequestException` out of
 * `executeTransition` on the states it got wrong.
 *
 * Pure: no DI, no I/O, no clock. Every branch is a row of §4.1 or a finding of
 * §4.2, cited by number so the table and the code can be diffed against each
 * other.
 *
 * NOT ONE NEW STATE, NOT ONE NEW ACTION is added to the shared machine. Where
 * nothing in the existing vocabulary fits, this returns a `noop` carrying the
 * reason — reported, not papered over with a new transition that would change
 * semantics for the Xendit path too.
 */

import {
  ACCESSIBLE_STATES,
  isValidTransition,
  SubscriptionAction,
  SubscriptionState,
} from '../subscriptions/subscription-state-machine';
import type { StoreEventType, StorePeriodType } from './store-purchase-provider.interface';

// ---- Resolution vocabulary ----

/**
 * Why a resolution was a no-op.
 *
 * These do NOT go to `store_webhook_events.processing_error` — a no-op is a
 * correct outcome, not an error. They are logged and stamped into
 * `metadata_json` so that "nothing happened, on purpose" is observable rather
 * than indistinguishable from "nothing ran".
 */
export type StoreNoopReason =
  | 'idempotent_replay' // §4.1 row 3
  | 'cancellation_during_trial' // §4.2 (a)
  | 'billing_error_owned_by_expiration' // §4.2 (b)
  | 'billing_issue_already_recorded' // §4.2 (c)
  | 'billing_issue_during_trial' // §4.1 row 22
  | 'uncancellation_during_trial' // §4.1 row 19
  | 'already_terminal' // §4.1 row 25
  | 'nothing_was_revoked' // §4.1 row 27
  | 'pause_deferred_to_expiration' // §4.2 (e) / D9
  | 'temporary_grant_never_creates' // §4.1 row 32
  | 'informational' // §4.1 row 33
  | 'no_subscription_for_event'
  | 'no_legal_transition'
  | 'unknown_event';

export type StoreResolution =
  /** Create the row in `provisioning`, then run `action` (§4.1 rows 1–2). */
  | { kind: 'create'; action: SubscriptionAction.ACTIVATE | SubscriptionAction.START_TRIAL }
  /** Run `action` against the existing row. */
  | { kind: 'transition'; action: SubscriptionAction }
  /** Move `currentPeriodEnd` / `expires_at` only — no state change (§4.1 rows 30, 32). */
  | { kind: 'extend_period' }
  /** Record `pending_product_id`; the next RENEWAL applies it (D8). */
  | { kind: 'record_pending_product' }
  /** Revoke on the losing org, grant on the gaining one (§5.3). */
  | { kind: 'transfer' }
  | { kind: 'noop'; reason: StoreNoopReason };

const noop = (reason: StoreNoopReason): StoreResolution => ({ kind: 'noop', reason });
const go = (action: SubscriptionAction): StoreResolution => ({ kind: 'transition', action });

/**
 * Imported, never copied. `ACCESSIBLE_STATES` is the single source of truth for
 * "this subscription still grants its plan_code", and its own comment says: do
 * not copy this list.
 */
const isAccessible = (state: SubscriptionState): boolean => ACCESSIBLE_STATES.has(state);

// ---- Cancel reasons (RevenueCat vocabulary, upper-cased on parse) ----

/**
 * The reasons that mean "the user turned auto-renew off". Access continues to
 * `currentPeriodEnd` — the store does not refund the current period, so
 * revoking early would take away something already paid for.
 *
 * `UNKNOWN` is in here deliberately and conservatively: keep access until
 * `EXPIRATION` says otherwise, because `EXPIRATION` is the definitive signal.
 */
export const AUTO_RENEW_OFF_REASONS = new Set([
  'UNSUBSCRIBE',
  'PRICE_INCREASE',
  'DEVELOPER_INITIATED',
  'UNKNOWN',
]);

/** The refund path. RevenueCat: "Customer received a refund from Apple support…" */
export const REFUND_CANCEL_REASON = 'CUSTOMER_SUPPORT';

/**
 * Overlaps `BILLING_ISSUE` — RevenueCat lists `BILLING_ERROR` under BOTH
 * `CANCELLATION` and `EXPIRATION` reasons. Treating it as a cancellation would
 * move an already-`past_due` row into `cancelling` on the way to `cancelled`,
 * double-driving one real-world event from two directions.
 */
export const BILLING_ERROR_CANCEL_REASON = 'BILLING_ERROR';

// ---- Input ----

export interface StoreEventResolutionInput {
  type: StoreEventType;
  /** `null` when the org holds no store subscription row yet. */
  currentState: SubscriptionState | null;
  periodType: StorePeriodType | null;
  cancelReason: string | null;
}

// ---- The resolver ----

export function resolveStoreEvent(input: StoreEventResolutionInput): StoreResolution {
  const { type, currentState, periodType, cancelReason } = input;

  switch (type) {
    case 'purchase.initial':
      return resolveInitialPurchase(currentState, periodType);

    case 'purchase.renewed':
      return resolveRenewal(currentState);

    // One RevenueCat event name (`CANCELLATION`) covers both a cancellation and
    // a refund, which is exactly why this branches on `cancel_reason` rather
    // than on the event name.
    case 'purchase.cancelled':
    case 'purchase.refunded':
      return resolveCancellation(currentState, cancelReason);

    case 'purchase.uncancelled':
      return resolveUncancellation(currentState);

    case 'purchase.billing_issue':
      return resolveBillingIssue(currentState);

    case 'purchase.expired':
      return resolveExpiration(currentState);

    case 'purchase.refund_reversed':
      return resolveRefundReversed(currentState);

    // §4.1 row 28 / §4.2 (d) / D8 — PRODUCT_CHANGE has no honest transition.
    // UPGRADE/DOWNGRADE both go to MIGRATING and declare PRORATE_PAYMENT and
    // CREATE_MIGRATION_RECORD; the store already prorated (or deferred) and we
    // hold no money to prorate with, so SubscriptionMigration rows would carry
    // fabricated centavo amounts into the accounting tables. And MIGRATING,
    // while accessible, is a state nothing on this path would move it out of.
    //
    // Deferring is also the CORRECT behaviour now that two plans are sold: on
    // both stores an edu ↔ pro change takes effect at the next renewal, so the
    // user has not yet paid for the new plan when the event arrives.
    case 'purchase.product_changed':
      return { kind: 'record_pending_product' };

    // §4.1 row 29 / §4.2 (e) / D9 — SUBSCRIPTION_PAUSED is worse than
    // redundant. RevenueCat: the subscription "was scheduled to pause AT THE
    // END OF THE CURRENT PERIOD". Our PAUSE action moves to SUSPENDED, which is
    // NOT in ACCESSIBLE_STATES — acting on it would revoke a paid-through
    // user's access days or weeks early. The later EXPIRATION does the work.
    case 'purchase.paused':
      return noop('pause_deferred_to_expiration');

    // §4.1 row 30 — SUBSCRIPTION_EXTENDED. Period fields only, no transition.
    case 'purchase.extended':
      return currentState !== null && isAccessible(currentState)
        ? { kind: 'extend_period' }
        : noop('no_subscription_for_event');

    // §4.1 row 31 / §5.3
    case 'purchase.transferred':
      return { kind: 'transfer' };

    // §4.1 row 32 — TEMPORARY_ENTITLEMENT_GRANT is RevenueCat covering its own
    // outage. Extend if already accessible; NEVER create a subscription from
    // it — it is not evidence of a purchase.
    case 'purchase.temporary_grant':
      return currentState !== null && isAccessible(currentState)
        ? { kind: 'extend_period' }
        : noop('temporary_grant_never_creates');

    // §4.1 row 33 — NON_RENEWING_PURCHASE, INVOICE_ISSUANCE, PURCHASE_REDEEMED,
    // PRICE_INCREASE_CONSENT_*, EXPERIMENT_ENROLLMENT,
    // VIRTUAL_CURRENCY_TRANSACTION, SUBSCRIBER_ALIAS, TEST. We sell no
    // consumables and run no experiments, so if one of these ever appears in
    // production it is a signal — the caller alerts rather than ignoring it
    // silently.
    case 'informational':
      return noop('informational');

    case 'unknown':
    default:
      return noop('unknown_event');
  }
}

// ---- Per-event branches ----

function resolveInitialPurchase(
  currentState: SubscriptionState | null,
  periodType: StorePeriodType | null,
): StoreResolution {
  // §4.1 row 3 — idempotent replay against an already-granted subscription.
  if (currentState !== null && isAccessible(currentState)) {
    return noop('idempotent_replay');
  }

  // §4.1 row 2 — a store free trial. `trialing` ∈ ACCESSIBLE_STATES, so
  // entitlement holds. Schedules `trial_expiry` — see finding (f), which the
  // caller implements by stamping `trialEnd` at expiresAt + 24h so the store's
  // own event always wins.
  if (periodType === 'TRIAL') {
    return { kind: 'create', action: SubscriptionAction.START_TRIAL };
  }

  // §4.1 row 1 — an ordinary paid purchase. `planCode` is resolved from the
  // product id ('pro' or 'edu'), never assumed.
  //
  // §4.1 row 4 (a web subscription is already accessible) is NOT a different
  // resolution: the doc's instruction is "honour the store purchase", i.e. this
  // same create-and-activate, plus a REQUEST_CANCEL on the WEB row. That second
  // half is a different subscription and therefore the caller's job — see
  // StorePurchasesService.enforceDoubleBillingGuard (§6.1).
  return { kind: 'create', action: SubscriptionAction.ACTIVATE };
}

function resolveRenewal(currentState: SubscriptionState | null): StoreResolution {
  if (currentState === null) {
    // A renewal for a subscription we never recorded. The §9 pull path repairs
    // this; inventing a row from a RENEWAL would have to guess `purchasedAt`
    // and the original transaction id.
    return noop('no_subscription_for_event');
  }

  switch (currentState) {
    // §4.1 row 5 — resets quotas, reschedules renewal.
    case SubscriptionState.ACTIVE:
    // §4.1 row 6 — the store recovered the charge.
    case SubscriptionState.PAST_DUE:
    // §4.1 row 7
    case SubscriptionState.GRACE_PERIOD:
      return go(SubscriptionAction.RENEW);

    // §4.1 row 8 — trial converted. `period_type` is NORMAL on this event.
    case SubscriptionState.TRIALING:
      return go(SubscriptionAction.CONVERT_TRIAL);

    // §4.1 row 9 — auto-renew was re-enabled without an UNCANCELLATION
    // reaching us.
    //
    // DELIBERATE DIVERGENCE FROM §4.1's ACTION NAME. The table names `RENEW`,
    // but `CANCELLING + RENEW` is not a defined transition in
    // subscription-state-machine.ts — the only action from CANCELLING to ACTIVE
    // is UNDO_CANCEL. Calling RENEW here would throw BadRequestException out of
    // executeTransition, 500 the webhook, and burn the conduit's five retries
    // over ~155 minutes on an event that can never succeed.
    //
    // UNDO_CANCEL reaches the RESULTING STATE the table specifies (`active`)
    // and additionally clears `cancelAtPeriodEnd`, which is precisely what
    // "auto-renew was re-enabled" means. The row's contract is honoured; its
    // action name is not, because that name does not exist from this state.
    //
    // UNDO_CANCEL guards on `currentPeriodEnd` not having passed, so the caller
    // MUST write the event's new period end BEFORE running it. See
    // StorePurchasesService.applyPeriodFromEvent.
    case SubscriptionState.CANCELLING:
      return go(SubscriptionAction.UNDO_CANCEL);

    // §4.1 row 10 — the "lapsed user resubscribed" case. RENEW is illegal from
    // CANCELLED.
    case SubscriptionState.CANCELLED:
      return go(SubscriptionAction.REACTIVATE);

    // §4.1 row 11 — RENEW is illegal from EXPIRED.
    case SubscriptionState.EXPIRED:
    // §4.1 row 12
    case SubscriptionState.TRIAL_EXPIRED:
      return go(SubscriptionAction.ACTIVATE);

    default:
      return noop('no_legal_transition');
  }
}

function resolveCancellation(
  currentState: SubscriptionState | null,
  cancelReason: string | null,
): StoreResolution {
  if (currentState === null) {
    return noop('no_subscription_for_event');
  }

  const reason = (cancelReason ?? 'UNKNOWN').toUpperCase();

  // §4.1 row 16 / §4.2 (b) — BILLING_ISSUE and EXPIRATION own that lifecycle.
  if (reason === BILLING_ERROR_CANCEL_REASON) {
    return noop('billing_error_owned_by_expiration');
  }

  // §4.1 row 15 — the refund path (§8). Applies from ANY accessible state.
  if (reason === REFUND_CANCEL_REASON) {
    return isAccessible(currentState) &&
      isValidTransition(currentState, SubscriptionAction.CANCEL_IMMEDIATELY)
      ? go(SubscriptionAction.CANCEL_IMMEDIATELY)
      : noop('no_legal_transition');
  }

  if (AUTO_RENEW_OFF_REASONS.has(reason)) {
    // §4.1 row 14 / §4.2 (a) — CANCELLATION while `trialing` has NO legal
    // transition. REQUEST_CANCEL is defined only from ACTIVE, and cancelling
    // during a free trial is the single most common cancellation there is, so
    // this would fire constantly and 500 every time. The `trial_expiry`
    // scheduled event and the eventual EXPIRATION both land on
    // EXPIRE_TRIAL → trial_expired, which is the right outcome. The caller
    // records `metadata_json.auto_renew = false` on the store_purchases row.
    if (currentState === SubscriptionState.TRIALING) {
      return noop('cancellation_during_trial');
    }

    // §4.1 rows 13 and 17 — `cancelling` ∈ ACCESSIBLE_STATES, so access runs to
    // `currentPeriodEnd`, which is correct: the store does not refund the
    // current period.
    if (currentState === SubscriptionState.ACTIVE) {
      return go(SubscriptionAction.REQUEST_CANCEL);
    }

    // REQUEST_CANCEL is defined ONLY from ACTIVE. From past_due, grace_period
    // or an already-`cancelling` row there is nothing legal to do, and
    // EXPIRATION remains the definitive end of access.
    return noop('no_legal_transition');
  }

  return noop('no_legal_transition');
}

function resolveUncancellation(currentState: SubscriptionState | null): StoreResolution {
  // §4.1 row 18
  if (currentState === SubscriptionState.CANCELLING) {
    return go(SubscriptionAction.UNDO_CANCEL);
  }
  // §4.1 row 19 — consistent with finding (a): we never left `trialing`, so
  // there is nothing to undo.
  if (currentState === SubscriptionState.TRIALING) {
    return noop('uncancellation_during_trial');
  }
  if (currentState === null) {
    return noop('no_subscription_for_event');
  }
  return noop('no_legal_transition');
}

function resolveBillingIssue(currentState: SubscriptionState | null): StoreResolution {
  // §4.1 row 20 — `past_due` ∈ ACCESSIBLE_STATES, so access continues, matching
  // the stores' own billing retry. RevenueCat: "This doesn't mean the
  // subscription has expired."
  if (currentState === SubscriptionState.ACTIVE) {
    return go(SubscriptionAction.PAYMENT_FAILED);
  }
  // §4.1 row 21 / §4.2 (c) — PAYMENT_FAILED is defined only from ACTIVE. The
  // stores retry a failed charge several times and emit BILLING_ISSUE each
  // time. No-op after the first. This is the machine being correct, not
  // incomplete.
  if (
    currentState === SubscriptionState.PAST_DUE ||
    currentState === SubscriptionState.GRACE_PERIOD
  ) {
    return noop('billing_issue_already_recorded');
  }
  // §4.1 row 22 — a trial has no charge to fail; informational.
  if (currentState === SubscriptionState.TRIALING) {
    return noop('billing_issue_during_trial');
  }
  if (currentState === null) {
    return noop('no_subscription_for_event');
  }
  return noop('no_legal_transition');
}

function resolveExpiration(currentState: SubscriptionState | null): StoreResolution {
  if (currentState === null) {
    return noop('no_subscription_for_event');
  }

  // §4.1 row 23 — `trial_expired` is not accessible, so entitlement drops.
  if (currentState === SubscriptionState.TRIALING) {
    return go(SubscriptionAction.EXPIRE_TRIAL);
  }

  // §4.1 row 25 — already terminal. The same guard `handlePlanDeactivated`
  // uses.
  if (
    currentState === SubscriptionState.CANCELLED ||
    currentState === SubscriptionState.EXPIRED ||
    currentState === SubscriptionState.TRIAL_EXPIRED
  ) {
    return noop('already_terminal');
  }

  // §4.1 row 24 — active / past_due / grace_period / cancelling. Mirrors
  // handlePlanDeactivated exactly: transition → createFreeFallback →
  // invalidateEntitlementCache → cancelPendingRenewalReminders.
  return isValidTransition(currentState, SubscriptionAction.CANCEL_IMMEDIATELY)
    ? go(SubscriptionAction.CANCEL_IMMEDIATELY)
    : noop('no_legal_transition');
}

function resolveRefundReversed(currentState: SubscriptionState | null): StoreResolution {
  // §4.1 row 26 — reverses the clawback (§8).
  if (currentState === SubscriptionState.CANCELLED) {
    return go(SubscriptionAction.REACTIVATE);
  }
  // §4.1 row 27 — nothing was revoked.
  if (currentState !== null && isAccessible(currentState)) {
    return noop('nothing_was_revoked');
  }
  if (currentState === null) {
    return noop('no_subscription_for_event');
  }
  return noop('no_legal_transition');
}
