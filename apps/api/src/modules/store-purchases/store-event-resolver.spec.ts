/**
 * §4.1 and §4.2, transcribed.
 *
 * EVERY row of the design's §4.1 mapping table is a case in `SECTION_4_1_ROWS`
 * below, and every case asserts the RESULTING STATE, not just the action —
 * because the resulting state is what the table actually promises and what the
 * user experiences. Asserting only the action would let a wrong-but-legal
 * transition pass.
 *
 * EVERY finding in §4.2 is a case in `SECTION_4_2_FINDINGS`, asserting the
 * NO-OP. That is the point of those tests: an event with no legal transition
 * must not silently fall through to some default. A no-op that quietly became a
 * transition, or a transition that quietly became a 500, are both regressions
 * these tests exist to catch.
 *
 * The resolver is pure, so this file needs no DI, no database and no clock.
 */

import {
  getNextState,
  SubscriptionAction,
  SubscriptionState,
} from '../subscriptions/subscription-state-machine';
import { resolveStoreEvent, type StoreNoopReason } from './store-event-resolver';
import type { StoreEventType, StorePeriodType } from './store-purchase-provider.interface';

interface Row {
  /** §4.1 row number, in document order. */
  row: number;
  /** The RevenueCat event name, for readability against the doc. */
  rcEvent: string;
  type: StoreEventType;
  from: SubscriptionState | null;
  periodType?: StorePeriodType | null;
  cancelReason?: string | null;
  /** The action the resolver must choose, or `null` for a documented no-op. */
  action: SubscriptionAction | null;
  /** The state §4.1's "Resulting state" column promises. */
  resultingState: SubscriptionState | null;
  /** For rows whose resolution is not a plain transition. */
  kind?: 'create' | 'transition' | 'extend_period' | 'record_pending_product' | 'transfer' | 'noop';
  noopReason?: StoreNoopReason;
  note?: string;
}

const S = SubscriptionState;
const A = SubscriptionAction;

// ==========================================================================
// §4.1 — the mapping, row by row
// ==========================================================================

