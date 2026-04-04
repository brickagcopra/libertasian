// ==========================================================================
// Subscription State Machine — Pure Functions (no DI, no side effects)
// ==========================================================================

// ---- States ----

export enum SubscriptionState {
  PROVISIONING = 'provisioning',
  TRIALING = 'trialing',
  TRIAL_EXPIRED = 'trial_expired',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  GRACE_PERIOD = 'grace_period',
  SUSPENDED = 'suspended',
  CANCELLING = 'cancelling',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  COMPLIMENTARY = 'complimentary',
  MIGRATING = 'migrating',
  TERMINATED = 'terminated',
}

// ---- Actions ----

export enum SubscriptionAction {
  START_TRIAL = 'START_TRIAL',
  CONVERT_TRIAL = 'CONVERT_TRIAL',
  EXPIRE_TRIAL = 'EXPIRE_TRIAL',
  ACTIVATE = 'ACTIVATE',
  RENEW = 'RENEW',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  ENTER_GRACE_PERIOD = 'ENTER_GRACE_PERIOD',
  REQUEST_CANCEL = 'REQUEST_CANCEL',
  CANCEL_IMMEDIATELY = 'CANCEL_IMMEDIATELY',
  UNDO_CANCEL = 'UNDO_CANCEL',
  SUSPEND = 'SUSPEND',
  REACTIVATE = 'REACTIVATE',
  UPGRADE = 'UPGRADE',
  DOWNGRADE = 'DOWNGRADE',
  PAUSE = 'PAUSE',
  GRANT_COMPLIMENTARY = 'GRANT_COMPLIMENTARY',
  REVOKE_COMPLIMENTARY = 'REVOKE_COMPLIMENTARY',
  TERMINATE = 'TERMINATE',
}

// ---- Side Effect Types ----

export enum SideEffectType {
  AUDIT_LOG = 'AUDIT_LOG',
  HISTORY_LOG = 'HISTORY_LOG',
  SCHEDULE_EVENT = 'SCHEDULE_EVENT',
  CANCEL_SCHEDULED_EVENT = 'CANCEL_SCHEDULED_EVENT',
  RESET_QUOTAS = 'RESET_QUOTAS',
  UPDATE_ENTITLEMENTS = 'UPDATE_ENTITLEMENTS',
  SEND_NOTIFICATION = 'SEND_NOTIFICATION',
  CREATE_MIGRATION_RECORD = 'CREATE_MIGRATION_RECORD',
  UPDATE_TRIAL_RECORD = 'UPDATE_TRIAL_RECORD',
  PRORATE_PAYMENT = 'PRORATE_PAYMENT',
  CREATE_INVOICE = 'CREATE_INVOICE',
}

export interface SideEffect {
  type: SideEffectType;
  payload?: Record<string, unknown>;
}

// ---- Transition Result ----

export interface TransitionSuccess {
  success: true;
  fromState: SubscriptionState;
  toState: SubscriptionState;
  action: SubscriptionAction;
  sideEffects: SideEffect[];
}

export interface TransitionFailure {
  success: false;
  fromState: SubscriptionState;
  action: SubscriptionAction;
  error: string;
}

export type TransitionResult = TransitionSuccess | TransitionFailure;

// ---- Transition Table ----

interface TransitionDef {
  toState: SubscriptionState;
  sideEffects: SideEffect[];
}

const TRANSITIONS: Record<string, TransitionDef> = {};

function key(from: SubscriptionState, action: SubscriptionAction): string {
  return `${from}::${action}`;
}

function define(
  from: SubscriptionState,
  action: SubscriptionAction,
  toState: SubscriptionState,
  sideEffects: SideEffect[] = [],
): void {
  TRANSITIONS[key(from, action)] = { toState, sideEffects };
}

// ---- Define All Transitions ----

// PROVISIONING
define(SubscriptionState.PROVISIONING, SubscriptionAction.ACTIVATE, SubscriptionState.ACTIVE, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.UPDATE_ENTITLEMENTS },
  { type: SideEffectType.SCHEDULE_EVENT, payload: { eventType: 'renewal' } },
]);

define(SubscriptionState.PROVISIONING, SubscriptionAction.START_TRIAL, SubscriptionState.TRIALING, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.UPDATE_TRIAL_RECORD, payload: { status: 'active' } },
  { type: SideEffectType.UPDATE_ENTITLEMENTS },
  { type: SideEffectType.SCHEDULE_EVENT, payload: { eventType: 'trial_expiry' } },
  { type: SideEffectType.SEND_NOTIFICATION, payload: { template: 'trial_started' } },
]);

