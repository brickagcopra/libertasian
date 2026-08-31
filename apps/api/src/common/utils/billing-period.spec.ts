import { addBillingPeriod, addMonthsClamped } from './billing-period';

/** Local-time date, matching the helper's local-time semantics. */
const at = (y: number, m: number, d: number, h = 0, min = 0): Date =>
  new Date(y, m - 1, d, h, min);

/** `YYYY-MM-DD` in local time, so assertions are readable and TZ-stable. */
const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

describe('addMonthsClamped', () => {
  describe('clamps to the last valid day of the target month', () => {
    const cases: ReadonlyArray<[string, Date, number, string]> = [
      // The production bug: Sep has no 31st, so setMonth rolled to Oct 1 and
      // the subscriber got a free month.
      ['Aug 31 + 1mo → Sep 30', at(2026, 8, 31), 1, '2026-09-30'],
      ['Jan 31 + 1mo → Feb 28 (common year)', at(2026, 1, 31), 1, '2026-02-28'],
      ['Jan 31 + 1mo → Feb 29 (leap year)', at(2028, 1, 31), 1, '2028-02-29'],
      ['May 31 + 1mo → Jun 30', at(2026, 5, 31), 1, '2026-06-30'],
      ['Mar 31 + 1mo → Apr 30', at(2026, 3, 31), 1, '2026-04-30'],
      ['Oct 31 + 1mo → Nov 30', at(2026, 10, 31), 1, '2026-11-30'],
      // No clamp needed — Jan has 31 days, and the year rolls over.
      ['Dec 31 + 1mo → Jan 31', at(2026, 12, 31), 1, '2027-01-31'],
      // A day that exists in every month is never touched.
      ['the 15th + 1mo → the 15th', at(2026, 8, 15), 1, '2026-09-15'],
      ['the 15th + 1mo across year end', at(2026, 12, 15), 1, '2027-01-15'],
      ['Jan 30 + 1mo → Feb 28', at(2026, 1, 30), 1, '2026-02-28'],
      ['Jan 29 + 1mo → Feb 28 (common year)', at(2026, 1, 29), 1, '2026-02-28'],
      ['Jan 29 + 1mo → Feb 29 (leap year)', at(2028, 1, 29), 1, '2028-02-29'],
      // Annual, expressed in months.
      ['Feb 29 + 12mo → Feb 28', at(2028, 2, 29), 12, '2029-02-28'],
      ['Feb 29 + 48mo → Feb 29 (next leap year)', at(2028, 2, 29), 48, '2032-02-29'],
      ['Aug 31 + 12mo → Aug 31', at(2026, 8, 31), 12, '2027-08-31'],
    ];

    it.each(cases)('%s', (_label, from, months, expected) => {
      expect(ymd(addMonthsClamped(from, months))).toBe(expected);
    });
  });

  it('never advances more than the requested number of months', () => {
    // The defining property of the bug: the month index must move by exactly
    // `months`, never by one more. Swept over every day of every month of a
    // leap year and the year after it.
    for (const year of [2028, 2029]) {
      for (let month = 1; month <= 12; month++) {
        const lastDay = new Date(year, month, 0).getDate();
        for (let day = 1; day <= lastDay; day++) {
          const from = at(year, month, day);
          const got = addMonthsClamped(from, 1);

          const expectedMonthIndex = (from.getMonth() + 1) % 12;
          expect(got.getMonth()).toBe(expectedMonthIndex);
          expect(got.getDate()).toBeLessThanOrEqual(day);
        }
      }
    }
  });

  it('preserves the time of day', () => {
    const got = addMonthsClamped(at(2026, 8, 31, 13, 45), 1);

    expect(ymd(got)).toBe('2026-09-30');
    expect(got.getHours()).toBe(13);
    expect(got.getMinutes()).toBe(45);
  });

  it('does not mutate its argument', () => {
    const from = at(2026, 8, 31);
    addMonthsClamped(from, 1);

    expect(ymd(from)).toBe('2026-08-31');
  });

  it('walks a 31st anchor across THREE chained renewals without ever gaining a month', () => {
    // Chained from each previous period end, which is how the call sites
    // advance. Documents the accepted drift: 31 → 30 → 30 → 30, never 31 → Oct.
    const r1 = addMonthsClamped(at(2026, 8, 31), 1);
    const r2 = addMonthsClamped(r1, 1);
    const r3 = addMonthsClamped(r2, 1);

    expect(ymd(r1)).toBe('2026-09-30');
    expect(ymd(r2)).toBe('2026-10-30'); // drift: NOT Oct 31 — see helper docs
    expect(ymd(r3)).toBe('2026-11-30');

    // Three renewals must land three months out, not four or five.
    expect(r3.getFullYear()).toBe(2026);
    expect(r3.getMonth()).toBe(10); // November
  });

  it('walks a Jan 31 anchor through February three renewals deep', () => {
    const r1 = addMonthsClamped(at(2026, 1, 31), 1);
    const r2 = addMonthsClamped(r1, 1);
    const r3 = addMonthsClamped(r2, 1);

    expect(ymd(r1)).toBe('2026-02-28');
    expect(ymd(r2)).toBe('2026-03-28');
    expect(ymd(r3)).toBe('2026-04-28');
  });
});

describe('addBillingPeriod', () => {
  it('advances one month for a monthly period', () => {
    expect(ymd(addBillingPeriod(at(2026, 8, 31), 'monthly'))).toBe('2026-09-30');
  });

  it('advances one year for an annual period', () => {
    expect(ymd(addBillingPeriod(at(2028, 2, 29), 'annual'))).toBe('2029-02-28');
  });

  it('treats any non-annual value as monthly', () => {
    // Mirrors the `if (x === 'annual') … else` at all six former call sites;
    // this is not a behaviour change.
    for (const value of ['monthly', 'month', '', 'MONTHLY', 'quarterly']) {
      expect(ymd(addBillingPeriod(at(2026, 8, 31), value))).toBe('2026-09-30');
    }
  });

  it('is exactly the pre-fix behaviour whenever the day exists in the target month', () => {
    // The fix must be a no-op for the overwhelming majority of anchors — the
    // 1st through the 28th — or it would silently move existing periods.
    for (let day = 1; day <= 28; day++) {
      const from = at(2026, 8, day);

      const legacy = new Date(from);
      legacy.setMonth(legacy.getMonth() + 1);

      expect(ymd(addBillingPeriod(from, 'monthly'))).toBe(ymd(legacy));
    }
  });
});
