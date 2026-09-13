'use client';

import { useMemo } from 'react';
import { AlertTriangle, Compass } from 'lucide-react';

import type { AnalyticsDailyAggregateRow } from '@libertasian/types';
import { selectMetricRowsByDimension } from '@/features/analytics/hooks/use-analytics-dashboard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

/** Operator-facing names for the surfaces the route map produces. */
const SURFACE_LABELS: Record<string, string> = {
  digests: 'Digests',
  bar_exams: 'Bar exams',
  library: 'Library',
  codals: 'Codals & reader',
  scans: 'Camera scans',
  feed: 'Feed',
  search: 'Search',
  study: 'Study',
  workspace: 'Workspace',
  admin: 'Admin',
  other: 'Unmapped routes',
};

const PLATFORM_LABELS: Record<string, string> = {
  ios: 'iOS',
  android: 'Android',
  web: 'Web',
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-PH').format(value);
}

function surfaceLabel(key: string): string {
  return SURFACE_LABELS[key] ?? key;
}

interface SurfaceRow {
  key: string;
  label: string;
  views: number;
  uniqueUsers: number;
}

export interface SurfaceUsagePanelProps {
  metrics: AnalyticsDailyAggregateRow[];
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
}

/**
 * "Where users go" — surfaces ranked by views and unique users, plus the
 * platform split for DAU and sessions.
 *
 * Every number here comes from DIMENSIONED aggregate rows, read through
 * `selectMetricRowsByDimension`. Views sum across days; unique users take the
 * MAXIMUM across days rather than a sum, because the same person visiting a
 * surface on Monday and Tuesday is one user, not two — summing would report a
 * figure larger than the user base.
 */
export function SurfaceUsagePanel({
  metrics,
  isLoading = false,
  isError = false,
  error,
}: SurfaceUsagePanelProps) {
  const surfaces: SurfaceRow[] = useMemo(() => {
    const bySurface = selectMetricRowsByDimension(metrics, 'surface_views', 'surface:');

    return Object.entries(bySurface)
      .map(([key, rows]) => ({
        key,
        label: surfaceLabel(key),
        views: rows.reduce((sum, r) => sum + r.metricValue, 0),
        uniqueUsers: rows.reduce((max, r) => Math.max(max, r.uniqueUsers), 0),
      }))
      .sort((a, b) => b.views - a.views || a.label.localeCompare(b.label));
  }, [metrics]);

  const platformSplit = useMemo(() => {
    const dau = selectMetricRowsByDimension(metrics, 'dau', 'platform:');
    const sessions = selectMetricRowsByDimension(metrics, 'sessions', 'platform:');

    const keys = [...new Set([...Object.keys(dau), ...Object.keys(sessions)])].sort();

    return keys.map((key) => ({
      key,
      label: PLATFORM_LABELS[key] ?? key,
      // DAU is a point-in-time count, so the latest day in the range is the
      // meaningful figure — summing 30 daily actives is not a number that
      // describes anything.
      dau: latestValue(dau[key] ?? []),
      sessions: (sessions[key] ?? []).reduce((sum, r) => sum + r.metricValue, 0),
    }));
  }, [metrics]);

  const totalViews = surfaces.reduce((sum, s) => sum + s.views, 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Compass className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium">Where users go</CardTitle>
        </div>
        <CardDescription>
          Surfaces ranked by page views in the selected range, and the platform split for
          daily actives and sessions
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isError ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Could not load surface usage</AlertTitle>
            <AlertDescription>
              {error instanceof Error ? error.message : 'Unknown error'}
            </AlertDescription>
          </Alert>
        ) : isLoading ? (
          <div className="space-y-2" data-testid="surface-usage-loading">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : (
          <>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Surfaces
              </h3>
              {surfaces.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No surface views recorded in this range
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">Surface</th>
                        <th className="py-2 pr-4 text-right font-medium">Views</th>
                        <th className="py-2 pr-4 text-right font-medium">Unique users</th>
                        <th className="py-2 text-right font-medium">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {surfaces.map((surface) => (
                        <tr key={surface.key} className="border-b last:border-0">
                          <td className="py-2 pr-4">{surface.label}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {formatNumber(surface.views)}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {formatNumber(surface.uniqueUsers)}
                          </td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">
                            {totalViews > 0
                              ? `${Math.round((surface.views / totalViews) * 100)}%`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Platform split
              </h3>
              {platformSplit.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No platform breakdown recorded in this range
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">Platform</th>
                        <th className="py-2 pr-4 text-right font-medium">DAU (latest day)</th>
                        <th className="py-2 text-right font-medium">Sessions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {platformSplit.map((row) => (
                        <tr key={row.key} className="border-b last:border-0">
                          <td className="py-2 pr-4">{row.label}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {formatNumber(row.dau)}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {formatNumber(row.sessions)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Platform rows do not sum to the DAU total: a user known only from an
                analytics event has no platform signal. Read the KPI card for the total.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Value on the most recent date in a set of daily rows. */
function latestValue(rows: AnalyticsDailyAggregateRow[]): number {
  if (rows.length === 0) return 0;
  return [...rows].sort((a, b) => b.date.localeCompare(a.date))[0]!.metricValue;
}