const SECTION_4_1_ROWS: Row[] = [
  // ---- INITIAL_PURCHASE ----
  {
    row: 1,
    rcEvent: 'INITIAL_PURCHASE (period_type != TRIAL)',
    type: 'purchase.initial',
    from: null,
    periodType: 'NORMAL',
    kind: 'create',
    action: A.ACTIVATE,
    resultingState: S.ACTIVE,
  },
  {
    row: 2,
    rcEvent: 'INITIAL_PURCHASE (period_type == TRIAL)',
    type: 'purchase.initial',
    from: null,
    periodType: 'TRIAL',
    kind: 'create',
    action: A.START_TRIAL,
    resultingState: S.TRIALING,
  },
  {
    row: 3,
    rcEvent: 'INITIAL_PURCHASE (already active)',
    type: 'purchase.initial',
    from: S.ACTIVE,
    periodType: 'NORMAL',
    kind: 'noop',
    action: null,
    resultingState: S.ACTIVE,
    noopReason: 'idempotent_replay',
  },
  {
    row: 3,
    rcEvent: 'INITIAL_PURCHASE (already trialing)',
    type: 'purchase.initial',
    from: S.TRIALING,
    periodType: 'TRIAL',
    kind: 'noop',
    action: null,
    resultingState: S.TRIALING,
    noopReason: 'idempotent_replay',
  },
  {
    // Row 4's store-side half. "Honour the store purchase" IS row 1's
    // create-and-activate; the REQUEST_CANCEL of the WEB subscription is a
    // different subscription and therefore the service's job — asserted in
    // store-purchases.service.spec.ts.
    row: 4,
    rcEvent: 'INITIAL_PURCHASE (a web sub is accessible)',
    type: 'purchase.initial',
    from: null,
    periodType: 'NORMAL',
    kind: 'create',
    action: A.ACTIVATE,
    resultingState: S.ACTIVE,
    note: 'honour + cancel web — the web half lives in the service',
  },

  // ---- RENEWAL ----
  {
    row: 5,
    rcEvent: 'RENEWAL',
    type: 'purchase.renewed',
    from: S.ACTIVE,
    action: A.RENEW,
    resultingState: S.ACTIVE,
  },
  {
    row: 6,
    rcEvent: 'RENEWAL (store recovered the charge)',
    type: 'purchase.renewed',
    from: S.PAST_DUE,
    action: A.RENEW,
    resultingState: S.ACTIVE,
  },
  {
    row: 7,
    rcEvent: 'RENEWAL',
    type: 'purchase.renewed',
    from: S.GRACE_PERIOD,
    action: A.RENEW,
    resultingState: S.ACTIVE,
  },
  {
    row: 8,
    rcEvent: 'RENEWAL (trial converted)',
    type: 'purchase.renewed',
    from: S.TRIALING,
    action: A.CONVERT_TRIAL,
    resultingState: S.ACTIVE,
  },
  {
    // The doc names RENEW; CANCELLING + RENEW is not a defined transition, so
    // the resolver uses UNDO_CANCEL. The row's CONTRACT — resulting state
    // `active` — is what this asserts, and it holds either way.
    row: 9,
    rcEvent: 'RENEWAL (auto-renew re-enabled, no UNCANCELLATION)',
    type: 'purchase.renewed',
    from: S.CANCELLING,
    action: A.UNDO_CANCEL,
    resultingState: S.ACTIVE,
    note: 'doc says RENEW; CANCELLING+RENEW is illegal — UNDO_CANCEL reaches the same state',
  },
  {
    row: 10,
    rcEvent: 'RENEWAL (lapsed user resubscribed)',
    type: 'purchase.renewed',
    from: S.CANCELLED,
    action: A.REACTIVATE,
    resultingState: S.ACTIVE,
  },
  {
    row: 11,
    rcEvent: 'RENEWAL',
    type: 'purchase.renewed',
    from: S.EXPIRED,
    action: A.ACTIVATE,
    resultingState: S.ACTIVE,
  },
  {
    row: 12,
    rcEvent: 'RENEWAL',
    type: 'purchase.renewed',
    from: S.TRIAL_EXPIRED,
    action: A.ACTIVATE,
    resultingState: S.ACTIVE,
  },

  // ---- CANCELLATION ----
  ...(['UNSUBSCRIBE', 'PRICE_INCREASE', 'DEVELOPER_INITIATED'] as const).map(
    (cancelReason): Row => ({
      row: 13,
      rcEvent: `CANCELLATION (${cancelReason})`,
      type: 'purchase.cancelled',
      from: S.ACTIVE,
      cancelReason,
      action: A.REQUEST_CANCEL,
      resultingState: S.CANCELLING,
    }),
  ),
  {
    row: 14,
    rcEvent: 'CANCELLATION (UNSUBSCRIBE) while trialing',
    type: 'purchase.cancelled',
    from: S.TRIALING,
    cancelReason: 'UNSUBSCRIBE',
    kind: 'noop',
    action: null,
    resultingState: S.TRIALING,
    noopReason: 'cancellation_during_trial',
  },
  ...([S.ACTIVE, S.TRIALING, S.PAST_DUE, S.GRACE_PERIOD, S.CANCELLING] as const).map(
    (from): Row => ({
      row: 15,
      rcEvent: 'CANCELLATION (CUSTOMER_SUPPORT) — the refund path',
      type: 'purchase.cancelled',
      from,
      cancelReason: 'CUSTOMER_SUPPORT',
      action: A.CANCEL_IMMEDIATELY,
      resultingState: S.CANCELLED,
    }),
  ),
  ...([S.ACTIVE, S.PAST_DUE, S.GRACE_PERIOD, S.TRIALING] as const).map(
    (from): Row => ({
      row: 16,
      rcEvent: 'CANCELLATION (BILLING_ERROR)',
      type: 'purchase.cancelled',
      from,
      cancelReason: 'BILLING_ERROR',
      kind: 'noop',
      action: null,
      resultingState: from,
      noopReason: 'billing_error_owned_by_expiration',
    }),
  ),
  {
    row: 17,
    rcEvent: 'CANCELLATION (UNKNOWN)',
    type: 'purchase.cancelled',
    from: S.ACTIVE,
    cancelReason: 'UNKNOWN',
    action: A.REQUEST_CANCEL,
    resultingState: S.CANCELLING,
  },

  // ---- UNCANCELLATION ----
  {
    row: 18,
    rcEvent: 'UNCANCELLATION',
    type: 'purchase.uncancelled',
    from: S.CANCELLING,
    action: A.UNDO_CANCEL,
    resultingState: S.ACTIVE,
  },
  {
    row: 19,
    rcEvent: 'UNCANCELLATION while trialing',
    type: 'purchase.uncancelled',
    from: S.TRIALING,
    kind: 'noop',
    action: null,
    resultingState: S.TRIALING,
    noopReason: 'uncancellation_during_trial',
  },

  // ---- BILLING_ISSUE ----
  {
    row: 20,
    rcEvent: 'BILLING_ISSUE',
    type: 'purchase.billing_issue',
    from: S.ACTIVE,
    action: A.PAYMENT_FAILED,
    resultingState: S.PAST_DUE,
  },
  ...([S.PAST_DUE, S.GRACE_PERIOD] as const).map(
    (from): Row => ({
      row: 21,
      rcEvent: 'BILLING_ISSUE (repeat)',
      type: 'purchase.billing_issue',
      from,
      kind: 'noop',
      action: null,
      resultingState: from,
      noopReason: 'billing_issue_already_recorded',
    }),
  ),
  {
    row: 22,
    rcEvent: 'BILLING_ISSUE while trialing',
    type: 'purchase.billing_issue',
    from: S.TRIALING,
    kind: 'noop',
    action: null,
    resultingState: S.TRIALING,
    noopReason: 'billing_issue_during_trial',
  },

  // ---- EXPIRATION ----
  {
    row: 23,
    rcEvent: 'EXPIRATION while trialing',
    type: 'purchase.expired',
    from: S.TRIALING,
    action: A.EXPIRE_TRIAL,
    resultingState: S.TRIAL_EXPIRED,
  },
  ...([S.ACTIVE, S.PAST_DUE, S.GRACE_PERIOD, S.CANCELLING] as const).map(
    (from): Row => ({
      row: 24,
      rcEvent: 'EXPIRATION',
      type: 'purchase.expired',
      from,
      action: A.CANCEL_IMMEDIATELY,
      resultingState: S.CANCELLED,
    }),
  ),
  ...([S.CANCELLED, S.EXPIRED, S.TRIAL_EXPIRED] as const).map(
    (from): Row => ({
      row: 25,
      rcEvent: 'EXPIRATION (already terminal)',
      type: 'purchase.expired',
      from,
      kind: 'noop',
      action: null,
      resultingState: from,
      noopReason: 'already_terminal',
    }),
  ),

  // ---- REFUND_REVERSED ----
  {
    row: 26,
    rcEvent: 'REFUND_REVERSED',
    type: 'purchase.refund_reversed',
    from: S.CANCELLED,
    action: A.REACTIVATE,
    resultingState: S.ACTIVE,
  },
  {
    row: 27,
    rcEvent: 'REFUND_REVERSED (nothing was revoked)',
    type: 'purchase.refund_reversed',
    from: S.ACTIVE,
    kind: 'noop',
    action: null,
    resultingState: S.ACTIVE,
    noopReason: 'nothing_was_revoked',
  },

  // ---- PRODUCT_CHANGE / PAUSED / EXTENDED / TRANSFER / TEMPORARY ----
  {
    row: 28,
    rcEvent: 'PRODUCT_CHANGE',
    type: 'purchase.product_changed',
    from: S.ACTIVE,
    kind: 'record_pending_product',
    action: null,
    resultingState: S.ACTIVE,
  },
  {
    row: 29,
    rcEvent: 'SUBSCRIPTION_PAUSED',
    type: 'purchase.paused',
    from: S.ACTIVE,
    kind: 'noop',
    action: null,
    resultingState: S.ACTIVE,
    noopReason: 'pause_deferred_to_expiration',
  },
  {
    row: 30,
    rcEvent: 'SUBSCRIPTION_EXTENDED',
    type: 'purchase.extended',
    from: S.ACTIVE,
    kind: 'extend_period',
    action: null,
    resultingState: S.ACTIVE,
  },
  {
    row: 31,
    rcEvent: 'TRANSFER',
    type: 'purchase.transferred',
    from: S.ACTIVE,
    kind: 'transfer',
    action: null,
    resultingState: S.ACTIVE,
  },
  {
    row: 32,
    rcEvent: 'TEMPORARY_ENTITLEMENT_GRANT (already accessible)',
    type: 'purchase.temporary_grant',
    from: S.ACTIVE,
    kind: 'extend_period',
    action: null,
    resultingState: S.ACTIVE,
  },
  {
    row: 32,
    rcEvent: 'TEMPORARY_ENTITLEMENT_GRANT (no subscription)',
    type: 'purchase.temporary_grant',
    from: null,
    kind: 'noop',
    action: null,
    resultingState: null,
    noopReason: 'temporary_grant_never_creates',
    note: 'never creates a subscription — it is not evidence of a purchase',
  },
  {
    row: 33,
    rcEvent: 'TEST / EXPERIMENT_ENROLLMENT / SUBSCRIBER_ALIAS / …',
    type: 'informational',
    from: S.ACTIVE,
    kind: 'noop',
    action: null,
    resultingState: S.ACTIVE,
    noopReason: 'informational',
  },
];