define(SubscriptionState.PROVISIONING, SubscriptionAction.GRANT_COMPLIMENTARY, SubscriptionState.COMPLIMENTARY, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.UPDATE_ENTITLEMENTS },
  { type: SideEffectType.SEND_NOTIFICATION, payload: { template: 'complimentary_granted' } },
]);

// TRIALING
define(SubscriptionState.TRIALING, SubscriptionAction.CONVERT_TRIAL, SubscriptionState.ACTIVE, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.UPDATE_TRIAL_RECORD, payload: { status: 'converted' } },
  { type: SideEffectType.CANCEL_SCHEDULED_EVENT, payload: { eventType: 'trial_expiry' } },
  { type: SideEffectType.UPDATE_ENTITLEMENTS },
  { type: SideEffectType.SCHEDULE_EVENT, payload: { eventType: 'renewal' } },
  { type: SideEffectType.CREATE_INVOICE },
  { type: SideEffectType.SEND_NOTIFICATION, payload: { template: 'trial_converted' } },
]);

define(SubscriptionState.TRIALING, SubscriptionAction.EXPIRE_TRIAL, SubscriptionState.TRIAL_EXPIRED, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.UPDATE_TRIAL_RECORD, payload: { status: 'expired' } },
  { type: SideEffectType.UPDATE_ENTITLEMENTS },
  { type: SideEffectType.SEND_NOTIFICATION, payload: { template: 'trial_expired' } },
]);

define(SubscriptionState.TRIALING, SubscriptionAction.CANCEL_IMMEDIATELY, SubscriptionState.CANCELLED, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.UPDATE_TRIAL_RECORD, payload: { status: 'cancelled' } },
  { type: SideEffectType.CANCEL_SCHEDULED_EVENT, payload: { eventType: 'trial_expiry' } },
  { type: SideEffectType.UPDATE_ENTITLEMENTS },
]);

// TRIAL_EXPIRED
define(SubscriptionState.TRIAL_EXPIRED, SubscriptionAction.ACTIVATE, SubscriptionState.ACTIVE, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.UPDATE_ENTITLEMENTS },
  { type: SideEffectType.SCHEDULE_EVENT, payload: { eventType: 'renewal' } },
  { type: SideEffectType.CREATE_INVOICE },
]);

// ACTIVE
define(SubscriptionState.ACTIVE, SubscriptionAction.RENEW, SubscriptionState.ACTIVE, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.RESET_QUOTAS },
  { type: SideEffectType.SCHEDULE_EVENT, payload: { eventType: 'renewal' } },
  { type: SideEffectType.CREATE_INVOICE },
]);

define(SubscriptionState.ACTIVE, SubscriptionAction.PAYMENT_FAILED, SubscriptionState.PAST_DUE, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.SEND_NOTIFICATION, payload: { template: 'payment_failed' } },
]);

define(SubscriptionState.ACTIVE, SubscriptionAction.REQUEST_CANCEL, SubscriptionState.CANCELLING, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.SCHEDULE_EVENT, payload: { eventType: 'cancellation_end' } },
  { type: SideEffectType.SEND_NOTIFICATION, payload: { template: 'cancellation_requested' } },
]);

define(SubscriptionState.ACTIVE, SubscriptionAction.CANCEL_IMMEDIATELY, SubscriptionState.CANCELLED, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.UPDATE_ENTITLEMENTS },
  { type: SideEffectType.CANCEL_SCHEDULED_EVENT, payload: { eventType: 'renewal' } },
  { type: SideEffectType.SEND_NOTIFICATION, payload: { template: 'subscription_cancelled' } },
]);

define(SubscriptionState.ACTIVE, SubscriptionAction.UPGRADE, SubscriptionState.MIGRATING, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.CREATE_MIGRATION_RECORD },
  { type: SideEffectType.PRORATE_PAYMENT },
]);

define(SubscriptionState.ACTIVE, SubscriptionAction.DOWNGRADE, SubscriptionState.MIGRATING, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.CREATE_MIGRATION_RECORD },
  { type: SideEffectType.PRORATE_PAYMENT },
]);

define(SubscriptionState.ACTIVE, SubscriptionAction.PAUSE, SubscriptionState.SUSPENDED, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.CANCEL_SCHEDULED_EVENT, payload: { eventType: 'renewal' } },
  { type: SideEffectType.SEND_NOTIFICATION, payload: { template: 'subscription_paused' } },
]);

// PAST_DUE
define(SubscriptionState.PAST_DUE, SubscriptionAction.RENEW, SubscriptionState.ACTIVE, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.RESET_QUOTAS },
  { type: SideEffectType.SCHEDULE_EVENT, payload: { eventType: 'renewal' } },
  { type: SideEffectType.CREATE_INVOICE },
  { type: SideEffectType.SEND_NOTIFICATION, payload: { template: 'payment_recovered' } },
]);

