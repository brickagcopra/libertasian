import {
  accessibleSubscriptionWhere,
  STALE_PAST_DUE_DAYS,
} from './subscriptions.service';
import { ACCESSIBLE_STATE_VALUES } from './subscription-state-machine';

describe('accessibleSubscriptionWhere', () => {
  const now = new Date('2026-11-22T12:00:00Z');
  const where = accessibleSubscriptionWhere('org-1', now);

  // Mirrors the Prisma filter so the rule is checked on concrete rows.
  const grants = (row: { status: string; currentPeriodEnd: Date | null }): boolean => {
    if (!ACCESSIBLE_STATE_VALUES.includes(row.status)) return false;
    const not = where.NOT as { status: string; currentPeriodEnd: { lt: Date } };
    const excluded =
      row.status === not.status &&
      row.currentPeriodEnd !== null &&
      row.currentPeriodEnd < not.currentPeriodEnd.lt;
    return !excluded;
  };
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

  it('scopes to the organization and the accessible states', () => {
    expect(where.organizationId).toBe('org-1');
    expect(where.status).toEqual({ in: ACCESSIBLE_STATE_VALUES });
  });

  it('drops a past_due row whose period ended more than the backstop ago', () => {
    // The prod case: Xendit Team row, period ended 2026-08-14, still past_due.
    expect(grants({ status: 'past_due', currentPeriodEnd: new Date('2026-08-14T22:55:26Z') })).toBe(false);
    expect(grants({ status: 'past_due', currentPeriodEnd: daysAgo(STALE_PAST_DUE_DAYS + 1) })).toBe(false);
  });

  it('keeps a past_due row inside any store grace or retry window', () => {
    expect(grants({ status: 'past_due', currentPeriodEnd: daysAgo(16) })).toBe(true);
    expect(grants({ status: 'past_due', currentPeriodEnd: daysAgo(STALE_PAST_DUE_DAYS - 1) })).toBe(true);
    expect(grants({ status: 'past_due', currentPeriodEnd: null })).toBe(true);
  });

  it('leaves every other accessible state alone, however old', () => {
    for (const status of ['active', 'complimentary', 'cancelling', 'grace_period']) {
      expect(grants({ status, currentPeriodEnd: daysAgo(365) })).toBe(true);
    }
  });
});