/** Distinct §4.1 rows this file covers, for the PR body's count. */
export const SECTION_4_1_ROW_NUMBERS = [...new Set(SECTION_4_1_ROWS.map((r) => r.row))].sort(
  (a, b) => a - b,
);

describe('§4.1 — the (event, current state) → action mapping', () => {
  it.each(SECTION_4_1_ROWS)(
    'row $row: $rcEvent from $from → $resultingState',
    ({ type, from, periodType, cancelReason, kind, action, resultingState, noopReason }) => {
      const resolution = resolveStoreEvent({
        type,
        currentState: from,
        periodType: periodType ?? null,
        cancelReason: cancelReason ?? null,
      });

      const expectedKind = kind ?? 'transition';
      expect(resolution.kind).toBe(expectedKind);

      if (resolution.kind === 'noop') {
        expect(resolution.reason).toBe(noopReason);
        return;
      }

      if (resolution.kind === 'create' || resolution.kind === 'transition') {
        expect(resolution.action).toBe(action);

        // THE ASSERTION THAT MATTERS: the state machine, given this action from
        // this state, actually lands where §4.1's "Resulting state" column says.
        // A `create` starts from PROVISIONING, which is where the service puts
        // the new row before transitioning it.
        const startState = resolution.kind === 'create' ? S.PROVISIONING : (from as SubscriptionState);
        expect(getNextState(startState, resolution.action)).toBe(resultingState);
      }
    },
  );

  it('covers all 33 rows of the §4.1 table', () => {
    // The table has 33 rows. If a row is added to the design, this fails until
    // the row is added here too — which is the point.
    expect(SECTION_4_1_ROW_NUMBERS).toEqual(
      Array.from({ length: 33 }, (_, i) => i + 1),
    );
  });

  it('never chooses an action the shared state machine would refuse', () => {
    // The failure mode §4 exists to prevent: a flat lookup table would pick an
    // action that is illegal from the current state, executeTransition would
    // throw BadRequestException, the webhook would 500, and the conduit would
    // burn five retries over ~155 minutes before giving up. Not one row may do
    // that.
    for (const row of SECTION_4_1_ROWS) {
      const resolution = resolveStoreEvent({
        type: row.type,
        currentState: row.from,
        periodType: row.periodType ?? null,
        cancelReason: row.cancelReason ?? null,
      });
      if (resolution.kind !== 'transition') continue;
      expect({
        row: row.row,
        from: row.from,
        next: getNextState(row.from as SubscriptionState, resolution.action),
      }).toEqual({ row: row.row, from: row.from, next: row.resultingState });
    }
  });
});

