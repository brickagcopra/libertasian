'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';

import type { AnalyticsRetentionCohortRow } from '@libertasian/types';
import type { HeatmapCell } from '@/components/charts/heatmap';

const Heatmap = dynamic(
  () => import('@/components/charts/heatmap').then((mod) => mod.Heatmap),
  { ssr: false },
);

interface RetentionHeatmapProps {
  cohorts: AnalyticsRetentionCohortRow[];
  className?: string;
}

export function RetentionHeatmap({ cohorts, className }: RetentionHeatmapProps) {
  const heatmapData: HeatmapCell[] = useMemo(() => {
    return cohorts.map((row) => ({
      row: row.cohortWeek,
      col: `W${row.retentionWeek}`,
      value: Math.round(row.retentionRate * 100),
    }));
  }, [cohorts]);

  if (heatmapData.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No retention data</p>
    );
  }

  return (
    <div className={className}>
      <Heatmap data={heatmapData} width={700} height={400} />
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Values represent retention rate (%). Rows = cohort weeks, Columns = weeks since signup.
      </p>
    </div>
  );
}
