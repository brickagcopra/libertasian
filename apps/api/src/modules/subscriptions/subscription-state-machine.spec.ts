import {
  SubscriptionState,
  SubscriptionAction,
  SideEffectType,
  transition,
  isValidTransition,
  getNextState,
  isTerminalState,
  isAccessibleState,
  getValidActions,
} from './subscription-state-machine';

describe('SubscriptionStateMachine', () => {
  // ====================================================================
  // Valid Transitions — PROVISIONING
  // ====================================================================

  describe('PROVISIONING transitions', () => {
    it('ACTIVATE → ACTIVE', () => {
      const result = transition(SubscriptionState.PROVISIONING, SubscriptionAction.ACTIVATE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.ACTIVE);
      }
    });

    it('START_TRIAL → TRIALING', () => {
      const result = transition(SubscriptionState.PROVISIONING, SubscriptionAction.START_TRIAL);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.TRIALING);
      }
    });

    it('GRANT_COMPLIMENTARY → COMPLIMENTARY', () => {
      const result = transition(SubscriptionState.PROVISIONING, SubscriptionAction.GRANT_COMPLIMENTARY);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.COMPLIMENTARY);
      }
    });

    it('TERMINATE → TERMINATED', () => {
      const result = transition(SubscriptionState.PROVISIONING, SubscriptionAction.TERMINATE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.TERMINATED);
      }
    });
  });

  // ====================================================================
  // Valid Transitions — TRIALING
  // ====================================================================

  describe('TRIALING transitions', () => {
    it('CONVERT_TRIAL → ACTIVE', () => {
      const result = transition(SubscriptionState.TRIALING, SubscriptionAction.CONVERT_TRIAL);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.ACTIVE);
      }
    });

    it('EXPIRE_TRIAL → TRIAL_EXPIRED', () => {
      const result = transition(SubscriptionState.TRIALING, SubscriptionAction.EXPIRE_TRIAL);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.TRIAL_EXPIRED);
      }
    });

    it('CANCEL_IMMEDIATELY → CANCELLED', () => {
      const result = transition(SubscriptionState.TRIALING, SubscriptionAction.CANCEL_IMMEDIATELY);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.CANCELLED);
      }
    });

    it('TERMINATE → TERMINATED', () => {
      const result = transition(SubscriptionState.TRIALING, SubscriptionAction.TERMINATE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.TERMINATED);
      }
    });
  });

  // ====================================================================
  // Valid Transitions — TRIAL_EXPIRED
  // ====================================================================

  describe('TRIAL_EXPIRED transitions', () => {
    it('ACTIVATE → ACTIVE', () => {
      const result = transition(SubscriptionState.TRIAL_EXPIRED, SubscriptionAction.ACTIVATE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.ACTIVE);
      }
    });

    it('TERMINATE → TERMINATED', () => {
      const result = transition(SubscriptionState.TRIAL_EXPIRED, SubscriptionAction.TERMINATE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.TERMINATED);
      }
    });
  });

  // ====================================================================
  // Valid Transitions — ACTIVE
  // ====================================================================

  describe('ACTIVE transitions', () => {
    it('RENEW → ACTIVE', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.RENEW);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.ACTIVE);
      }
    });

    it('PAYMENT_FAILED → PAST_DUE', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.PAYMENT_FAILED);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.PAST_DUE);
      }
    });

    it('REQUEST_CANCEL → CANCELLING', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.REQUEST_CANCEL);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.CANCELLING);
      }
    });

    it('CANCEL_IMMEDIATELY → CANCELLED', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.CANCEL_IMMEDIATELY);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.CANCELLED);
      }
    });

    it('UPGRADE → MIGRATING', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.UPGRADE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.MIGRATING);
      }
    });

    it('DOWNGRADE → MIGRATING', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.DOWNGRADE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.MIGRATING);
      }
    });

    it('PAUSE → SUSPENDED', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.PAUSE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.SUSPENDED);
      }
    });

    it('TERMINATE → TERMINATED', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.TERMINATE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.TERMINATED);
      }
    });
  });

  // ====================================================================
  // Valid Transitions — PAST_DUE
  // ====================================================================

  describe('PAST_DUE transitions', () => {
    it('RENEW → ACTIVE', () => {
      const result = transition(SubscriptionState.PAST_DUE, SubscriptionAction.RENEW);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.ACTIVE);
      }
    });

    it('ENTER_GRACE_PERIOD → GRACE_PERIOD', () => {
      const result = transition(SubscriptionState.PAST_DUE, SubscriptionAction.ENTER_GRACE_PERIOD);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.GRACE_PERIOD);
      }
    });

    it('CANCEL_IMMEDIATELY → CANCELLED', () => {
      const result = transition(SubscriptionState.PAST_DUE, SubscriptionAction.CANCEL_IMMEDIATELY);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.CANCELLED);
      }
    });

    it('TERMINATE → TERMINATED', () => {
      const result = transition(SubscriptionState.PAST_DUE, SubscriptionAction.TERMINATE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.TERMINATED);
      }
    });
  });

  // ====================================================================
  // Valid Transitions — GRACE_PERIOD
  // ====================================================================

  describe('GRACE_PERIOD transitions', () => {
    it('RENEW → ACTIVE', () => {
      const result = transition(SubscriptionState.GRACE_PERIOD, SubscriptionAction.RENEW);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.ACTIVE);
      }
    });

    it('SUSPEND → SUSPENDED', () => {
      const result = transition(SubscriptionState.GRACE_PERIOD, SubscriptionAction.SUSPEND);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.SUSPENDED);
      }
    });

    it('CANCEL_IMMEDIATELY → CANCELLED', () => {
      const result = transition(SubscriptionState.GRACE_PERIOD, SubscriptionAction.CANCEL_IMMEDIATELY);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.CANCELLED);
      }
    });

    it('TERMINATE → TERMINATED', () => {
      const result = transition(SubscriptionState.GRACE_PERIOD, SubscriptionAction.TERMINATE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.TERMINATED);
      }
    });
  });

  // ====================================================================
  // Valid Transitions — SUSPENDED
  // ====================================================================

  describe('SUSPENDED transitions', () => {
    it('REACTIVATE → ACTIVE', () => {
      const result = transition(SubscriptionState.SUSPENDED, SubscriptionAction.REACTIVATE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.ACTIVE);
      }
    });

    it('CANCEL_IMMEDIATELY → CANCELLED', () => {
      const result = transition(SubscriptionState.SUSPENDED, SubscriptionAction.CANCEL_IMMEDIATELY);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.CANCELLED);
      }
    });

    it('TERMINATE → TERMINATED', () => {
      const result = transition(SubscriptionState.SUSPENDED, SubscriptionAction.TERMINATE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.TERMINATED);
      }
    });
  });

  // ====================================================================
  // Valid Transitions — CANCELLING
  // ====================================================================

  describe('CANCELLING transitions', () => {
    it('UNDO_CANCEL → ACTIVE', () => {
      const result = transition(SubscriptionState.CANCELLING, SubscriptionAction.UNDO_CANCEL);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.ACTIVE);
      }
    });

    it('CANCEL_IMMEDIATELY → CANCELLED', () => {
      const result = transition(SubscriptionState.CANCELLING, SubscriptionAction.CANCEL_IMMEDIATELY);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.CANCELLED);
      }
    });

    it('TERMINATE → TERMINATED', () => {
      const result = transition(SubscriptionState.CANCELLING, SubscriptionAction.TERMINATE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.TERMINATED);
      }
    });
  });

  // ====================================================================
  // Valid Transitions — CANCELLED
  // ====================================================================

  describe('CANCELLED transitions', () => {
    it('REACTIVATE → ACTIVE', () => {
      const result = transition(SubscriptionState.CANCELLED, SubscriptionAction.REACTIVATE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.ACTIVE);
      }
    });

    it('TERMINATE → TERMINATED', () => {
      const result = transition(SubscriptionState.CANCELLED, SubscriptionAction.TERMINATE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.TERMINATED);
      }
    });
  });

  // ====================================================================
  // Valid Transitions — EXPIRED
  // ====================================================================

  describe('EXPIRED transitions', () => {
    it('ACTIVATE → ACTIVE', () => {
      const result = transition(SubscriptionState.EXPIRED, SubscriptionAction.ACTIVATE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.ACTIVE);
      }
    });

    it('TERMINATE → TERMINATED', () => {
      const result = transition(SubscriptionState.EXPIRED, SubscriptionAction.TERMINATE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.TERMINATED);
      }
    });
  });

  // ====================================================================
  // Valid Transitions — COMPLIMENTARY
  // ====================================================================

  describe('COMPLIMENTARY transitions', () => {
    it('REVOKE_COMPLIMENTARY → CANCELLED', () => {
      const result = transition(SubscriptionState.COMPLIMENTARY, SubscriptionAction.REVOKE_COMPLIMENTARY);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.CANCELLED);
      }
    });

    it('ACTIVATE → ACTIVE', () => {
      const result = transition(SubscriptionState.COMPLIMENTARY, SubscriptionAction.ACTIVATE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.ACTIVE);
      }
    });

    it('TERMINATE → TERMINATED', () => {
      const result = transition(SubscriptionState.COMPLIMENTARY, SubscriptionAction.TERMINATE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.TERMINATED);
      }
    });
  });

  // ====================================================================
  // Valid Transitions — MIGRATING
  // ====================================================================

  describe('MIGRATING transitions', () => {
    it('ACTIVATE → ACTIVE', () => {
      const result = transition(SubscriptionState.MIGRATING, SubscriptionAction.ACTIVATE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.ACTIVE);
      }
    });

    it('CANCEL_IMMEDIATELY → CANCELLED', () => {
      const result = transition(SubscriptionState.MIGRATING, SubscriptionAction.CANCEL_IMMEDIATELY);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.CANCELLED);
      }
    });

    it('TERMINATE → TERMINATED', () => {
      const result = transition(SubscriptionState.MIGRATING, SubscriptionAction.TERMINATE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.toState).toBe(SubscriptionState.TERMINATED);
      }
    });
  });

  // ====================================================================
  // Invalid Transitions
  // ====================================================================

  describe('invalid transitions', () => {
    it('TERMINATED → any action is invalid', () => {
      const actions = Object.values(SubscriptionAction).filter(
        (a) => a !== SubscriptionAction.TERMINATE,
      );
      for (const action of actions) {
        const result = transition(SubscriptionState.TERMINATED, action);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain('Invalid transition');
        }
      }
    });

    it('TERMINATED → TERMINATE is also invalid (already terminated)', () => {
      const result = transition(SubscriptionState.TERMINATED, SubscriptionAction.TERMINATE);
      expect(result.success).toBe(false);
    });

    it('ACTIVE → START_TRIAL is invalid', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.START_TRIAL);
      expect(result.success).toBe(false);
    });

    it('ACTIVE → CONVERT_TRIAL is invalid', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.CONVERT_TRIAL);
      expect(result.success).toBe(false);
    });

    it('ACTIVE → EXPIRE_TRIAL is invalid', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.EXPIRE_TRIAL);
      expect(result.success).toBe(false);
    });

    it('ACTIVE → REACTIVATE is invalid (already active)', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.REACTIVATE);
      expect(result.success).toBe(false);
    });

    it('ACTIVE → ENTER_GRACE_PERIOD is invalid', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.ENTER_GRACE_PERIOD);
      expect(result.success).toBe(false);
    });

    it('ACTIVE → UNDO_CANCEL is invalid (not cancelling)', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.UNDO_CANCEL);
      expect(result.success).toBe(false);
    });

    it('ACTIVE → SUSPEND is invalid (need grace period first)', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.SUSPEND);
      expect(result.success).toBe(false);
    });

    it('ACTIVE → REVOKE_COMPLIMENTARY is invalid', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.REVOKE_COMPLIMENTARY);
      expect(result.success).toBe(false);
    });

    it('SUSPENDED → PAUSE is invalid (already paused)', () => {
      const result = transition(SubscriptionState.SUSPENDED, SubscriptionAction.PAUSE);
      expect(result.success).toBe(false);
    });

    it('TRIALING → PAUSE is invalid (cannot pause a trial)', () => {
      const result = transition(SubscriptionState.TRIALING, SubscriptionAction.PAUSE);
      expect(result.success).toBe(false);
    });

    it('CANCELLED → PAUSE is invalid', () => {
      const result = transition(SubscriptionState.CANCELLED, SubscriptionAction.PAUSE);
      expect(result.success).toBe(false);
    });

    it('TRIALING → RENEW is invalid', () => {
      const result = transition(SubscriptionState.TRIALING, SubscriptionAction.RENEW);
      expect(result.success).toBe(false);
    });

    it('TRIALING → UPGRADE is invalid', () => {
      const result = transition(SubscriptionState.TRIALING, SubscriptionAction.UPGRADE);
      expect(result.success).toBe(false);
    });

    it('CANCELLED → CANCEL_IMMEDIATELY is invalid (already cancelled)', () => {
      const result = transition(SubscriptionState.CANCELLED, SubscriptionAction.CANCEL_IMMEDIATELY);
      expect(result.success).toBe(false);
    });

    it('SUSPENDED → UPGRADE is invalid', () => {
      const result = transition(SubscriptionState.SUSPENDED, SubscriptionAction.UPGRADE);
      expect(result.success).toBe(false);
    });

    it('EXPIRED → RENEW is invalid (must re-activate)', () => {
      const result = transition(SubscriptionState.EXPIRED, SubscriptionAction.RENEW);
      expect(result.success).toBe(false);
    });

    it('PAST_DUE → UPGRADE is invalid (must resolve payment first)', () => {
      const result = transition(SubscriptionState.PAST_DUE, SubscriptionAction.UPGRADE);
      expect(result.success).toBe(false);
    });

    it('GRACE_PERIOD → UPGRADE is invalid', () => {
      const result = transition(SubscriptionState.GRACE_PERIOD, SubscriptionAction.UPGRADE);
      expect(result.success).toBe(false);
    });
  });

  // ====================================================================
  // isValidTransition
  // ====================================================================

  describe('isValidTransition', () => {
    it('returns true for valid transitions', () => {
      expect(isValidTransition(SubscriptionState.ACTIVE, SubscriptionAction.RENEW)).toBe(true);
      expect(isValidTransition(SubscriptionState.TRIALING, SubscriptionAction.CONVERT_TRIAL)).toBe(true);
      expect(isValidTransition(SubscriptionState.PROVISIONING, SubscriptionAction.ACTIVATE)).toBe(true);
    });

    it('returns false for invalid transitions', () => {
      expect(isValidTransition(SubscriptionState.ACTIVE, SubscriptionAction.START_TRIAL)).toBe(false);
      expect(isValidTransition(SubscriptionState.TERMINATED, SubscriptionAction.ACTIVATE)).toBe(false);
      expect(isValidTransition(SubscriptionState.CANCELLED, SubscriptionAction.RENEW)).toBe(false);
    });
  });

  // ====================================================================
  // getNextState
  // ====================================================================

  describe('getNextState', () => {
    it('returns the correct next state for valid transitions', () => {
      expect(getNextState(SubscriptionState.ACTIVE, SubscriptionAction.PAYMENT_FAILED)).toBe(SubscriptionState.PAST_DUE);
      expect(getNextState(SubscriptionState.PAST_DUE, SubscriptionAction.ENTER_GRACE_PERIOD)).toBe(SubscriptionState.GRACE_PERIOD);
      expect(getNextState(SubscriptionState.GRACE_PERIOD, SubscriptionAction.SUSPEND)).toBe(SubscriptionState.SUSPENDED);
    });

    it('returns null for invalid transitions', () => {
      expect(getNextState(SubscriptionState.TERMINATED, SubscriptionAction.ACTIVATE)).toBeNull();
      expect(getNextState(SubscriptionState.ACTIVE, SubscriptionAction.START_TRIAL)).toBeNull();
    });
  });

  // ====================================================================
  // isTerminalState
  // ====================================================================

  describe('isTerminalState', () => {
    it('TERMINATED is terminal', () => {
      expect(isTerminalState(SubscriptionState.TERMINATED)).toBe(true);
    });

    it('all other states are not terminal', () => {
      const nonTerminal = Object.values(SubscriptionState).filter(
        (s) => s !== SubscriptionState.TERMINATED,
      );
      for (const state of nonTerminal) {
        expect(isTerminalState(state)).toBe(false);
      }
    });
  });

  // ====================================================================
  // isAccessibleState
  // ====================================================================

  describe('isAccessibleState', () => {
    const expectedAccessible = [
      SubscriptionState.TRIALING,
      SubscriptionState.ACTIVE,
      SubscriptionState.PAST_DUE,
      SubscriptionState.GRACE_PERIOD,
      SubscriptionState.CANCELLING,
      SubscriptionState.COMPLIMENTARY,
      SubscriptionState.MIGRATING,
    ];

    const expectedInaccessible = [
      SubscriptionState.PROVISIONING,
      SubscriptionState.TRIAL_EXPIRED,
      SubscriptionState.SUSPENDED,
      SubscriptionState.CANCELLED,
      SubscriptionState.EXPIRED,
      SubscriptionState.TERMINATED,
    ];

    it.each(expectedAccessible)('%s grants platform access', (state) => {
      expect(isAccessibleState(state)).toBe(true);
    });

    it.each(expectedInaccessible)('%s does NOT grant platform access', (state) => {
      expect(isAccessibleState(state)).toBe(false);
    });
  });

  // ====================================================================
  // getValidActions
  // ====================================================================

  describe('getValidActions', () => {
    it('PROVISIONING has ACTIVATE, START_TRIAL, GRANT_COMPLIMENTARY, TERMINATE', () => {
      const actions = getValidActions(SubscriptionState.PROVISIONING);
      expect(actions).toContain(SubscriptionAction.ACTIVATE);
      expect(actions).toContain(SubscriptionAction.START_TRIAL);
      expect(actions).toContain(SubscriptionAction.GRANT_COMPLIMENTARY);
      expect(actions).toContain(SubscriptionAction.TERMINATE);
      expect(actions).toHaveLength(4);
    });

    it('ACTIVE has RENEW, PAYMENT_FAILED, REQUEST_CANCEL, CANCEL_IMMEDIATELY, UPGRADE, DOWNGRADE, PAUSE, TERMINATE', () => {
      const actions = getValidActions(SubscriptionState.ACTIVE);
      expect(actions).toContain(SubscriptionAction.RENEW);
      expect(actions).toContain(SubscriptionAction.PAYMENT_FAILED);
      expect(actions).toContain(SubscriptionAction.REQUEST_CANCEL);
      expect(actions).toContain(SubscriptionAction.CANCEL_IMMEDIATELY);
      expect(actions).toContain(SubscriptionAction.UPGRADE);
      expect(actions).toContain(SubscriptionAction.DOWNGRADE);
      expect(actions).toContain(SubscriptionAction.PAUSE);
      expect(actions).toContain(SubscriptionAction.TERMINATE);
      expect(actions).toHaveLength(8);
    });

    it('TERMINATED has no valid actions', () => {
      const actions = getValidActions(SubscriptionState.TERMINATED);
      expect(actions).toHaveLength(0);
    });

    it('CANCELLING has UNDO_CANCEL, CANCEL_IMMEDIATELY, TERMINATE', () => {
      const actions = getValidActions(SubscriptionState.CANCELLING);
      expect(actions).toContain(SubscriptionAction.UNDO_CANCEL);
      expect(actions).toContain(SubscriptionAction.CANCEL_IMMEDIATELY);
      expect(actions).toContain(SubscriptionAction.TERMINATE);
      expect(actions).toHaveLength(3);
    });

    it('SUSPENDED has REACTIVATE, CANCEL_IMMEDIATELY, TERMINATE', () => {
      const actions = getValidActions(SubscriptionState.SUSPENDED);
      expect(actions).toContain(SubscriptionAction.REACTIVATE);
      expect(actions).toContain(SubscriptionAction.CANCEL_IMMEDIATELY);
      expect(actions).toContain(SubscriptionAction.TERMINATE);
      expect(actions).toHaveLength(3);
    });

    it('COMPLIMENTARY has REVOKE_COMPLIMENTARY, ACTIVATE, TERMINATE', () => {
      const actions = getValidActions(SubscriptionState.COMPLIMENTARY);
      expect(actions).toContain(SubscriptionAction.REVOKE_COMPLIMENTARY);
      expect(actions).toContain(SubscriptionAction.ACTIVATE);
      expect(actions).toContain(SubscriptionAction.TERMINATE);
      expect(actions).toHaveLength(3);
    });

    it('TRIALING has CONVERT_TRIAL, EXPIRE_TRIAL, CANCEL_IMMEDIATELY, TERMINATE', () => {
      const actions = getValidActions(SubscriptionState.TRIALING);
      expect(actions).toContain(SubscriptionAction.CONVERT_TRIAL);
      expect(actions).toContain(SubscriptionAction.EXPIRE_TRIAL);
      expect(actions).toContain(SubscriptionAction.CANCEL_IMMEDIATELY);
      expect(actions).toContain(SubscriptionAction.TERMINATE);
      expect(actions).toHaveLength(4);
    });

    it('PAST_DUE has RENEW, ENTER_GRACE_PERIOD, CANCEL_IMMEDIATELY, TERMINATE', () => {
      const actions = getValidActions(SubscriptionState.PAST_DUE);
      expect(actions).toContain(SubscriptionAction.RENEW);
      expect(actions).toContain(SubscriptionAction.ENTER_GRACE_PERIOD);
      expect(actions).toContain(SubscriptionAction.CANCEL_IMMEDIATELY);
      expect(actions).toContain(SubscriptionAction.TERMINATE);
      expect(actions).toHaveLength(4);
    });

    it('GRACE_PERIOD has RENEW, SUSPEND, CANCEL_IMMEDIATELY, TERMINATE', () => {
      const actions = getValidActions(SubscriptionState.GRACE_PERIOD);
      expect(actions).toContain(SubscriptionAction.RENEW);
      expect(actions).toContain(SubscriptionAction.SUSPEND);
      expect(actions).toContain(SubscriptionAction.CANCEL_IMMEDIATELY);
      expect(actions).toContain(SubscriptionAction.TERMINATE);
      expect(actions).toHaveLength(4);
    });

    it('MIGRATING has ACTIVATE, CANCEL_IMMEDIATELY, TERMINATE', () => {
      const actions = getValidActions(SubscriptionState.MIGRATING);
      expect(actions).toContain(SubscriptionAction.ACTIVATE);
      expect(actions).toContain(SubscriptionAction.CANCEL_IMMEDIATELY);
      expect(actions).toContain(SubscriptionAction.TERMINATE);
      expect(actions).toHaveLength(3);
    });

    it('CANCELLED has REACTIVATE, TERMINATE', () => {
      const actions = getValidActions(SubscriptionState.CANCELLED);
      expect(actions).toContain(SubscriptionAction.REACTIVATE);
      expect(actions).toContain(SubscriptionAction.TERMINATE);
      expect(actions).toHaveLength(2);
    });

    it('EXPIRED has ACTIVATE, TERMINATE', () => {
      const actions = getValidActions(SubscriptionState.EXPIRED);
      expect(actions).toContain(SubscriptionAction.ACTIVATE);
      expect(actions).toContain(SubscriptionAction.TERMINATE);
      expect(actions).toHaveLength(2);
    });

    it('TRIAL_EXPIRED has ACTIVATE, TERMINATE', () => {
      const actions = getValidActions(SubscriptionState.TRIAL_EXPIRED);
      expect(actions).toContain(SubscriptionAction.ACTIVATE);
      expect(actions).toContain(SubscriptionAction.TERMINATE);
      expect(actions).toHaveLength(2);
    });
  });

  // ====================================================================
  // Side Effects
  // ====================================================================

  describe('side effects', () => {
    it('PROVISIONING → ACTIVATE includes AUDIT_LOG, HISTORY_LOG, UPDATE_ENTITLEMENTS, SCHEDULE_EVENT', () => {
      const result = transition(SubscriptionState.PROVISIONING, SubscriptionAction.ACTIVATE);
      expect(result.success).toBe(true);
      if (result.success) {
        const types = result.sideEffects.map((se) => se.type);
        expect(types).toContain(SideEffectType.AUDIT_LOG);
        expect(types).toContain(SideEffectType.HISTORY_LOG);
        expect(types).toContain(SideEffectType.UPDATE_ENTITLEMENTS);
        expect(types).toContain(SideEffectType.SCHEDULE_EVENT);
      }
    });

    it('PROVISIONING → START_TRIAL includes trial-specific side effects', () => {
      const result = transition(SubscriptionState.PROVISIONING, SubscriptionAction.START_TRIAL);
      expect(result.success).toBe(true);
      if (result.success) {
        const types = result.sideEffects.map((se) => se.type);
        expect(types).toContain(SideEffectType.UPDATE_TRIAL_RECORD);
        expect(types).toContain(SideEffectType.SCHEDULE_EVENT);
        expect(types).toContain(SideEffectType.SEND_NOTIFICATION);
      }
    });

    it('TRIALING → CONVERT_TRIAL includes CREATE_INVOICE and CANCEL_SCHEDULED_EVENT', () => {
      const result = transition(SubscriptionState.TRIALING, SubscriptionAction.CONVERT_TRIAL);
      expect(result.success).toBe(true);
      if (result.success) {
        const types = result.sideEffects.map((se) => se.type);
        expect(types).toContain(SideEffectType.CREATE_INVOICE);
        expect(types).toContain(SideEffectType.CANCEL_SCHEDULED_EVENT);
        expect(types).toContain(SideEffectType.UPDATE_TRIAL_RECORD);
      }
    });

    it('ACTIVE → UPGRADE includes CREATE_MIGRATION_RECORD and PRORATE_PAYMENT', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.UPGRADE);
      expect(result.success).toBe(true);
      if (result.success) {
        const types = result.sideEffects.map((se) => se.type);
        expect(types).toContain(SideEffectType.CREATE_MIGRATION_RECORD);
        expect(types).toContain(SideEffectType.PRORATE_PAYMENT);
      }
    });

    it('ACTIVE → DOWNGRADE includes CREATE_MIGRATION_RECORD and PRORATE_PAYMENT', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.DOWNGRADE);
      expect(result.success).toBe(true);
      if (result.success) {
        const types = result.sideEffects.map((se) => se.type);
        expect(types).toContain(SideEffectType.CREATE_MIGRATION_RECORD);
        expect(types).toContain(SideEffectType.PRORATE_PAYMENT);
      }
    });

    it('ACTIVE → PAYMENT_FAILED includes SEND_NOTIFICATION', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.PAYMENT_FAILED);
      expect(result.success).toBe(true);
      if (result.success) {
        const types = result.sideEffects.map((se) => se.type);
        expect(types).toContain(SideEffectType.SEND_NOTIFICATION);
      }
    });

    it('ACTIVE → RENEW includes RESET_QUOTAS and CREATE_INVOICE', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.RENEW);
      expect(result.success).toBe(true);
      if (result.success) {
        const types = result.sideEffects.map((se) => se.type);
        expect(types).toContain(SideEffectType.RESET_QUOTAS);
        expect(types).toContain(SideEffectType.CREATE_INVOICE);
      }
    });

    it('TERMINATE always includes CANCEL_SCHEDULED_EVENT with eventType all', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.TERMINATE);
      expect(result.success).toBe(true);
      if (result.success) {
        const cancelEvent = result.sideEffects.find(
          (se) => se.type === SideEffectType.CANCEL_SCHEDULED_EVENT,
        );
        expect(cancelEvent).toBeDefined();
        expect(cancelEvent?.payload).toEqual({ eventType: 'all' });
      }
    });

    it('COMPLIMENTARY → REVOKE_COMPLIMENTARY includes UPDATE_ENTITLEMENTS', () => {
      const result = transition(SubscriptionState.COMPLIMENTARY, SubscriptionAction.REVOKE_COMPLIMENTARY);
      expect(result.success).toBe(true);
      if (result.success) {
        const types = result.sideEffects.map((se) => se.type);
        expect(types).toContain(SideEffectType.UPDATE_ENTITLEMENTS);
        expect(types).toContain(SideEffectType.SEND_NOTIFICATION);
      }
    });

    it('ACTIVE → PAUSE includes CANCEL_SCHEDULED_EVENT and SEND_NOTIFICATION', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.PAUSE);
      expect(result.success).toBe(true);
      if (result.success) {
        const types = result.sideEffects.map((se) => se.type);
        expect(types).toContain(SideEffectType.AUDIT_LOG);
        expect(types).toContain(SideEffectType.HISTORY_LOG);
        expect(types).toContain(SideEffectType.CANCEL_SCHEDULED_EVENT);
        expect(types).toContain(SideEffectType.SEND_NOTIFICATION);
        const notification = result.sideEffects.find(
          (se) => se.type === SideEffectType.SEND_NOTIFICATION,
        );
        expect(notification?.payload).toEqual({ template: 'subscription_paused' });
      }
    });

    it('GRACE_PERIOD → SUSPEND includes UPDATE_ENTITLEMENTS', () => {
      const result = transition(SubscriptionState.GRACE_PERIOD, SubscriptionAction.SUSPEND);
      expect(result.success).toBe(true);
      if (result.success) {
        const types = result.sideEffects.map((se) => se.type);
        expect(types).toContain(SideEffectType.UPDATE_ENTITLEMENTS);
        expect(types).toContain(SideEffectType.CANCEL_SCHEDULED_EVENT);
      }
    });

    it('all valid transitions include AUDIT_LOG and HISTORY_LOG', () => {
      for (const state of Object.values(SubscriptionState)) {
        for (const action of Object.values(SubscriptionAction)) {
          const result = transition(state, action);
          if (result.success) {
            const types = result.sideEffects.map((se) => se.type);
            expect(types).toContain(SideEffectType.AUDIT_LOG);
            expect(types).toContain(SideEffectType.HISTORY_LOG);
          }
        }
      }
    });
  });

  // ====================================================================
  // TransitionResult structure
  // ====================================================================

  describe('TransitionResult structure', () => {
    it('success result has correct shape', () => {
      const result = transition(SubscriptionState.ACTIVE, SubscriptionAction.RENEW);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.fromState).toBe(SubscriptionState.ACTIVE);
        expect(result.toState).toBe(SubscriptionState.ACTIVE);
        expect(result.action).toBe(SubscriptionAction.RENEW);
        expect(Array.isArray(result.sideEffects)).toBe(true);
      }
    });

    it('failure result has correct shape', () => {
      const result = transition(SubscriptionState.TERMINATED, SubscriptionAction.ACTIVATE);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.fromState).toBe(SubscriptionState.TERMINATED);
        expect(result.action).toBe(SubscriptionAction.ACTIVATE);
        expect(typeof result.error).toBe('string');
        expect(result.error.length).toBeGreaterThan(0);
      }
    });
  });
});
