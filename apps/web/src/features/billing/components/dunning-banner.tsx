'use client';

import { AlertTriangleIcon } from 'lucide-react';

import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

/**
 * Dunning banner for the billing page. Rendered when a recurring subscription
 * is in the failed-payment window (`past_due` / `grace_period`). Xendit retries
 * the cycle automatically; the user keeps access until the period/grace end,
 * after which they lose paid features. Warm-editorial amber styling matches the
 * near-limit warnings used elsewhere (see settings/usage).
 */
export function DunningBanner({ periodEnd }: { periodEnd: string | null }) {
  const endDate = periodEnd
    ? new Date(periodEnd).toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <Alert
      role="alert"
      className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <AlertTriangleIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      <AlertTitle className="text-amber-900 dark:text-amber-200">
        We couldn&apos;t process your latest payment
      </AlertTitle>
      <AlertDescription className="text-amber-800 dark:text-amber-300">
        Xendit will retry automatically. Update your payment method to avoid
        losing access
        {endDate ? ` on ${endDate}` : ' when the retry window closes'}.
      </AlertDescription>
    </Alert>
  );
}