// ==========================================================================
// §4.2 — the findings. Each asserts the NO-OP.
// ==========================================================================

interface Finding {
  finding: string;
  why: string;
  type: StoreEventType;
  from: SubscriptionState;
  cancelReason?: string;
  noopReason: StoreNoopReason;
  /** The action a naive `event → action` table would have chosen. */
  naiveAction: SubscriptionAction;
}

const SECTION_4_2_FINDINGS: Finding[] = [
  {
    finding: '(a)',
    why: 'CANCELLATION while trialing has no legal transition — REQUEST_CANCEL is defined only from ACTIVE',
    type: 'purchase.cancelled',
    from: S.TRIALING,
    cancelReason: 'UNSUBSCRIBE',
    noopReason: 'cancellation_during_trial',
    naiveAction: A.REQUEST_CANCEL,
  },
  {
    finding: '(b)',
    why: 'CANCELLATION/BILLING_ERROR overlaps BILLING_ISSUE; acting on both double-drives one real event',
    type: 'purchase.cancelled',
    from: S.PAST_DUE,
    cancelReason: 'BILLING_ERROR',
    noopReason: 'billing_error_owned_by_expiration',
    naiveAction: A.REQUEST_CANCEL,
  },
  {
    finding: '(c)',
    why: 'BILLING_ISSUE from past_due has no transition — PAYMENT_FAILED is defined only from ACTIVE',
    type: 'purchase.billing_issue',
    from: S.PAST_DUE,
    noopReason: 'billing_issue_already_recorded',
    naiveAction: A.PAYMENT_FAILED,
  },
  {
    finding: '(d)',
    why: 'PRODUCT_CHANGE has no honest transition — UPGRADE/DOWNGRADE declare money side effects we hold no money for',
    type: 'purchase.product_changed',
    from: S.ACTIVE,
    noopReason: 'no_legal_transition', // unused: asserted as record_pending_product below
    naiveAction: A.UPGRADE,
  },
  {
    finding: '(e)',
    why: 'SUBSCRIPTION_PAUSED has a transition that is actively harmful — PAUSE → SUSPENDED, which is NOT accessible',
    type: 'purchase.paused',
    from: S.ACTIVE,
    noopReason: 'pause_deferred_to_expiration',
    naiveAction: A.PAUSE,
  },
];

