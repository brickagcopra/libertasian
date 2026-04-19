import type { PlanDetail } from '@/features/billing/types';

import { PricingPageClient } from './pricing-page-client';

export const revalidate = 60;

export default async function PricingPage() {
  const dynamicEnabled = process.env['DYNAMIC_PRICING_ENABLED'] !== 'false';
  let initialPlans: PlanDetail[] | undefined;
  let fetchError = false;

  if (dynamicEnabled) {
    try {
      const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001';
      const res = await fetch(`${apiUrl}/api/v1/plans`, {
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