define(SubscriptionState.PAST_DUE, SubscriptionAction.ENTER_GRACE_PERIOD, SubscriptionState.GRACE_PERIOD, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.SCHEDULE_EVENT, payload: { eventType: 'grace_period_end' } },
  { type: SideEffectType.SEND_NOTIFICATION, payload: { template: 'grace_period_started' } },
]);

define(SubscriptionState.PAST_DUE, SubscriptionAction.CANCEL_IMMEDIATELY, SubscriptionState.CANCELLED, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.UPDATE_ENTITLEMENTS },
  { type: SideEffectType.SEND_NOTIFICATION, payload: { template: 'subscription_cancelled' } },
]);

// GRACE_PERIOD
define(SubscriptionState.GRACE_PERIOD, SubscriptionAction.RENEW, SubscriptionState.ACTIVE, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.CANCEL_SCHEDULED_EVENT, payload: { eventType: 'grace_period_end' } },
  { type: SideEffectType.RESET_QUOTAS },
  { type: SideEffectType.SCHEDULE_EVENT, payload: { eventType: 'renewal' } },
  { type: SideEffectType.CREATE_INVOICE },
  { type: SideEffectType.SEND_NOTIFICATION, payload: { template: 'payment_recovered' } },
]);

define(SubscriptionState.GRACE_PERIOD, SubscriptionAction.SUSPEND, SubscriptionState.SUSPENDED, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.CANCEL_SCHEDULED_EVENT, payload: { eventType: 'grace_period_end' } },
  { type: SideEffectType.UPDATE_ENTITLEMENTS },
  { type: SideEffectType.SEND_NOTIFICATION, payload: { template: 'subscription_suspended' } },
]);

define(SubscriptionState.GRACE_PERIOD, SubscriptionAction.CANCEL_IMMEDIATELY, SubscriptionState.CANCELLED, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.CANCEL_SCHEDULED_EVENT, payload: { eventType: 'grace_period_end' } },
  { type: SideEffectType.UPDATE_ENTITLEMENTS },
]);

// SUSPENDED
define(SubscriptionState.SUSPENDED, SubscriptionAction.REACTIVATE, SubscriptionState.ACTIVE, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.UPDATE_ENTITLEMENTS },
  { type: SideEffectType.RESET_QUOTAS },
  { type: SideEffectType.SCHEDULE_EVENT, payload: { eventType: 'renewal' } },
  { type: SideEffectType.CREATE_INVOICE },
  { type: SideEffectType.SEND_NOTIFICATION, payload: { template: 'subscription_reactivated' } },
]);

define(SubscriptionState.SUSPENDED, SubscriptionAction.CANCEL_IMMEDIATELY, SubscriptionState.CANCELLED, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.UPDATE_ENTITLEMENTS },
]);

// CANCELLING
define(SubscriptionState.CANCELLING, SubscriptionAction.UNDO_CANCEL, SubscriptionState.ACTIVE, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.CANCEL_SCHEDULED_EVENT, payload: { eventType: 'cancellation_end' } },
  { type: SideEffectType.SEND_NOTIFICATION, payload: { template: 'cancellation_undone' } },
]);

define(SubscriptionState.CANCELLING, SubscriptionAction.CANCEL_IMMEDIATELY, SubscriptionState.CANCELLED, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.CANCEL_SCHEDULED_EVENT, payload: { eventType: 'cancellation_end' } },
  { type: SideEffectType.UPDATE_ENTITLEMENTS },
  { type: SideEffectType.SEND_NOTIFICATION, payload: { template: 'subscription_cancelled' } },
]);

// CANCELLED
define(SubscriptionState.CANCELLED, SubscriptionAction.REACTIVATE, SubscriptionState.ACTIVE, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.UPDATE_ENTITLEMENTS },
  { type: SideEffectType.RESET_QUOTAS },
  { type: SideEffectType.SCHEDULE_EVENT, payload: { eventType: 'renewal' } },
  { type: SideEffectType.CREATE_INVOICE },
  { type: SideEffectType.SEND_NOTIFICATION, payload: { template: 'subscription_reactivated' } },
]);

// EXPIRED
define(SubscriptionState.EXPIRED, SubscriptionAction.ACTIVATE, SubscriptionState.ACTIVE, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.UPDATE_ENTITLEMENTS },
  { type: SideEffectType.RESET_QUOTAS },
  { type: SideEffectType.SCHEDULE_EVENT, payload: { eventType: 'renewal' } },
  { type: SideEffectType.CREATE_INVOICE },
]);

