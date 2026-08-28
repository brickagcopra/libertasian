'use client';

import { Suspense } from 'react';

import { AuthorizeForm } from './authorize-form';

/**
 * `/billing/authorize?ref=…&success=…&cancel=…`
 *
 * Where `createSubscriptionSession` sends the customer for gateways that have
 * no hosted subscription checkout (PayMongo). `ref` is our LOCAL Subscription
 * id — the gateway's own id is never put in a user-visible URL.
 *
 * The form reads those query parameters with `useSearchParams`, which Next
 * requires to sit under a Suspense boundary; without one the whole route
 * opts out of static rendering at build time.
 */
export default function BillingAuthorizePage() {
  return (
    <Suspense
      fallback={<main className="min-h-screen bg-[#F6F1E8]" aria-busy="true" />}
    >
      <AuthorizeForm />
    </Suspense>
  );
}
