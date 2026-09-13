'use client';

import { AlertTriangle, Clock, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * How stale the aggregation pipeline may be before the dashboard says so.
 * 48h, not 24h: the job runs daily, so one missed fire is still a working
 * pipeline that has not had its turn yet, while two means something is wrong.
 */
export const STALE_AFTER_HOURS = 48;

export interface AggregationFreshnessProps {
  /** `YYYY-MM-DD` of the newest aggregated day, null if nothing ever ran. */
  lastAggregatedAt: string | null | undefined;
  onRefresh: () => void;
  isRefreshing?: boolean;
  /** Injectable for tests. */
  now?: Date;
}

function hoursSince(dateStr: string, now: Date): number {
  // The stamp is a calendar date, so measure from the END of that UTC day —
  // metrics for the 11th are complete some time on the 12th, and measuring from
  // midnight would report a healthy pipeline as 24h stale the moment it ran.
  const dayEnd = new Date(`${dateStr}T00:00:00.000Z`);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  return (now.getTime() - dayEnd.getTime()) / (60 * 60 * 1000);
}

/**
 * "Metrics last computed <date>", with a warning when the pipeline has not run
 * in `STALE_AFTER_HOURS`.
 *
 * This line exists because a dashboard that cannot distinguish "zero" from
 * "never ran" is the bug that produced this whole thread: the aggregation cron
 * silently skipped 2026-09-12 when a deploy restart straddled its fire minute,
 * and every panel rendered the hole as a legitimate row of zeros.
 */
export function AggregationFreshness({
  lastAggregatedAt,
  onRefresh,
  isRefreshing = false,
  now = new Date(),
}: AggregationFreshnessProps) {
  const never = !lastAggregatedAt;
  const ageHours = lastAggregatedAt ? hoursSince(lastAggregatedAt, now) : Infinity;
  const stale = never || ageHours > STALE_AFTER_HOURS;

  return (
    <div
      className={
        stale
          ? 'flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2'
          : 'flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2'
      }
      data-testid="aggregation-freshness"
    >
      <div className="flex items-center gap-2 text-sm">
        {stale ? (
          <AlertTriangle className="size-4 text-destructive" />
        ) : (
          <Clock className="size-4 text-muted-foreground" />
        )}
        <span className={stale ? 'text-destructive' : 'text-muted-foreground'}>
          {never
            ? 'Metrics have never been computed — the aggregation job has not run yet.'
            : `Metrics last computed ${lastAggregatedAt}.`}
          {stale && !never
            ? ` That is more than ${STALE_AFTER_HOURS}h ago — the numbers below may be stale, not zero.`
            : ''}
        </span>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRefresh}
        disabled={isRefreshing}
        aria-label="Refresh metrics"
      >
        <RefreshCw className={isRefreshing ? 'size-4 animate-spin' : 'size-4'} />
        {isRefreshing ? 'Refreshing…' : 'Refresh'}
      </Button>
    </div>
  );
}
