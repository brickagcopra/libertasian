/**
 * Pure formatting helpers shared by billing lifecycle emails
 * (renewal reminder, recurring receipt, failed-cycle notice).
 */

/** Format centavos as a PHP display amount, e.g. 199900 → "1,999.00". */
export function formatPhpAmount(centavos: number): string {
  return (centavos / 100).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Human label for a stored payment instrument, e.g. "Visa •••• 4242". */
export function describePaymentMethod(
  pm: { type: string; brand: string | null; last4: string | null } | null,
): string {
  if (!pm) return 'your saved payment method';
  const brand =
    pm.brand ??
    (pm.type === 'gcash' ? 'GCash' : pm.type === 'maya' ? 'Maya' : 'Card');
  return pm.last4 ? `${brand} •••• ${pm.last4}` : brand;
}

/** Long-form date for billing emails, e.g. "July 6, 2026". */
export function formatBillingDate(date: Date): string {
  return date.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