describe('§4.2 — events with no legal transition are deliberate no-ops', () => {
  it.each(SECTION_4_2_FINDINGS.filter((f) => f.finding !== '(d)'))(
    'finding $finding: $why',
    ({ type, from, cancelReason, noopReason }) => {
      const resolution = resolveStoreEvent({
        type,
        currentState: from,
        periodType: null,
        cancelReason: cancelReason ?? null,
      });
      expect(resolution).toEqual({ kind: 'noop', reason: noopReason });
    },
  );

  it('finding (d): PRODUCT_CHANGE records the pending product and transitions nothing', () => {
    // Not a bare no-op — the new product id must survive to the next RENEWAL,
    // which is what makes the deferral correct rather than lossy. But it is
    // emphatically NOT a state change: on an edu → pro change the subscriber
    // keeps edu entitlements until the change actually takes effect and is
    // paid for.
    for (const from of [S.ACTIVE, S.TRIALING, S.PAST_DUE, S.CANCELLING, S.GRACE_PERIOD]) {
      const resolution = resolveStoreEvent({
        type: 'purchase.product_changed',
        currentState: from,
        periodType: null,
        cancelReason: null,
      });
      expect(resolution).toEqual({ kind: 'record_pending_product' });
    }
  });

  it('never returns the action a naive event→action table would have chosen', () => {
    // The regression this guards: someone "simplifies" the resolver into a flat
    // lookup and every finding turns back into a 500.
    for (const finding of SECTION_4_2_FINDINGS) {
      const resolution = resolveStoreEvent({
        type: finding.type,
        currentState: finding.from,
        periodType: null,
        cancelReason: finding.cancelReason ?? null,
      });
      if (resolution.kind === 'transition' || resolution.kind === 'create') {
        expect(resolution.action).not.toBe(finding.naiveAction);
      }
    }
  });

  it('finding (e): PAUSE would revoke a paid-through user, and SUSPENDED is not accessible', () => {
    // The assertion behind D9's "worse than redundant": if the resolver ever
    // did return PAUSE, this is the damage.
    expect(getNextState(S.ACTIVE, A.PAUSE)).toBe(S.SUSPENDED);
    const resolution = resolveStoreEvent({
      type: 'purchase.paused',
      currentState: S.ACTIVE,
      periodType: null,
      cancelReason: null,
    });
    expect(resolution).toEqual({ kind: 'noop', reason: 'pause_deferred_to_expiration' });
  });
});

