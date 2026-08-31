/**
 * Advancing a billing period by a month or a year, without the month-end
 * rollover bug.
 *
 * THE BUG THIS EXISTS TO PREVENT
 * `d.setMonth(d.getMonth() + 1)` does not clamp. When the source day does not
 * exist in the target month, JS rolls forward into the month after:
 *
 *     2026-08-31 + 1 month  →  2026-10-01   (Sep 31 does not exist)
 *     2026-01-31 + 1 month  →  2026-03-03   (Feb 31 does not exist)
 *     2028-02-29 + 1 year   →  2029-03-01   (Feb 29 2029 does not exist)
 *
 * So a subscriber whose period was cut on the 31st had it advanced by TWO
 * months and got one free. The same defect sat in the annual branch beside
 * every monthly one. This was six call sites, all identical; they now all come
 * through here.
 *
 * SEMANTICS: clamp to the last valid day of the target month.
 *
 *     Aug 31 + 1mo → Sep 30        Jan 31 + 1mo → Feb 28 (Feb 29 in a leap year)
 *     May 31 + 1mo → Jun 30        Dec 31 + 1mo → Jan 31 (no clamp needed)
 *     Feb 29 + 1yr → Feb 28        the 15th + 1mo → the 15th, always
 *
 * Time of day is preserved: only the date fields are touched.
 *
 * KNOWN, ACCEPTED DRIFT — clamping is not idempotent across renewals. An anchor
 * cut on the 31st lands on the 30th at its first renewal, and STAYS on the 30th
 * at the second (Sep 30 → Oct 30, not Oct 31), because these call sites advance
 * from the CURRENT period end rather than from a stored anchor day. A
 * subscriber billed on Jan 31 therefore walks 31 → 28 → 28 → …
 *
 * That is deliberate and is strictly better than the bug it replaces: drifting
 * a day or two earlier costs the subscriber nothing and never grants a free
 * month, whereas the rollover did exactly that. Fixing the drift properly means
 * persisting the original anchor day on the subscription and billing from it,
 * which is a schema change and a separate piece of work. Follow-up, not here.
 */

/** Days in a given month. `month` is 0-indexed, matching `Date.getMonth()`. */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the NEXT month is the last day of this one.
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Add `months` calendar months to `from`, clamping to the last valid day of the
 * target month. Local-time semantics, matching the `setMonth`/`setFullYear`
 * calls this replaces — switching to UTC here would silently shift every
 * existing period boundary.
 */
export function addMonthsClamped(from: Date, months: number): Date {
  const d = new Date(from);
  const anchorDay = d.getDate();

  // Move to the 1st BEFORE changing the month. Without this, setMonth() would
  // roll over on the way past a short month and we would be clamping a date
  // that is already wrong.
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  d.setDate(Math.min(anchorDay, daysInMonth(d.getFullYear(), d.getMonth())));

  return d;
}

/**
 * Advance `from` by exactly one billing period.
 *
 * `billingPeriod` is the subscription's raw string. Anything that is not
 * `'annual'` is treated as monthly — matching the `if (x === 'annual') … else`
 * shape at all six former call sites, so this is not a behaviour change.
 */
export function addBillingPeriod(from: Date, billingPeriod: string): Date {
  return addMonthsClamped(from, billingPeriod === 'annual' ? 12 : 1);
}
