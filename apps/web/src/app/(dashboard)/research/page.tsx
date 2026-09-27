'use client';

import { Suspense } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { DeepResearchPage } from '@/features/deep-research/components/deep-research-page';

/**
 * /research — Deep Research. `?q=` prefills the composer (the search page's
 * "Go deeper" button and "Ask a follow-up" use it); `?run=<id>` opens a saved
 * run. The Suspense boundary is what `useSearchParams` needs to build.
 */
export default function ResearchPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <DeepResearchPage />
    </Suspense>
  );
}