// COMPLIMENTARY
define(SubscriptionState.COMPLIMENTARY, SubscriptionAction.REVOKE_COMPLIMENTARY, SubscriptionState.CANCELLED, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.UPDATE_ENTITLEMENTS },
  { type: SideEffectType.SEND_NOTIFICATION, payload: { template: 'complimentary_revoked' } },
]);

define(SubscriptionState.COMPLIMENTARY, SubscriptionAction.ACTIVATE, SubscriptionState.ACTIVE, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.UPDATE_ENTITLEMENTS },
  { type: SideEffectType.SCHEDULE_EVENT, payload: { eventType: 'renewal' } },
  { type: SideEffectType.CREATE_INVOICE },
]);

// MIGRATING
define(SubscriptionState.MIGRATING, SubscriptionAction.ACTIVATE, SubscriptionState.ACTIVE, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.UPDATE_ENTITLEMENTS },
  { type: SideEffectType.RESET_QUOTAS },
  { type: SideEffectType.SCHEDULE_EVENT, payload: { eventType: 'renewal' } },
]);

define(SubscriptionState.MIGRATING, SubscriptionAction.CANCEL_IMMEDIATELY, SubscriptionState.CANCELLED, [
  { type: SideEffectType.AUDIT_LOG },
  { type: SideEffectType.HISTORY_LOG },
  { type: SideEffectType.UPDATE_ENTITLEMENTS },
]);

// ---- TERMINATE: All non-terminal states can be terminated ----

const TERMINAL_STATES = new Set<SubscriptionState>([
  SubscriptionState.TERMINATED,
]);

const NON_TERMINAL_STATES = Object.values(SubscriptionState).filter(
  (s) => !TERMINAL_STATES.has(s),
);

for (const state of NON_TERMINAL_STATES) {
  define(state, SubscriptionAction.TERMINATE, SubscriptionState.TERMINATED, [
    { type: SideEffectType.AUDIT_LOG },
    { type: SideEffectType.HISTORY_LOG },
    { type: SideEffectType.UPDATE_ENTITLEMENTS },
    { type: SideEffectType.CANCEL_SCHEDULED_EVENT, payload: { eventType: 'all' } },
    { type: SideEffectType.SEND_NOTIFICATION, payload: { template: 'subscription_terminated' } },
  ]);
}

// ---- States that grant platform access ----

const ACCESSIBLE_STATES = new Set<SubscriptionState>([
  SubscriptionState.TRIALING,
  SubscriptionState.ACTIVE,
  SubscriptionState.PAST_DUE,
  SubscriptionState.GRACE_PERIOD,
  SubscriptionState.CANCELLING,
  SubscriptionState.COMPLIMENTARY,
  SubscriptionState.MIGRATING,
]);

// ==========================================================================
// Pure Functions
// ==========================================================================

/**
 * Check if a transition from `from` with `action` is valid.
 */
export function isValidTransition(
  from: SubscriptionState,
  action: SubscriptionAction,
): boolean {
  return key(from, action) in TRANSITIONS;
}

/**
 * Get the next state for a given current state and action.
 * Returns null if the transition is invalid.
 */
export function getNextState(
  from: SubscriptionState,
  action: SubscriptionAction,
): SubscriptionState | null {
  const def = TRANSITIONS[key(from, action)];
  return def?.toState ?? null;
}

/**
 * Attempt a state transition. Returns a result object with the new state
 * and declared side effects, or an error if the transition is invalid.
 */
export function transition(
  from: SubscriptionState,
  action: SubscriptionAction,
): TransitionResult {
  const def = TRANSITIONS[key(from, action)];

  if (!def) {
    return {
      success: false,
      fromState: from,
      action,
      error: `Invalid transition: cannot perform ${action} from state ${from}`,
    };
  }

  return {
    success: true,
    fromState: from,
    toState: def.toState,
    action,
    sideEffects: def.sideEffects,
  };
}

/**
 * Check if a state is terminal (no further transitions possible except via admin override).
 */
export function isTerminalState(state: SubscriptionState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Check if a state grants platform access (user can use the product).
 */
export function isAccessibleState(state: SubscriptionState): boolean {
  return ACCESSIBLE_STATES.has(state);
}

/**
 * Get all valid actions from a given state.
 */
export function getValidActions(state: SubscriptionState): SubscriptionAction[] {
  const actions: SubscriptionAction[] = [];
  for (const action of Object.values(SubscriptionAction)) {
    if (isValidTransition(state, action)) {
      actions.push(action);
    }
  }
  return actions;
}