// ==========================================================================
// Boundaries the table implies but does not enumerate
// ==========================================================================

describe('resolver boundaries', () => {
  it('never acts on an event for an org with no store subscription', () => {
    const eventsNeedingASubscription: StoreEventType[] = [
      'purchase.renewed',
      'purchase.cancelled',
      'purchase.uncancelled',
      'purchase.billing_issue',
      'purchase.expired',
      'purchase.refund_reversed',
      'purchase.extended',
    ];
    for (const type of eventsNeedingASubscription) {
      expect(
        resolveStoreEvent({ type, currentState: null, periodType: null, cancelReason: null }),
      ).toEqual({ kind: 'noop', reason: 'no_subscription_for_event' });
    }
  });

  it('refuses to act on an unrecognised event rather than defaulting to something', () => {
    expect(
      resolveStoreEvent({
        type: 'unknown',
        currentState: S.ACTIVE,
        periodType: null,
        cancelReason: null,
      }),
    ).toEqual({ kind: 'noop', reason: 'unknown_event' });
  });

  it('treats a CANCELLATION with no reason as UNKNOWN, i.e. conservatively', () => {
    // Keep access until EXPIRATION is definitive. A missing reason must not be
    // read as a refund.
    expect(
      resolveStoreEvent({
        type: 'purchase.cancelled',
        currentState: S.ACTIVE,
        periodType: null,
        cancelReason: null,
      }),
    ).toEqual({ kind: 'transition', action: A.REQUEST_CANCEL });
  });

  it('does not cancel-immediately from a state where that transition is illegal', () => {
    // COMPLIMENTARY is accessible but has no CANCEL_IMMEDIATELY. A store
    // subscription should never be complimentary, but the resolver must not
    // hand executeTransition an action it will refuse.
    expect(
      resolveStoreEvent({
        type: 'purchase.cancelled',
        currentState: S.COMPLIMENTARY,
        periodType: null,
        cancelReason: 'CUSTOMER_SUPPORT',
      }),
    ).toEqual({ kind: 'noop', reason: 'no_legal_transition' });
  });

  it('does not request-cancel from past_due or grace_period', () => {
    // REQUEST_CANCEL is defined only from ACTIVE. EXPIRATION still owns the end
    // of access from these states.
    for (const from of [S.PAST_DUE, S.GRACE_PERIOD, S.CANCELLING]) {
      expect(
        resolveStoreEvent({
          type: 'purchase.cancelled',
          currentState: from,
          periodType: null,
          cancelReason: 'UNSUBSCRIBE',
        }),
      ).toEqual({ kind: 'noop', reason: 'no_legal_transition' });
    }
  });

  it('accepts a lower-cased cancel reason', () => {
    // The adapter upper-cases on parse; the resolver must not depend on having
    // been called through it.
    expect(
      resolveStoreEvent({
        type: 'purchase.cancelled',
        currentState: S.TRIALING,
        periodType: null,
        cancelReason: 'unsubscribe',
      }),
    ).toEqual({ kind: 'noop', reason: 'cancellation_during_trial' });
  });
});
