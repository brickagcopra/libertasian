/**
 * Currency utilities for the accounting system.
 * All monetary values are stored as integers (centavos = PHP × 100).
 */

/**
 * Format centavos as a PHP currency string.
 * e.g. 99900 → "₱999.00"
 */
export function formatPhp(centavos: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(centavos / 100);
}

/**
 * Safe percentage calculation that avoids division by zero.
 * Returns basis points (e.g. 2.5% = 250).
 */
export function safePercentBps(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10000);
}

/**
 * Compute variance between actual and budgeted amounts.
 * Returns { amount, percent, favorable }.
 */
export function computeVariance(
  actual: number,
  budgeted: number,
  isExpense: boolean,
): { amount: number; percentBps: number; favorable: boolean } {
  const amount = actual - budgeted;
  const percentBps = safePercentBps(amount, budgeted);

  // For expenses, under-budget is favorable. For revenue, over-budget is favorable.
  const favorable = isExpense ? amount < 0 : amount > 0;

  return { amount, percentBps, favorable };
}

/**
 * Convert centavos to PHP (whole currency units).
 */
export function centavosToPesos(centavos: number): number {
  return centavos / 100;
}

/**
 * Convert PHP (whole currency units) to centavos.
 */
export function pesosToCentavos(pesos: number): number {
  return Math.round(pesos * 100);
}
