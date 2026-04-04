'use client';

import type { AnalyticsFunnelStepRow } from '@libertasian/types';

interface FunnelChartProps {
  steps: AnalyticsFunnelStepRow[];
  className?: string;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-PH').format(value);
}

export function FunnelChart({ steps, className }: FunnelChartProps) {
  const sorted = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
  const maxEntered = sorted[0]?.enteredCount ?? 1;

  return (
    <div className={className}>
      <div className="space-y-3">
        {sorted.map((step, i) => {
          const widthPercent = maxEntered > 0 ? (step.enteredCount / maxEntered) * 100 : 0;
          const conversionRate =
            i > 0 && sorted[i - 1].enteredCount > 0
              ? step.enteredCount / sorted[i - 1].enteredCount
              : 1;

          return (
            <div key={step.id}>
              {/* Conversion arrow between steps */}
              {i > 0 && (
                <div className="my-1 flex items-center gap-2 pl-2 text-xs text-muted-foreground">
                  <span className="text-lg leading-none">↓</span>
                  <span>{formatPercent(conversionRate)} conversion</span>
                  <span className="text-red-500">
                    ({formatNumber(sorted[i - 1].enteredCount - step.enteredCount)} dropped)
                  </span>
                </div>
              )}

              {/* Step bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium capitalize">
                    {step.stepName.replace(/_/g, ' ')}
                  </span>
                  <span className="text-muted-foreground">
                    {formatNumber(step.enteredCount)} entered
                  </span>
                </div>
                <div className="h-8 w-full rounded bg-muted">
                  <div
                    className="flex h-full items-center rounded bg-indigo-500 px-3 text-xs font-medium text-white transition-all"
                    style={{ width: `${Math.max(widthPercent, 2)}%` }}
                  >
                    {widthPercent >= 15 && formatNumber(step.completedCount)}
                  </div>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Completed: {formatNumber(step.completedCount)}</span>
                  <span>Dropped: {formatNumber(step.droppedCount)}</span>
                  {step.medianTimeSeconds != null && (
                    <span>Median: {step.medianTimeSeconds.toFixed(0)}s</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {sorted.length >= 2 && (
        <div className="mt-4 rounded-lg border p-3 text-center">
          <p className="text-sm text-muted-foreground">Overall Conversion</p>
          <p className="text-2xl font-bold">
            {formatPercent(
              maxEntered > 0
                ? (sorted[sorted.length - 1].completedCount) / maxEntered
                : 0,
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatNumber(sorted[sorted.length - 1].completedCount)} of{' '}
            {formatNumber(maxEntered)} completed
          </p>
        </div>
      )}
    </div>
  );
}
