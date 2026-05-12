import type { Metadata } from 'next';

import type { PlanDetail } from '@/features/billing/types';

import { PricingPageClient } from './pricing-page-client';

export const metadata: Metadata = {
  title: 'Pricing',
};

export const revalidate = 60;

export default async function PricingPage() {
  const dynamicEnabled = process.env['DYNAMIC_PRICING_ENABLED'] !== 'false';
  let initialPlans: PlanDetail[] | undefined;
  let fetchError = false;

  if (dynamicEnabled) {
    try {
      const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';
      const res = await fetch(`${apiUrl}/plans`, {
        next: { revalidate: 60 },
      });
      if (res.ok) {
        const json = await res.json();
        initialPlans = json.data;
      }
    } catch (err) {
      fetchError = true;
      console.error('[pricing] Failed to fetch plans from API', err);
    }
  }

  return (
    <PricingPageClient
      initialPlans={initialPlans}
      dynamicEnabled={dynamicEnabled}
      fetchError={fetchError}
    />
  );
}
