'use client';

import { useState, useMemo, useTransition } from 'react';
import {
  Users,
  Search,
  BrainCircuit,
  CreditCard,
  Activity,
  CalendarDays,
  AlertTriangle,
} from 'lucide-react';
import dynamic from 'next/dynamic';

import type { AnalyticsDashboardQuery } from '@libertasian/types';
import type { LineChartPoint } from '@/components/charts/line-chart';
import {
  useAnalyticsOverview,
  useAnalyticsFunnel,
  useAnalyticsSurfaces,
  useAnalyticsRefresh,
  extractMetric,
  selectMetricRows,
} from '@/features/analytics/hooks/use-analytics-dashboard';
import {
  KpiCard,
  DateRangeFilter,
  FunnelChart,
  SurfaceUsagePanel,
  AggregationFreshness,
} from '@/components/analytics';
import { AdminCardSkeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

const LineChart = dynamic(
  () => import('@/components/charts/line-chart').then((mod) => mod.LineChart),
  { ssr: false },
);

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-PH').format(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export default function AnalyticsOverviewPage() {
  const [query, setQuery] = useState<AnalyticsDashboardQuery>({});
  const [isRefreshing, startRefresh] = useTransition();
  const {
    data: overview,
    isLoading: loadingOverview,
    isError: overviewFailed,
    error: overviewError,
    refetch: refetchOverview,
  } = useAnalyticsOverview(query);
  const {
    data: funnel,
    isLoading: loadingFunnel,
    isError: funnelFailed,
    error: funnelError,
  } = useAnalyticsFunnel('signup_to_activation', query);
  const {
    data: surfaces,
    isLoading: loadingSurfaces,
    isError: surfacesFailed,
    error: surfacesError,
  } = useAnalyticsSurfaces(query);

  // Sends ?refresh=true, so the API skips its 5-minute cache read and
  // repopulates — a plain refetch would be answered from Redis and a freshly
  // backfilled day would stay invisible.
  const refreshAnalytics = useAnalyticsRefresh(query);

  const metrics = overview?.metrics ?? [];

  const dau = extractMetric(metrics, 'dau', 'latest');
  const wau = extractMetric(metrics, 'wau', 'latest');
  const mau = extractMetric(metrics, 'mau', 'latest');
  const searches = extractMetric(metrics, 'searches', 'sum');
  const aiAnswers = extractMetric(metrics, 'ai_answers', 'sum');
  const newSubscriptions = extractMetric(metrics, 'new_subscriptions', 'sum');

  const dauTrend: LineChartPoint[] = useMemo(() => {
    return selectMetricRows(metrics, 'dau')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ date: new Date(r.date), value: r.metricValue }));
  }, [metrics]);

  const searchTrend: LineChartPoint[] = useMemo(() => {
    return selectMetricRows(metrics, 'searches')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ date: new Date(r.date), value: r.metricValue }));
  }, [metrics]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Platform Analytics</h1>
        <p className="text-sm text-muted-foreground">
          User engagement, feature adoption, and growth metrics
        </p>
      </div>

      <DateRangeFilter query={query} onChange={setQuery} showGranularity />

      <AggregationFreshness
        lastAggregatedAt={overview?.lastAggregatedAt ?? null}
        onRefresh={() => startRefresh(() => void refreshAnalytics())}
        isRefreshing={isRefreshing}
      />

      {overviewFailed && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Could not load analytics</AlertTitle>
          <AlertDescription>
            <p>{errorMessage(overviewError)}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void refetchOverview()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {loadingOverview ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <AdminCardSkeleton key={i} />
          ))}
        </div>
      ) : overviewFailed ? null : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            label="DAU"
            value={formatNumber(dau)}
            trend={dau > 0 ? 'up' : 'neutral'}
            comparison="Daily Active Users"
            icon={Users}
          />
          <KpiCard
            label="WAU"
            value={formatNumber(wau)}
            trend={wau > 0 ? 'up' : 'neutral'}
            comparison="Weekly Active Users"
            icon={Activity}
          />
          <KpiCard
            label="MAU"
            value={formatNumber(mau)}
            trend={mau > 0 ? 'up' : 'neutral'}
            comparison="Monthly Active Users"
            icon={CalendarDays}
          />
          <KpiCard
            label="Total Searches"
            value={formatNumber(searches)}
            trend={searches > 0 ? 'up' : 'neutral'}
            comparison="In selected period"
            icon={Search}
          />
          <KpiCard
            label="AI Answers"
            value={formatNumber(aiAnswers)}
            trend={aiAnswers > 0 ? 'up' : 'neutral'}
            comparison="In selected period"
            icon={BrainCircuit}
          />
          <KpiCard
            label="New Subscriptions"
            value={formatNumber(newSubscriptions)}
            trend={newSubscriptions > 0 ? 'up' : 'neutral'}
            comparison="In selected period"
            icon={CreditCard}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">DAU Trend</CardTitle>
            <CardDescription>Daily Active Users over time</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingOverview ? (
              <div className="h-[300px] animate-pulse rounded bg-muted" />
            ) : overviewFailed ? (
              <p className="py-8 text-center text-sm text-destructive">
                Failed to load — see the error above.
              </p>
            ) : dauTrend.length > 0 ? (
              <LineChart data={dauTrend} width={550} height={300} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No trend data</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Search Volume</CardTitle>
            <CardDescription>Total searches over time</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingOverview ? (
              <div className="h-[300px] animate-pulse rounded bg-muted" />
            ) : overviewFailed ? (
              <p className="py-8 text-center text-sm text-destructive">
                Failed to load — see the error above.
              </p>
            ) : searchTrend.length > 0 ? (
              <LineChart data={searchTrend} width={550} height={300} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No trend data</p>
            )}
          </CardContent>
        </Card>
      </div>

      <SurfaceUsagePanel
        metrics={surfaces?.metrics ?? []}
        isLoading={loadingSurfaces}
        isError={surfacesFailed}
        error={surfacesError}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Signup to Activation Funnel</CardTitle>
          <CardDescription>
            Track user progression from registration to first meaningful action
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingFunnel ? (
            <div className="h-64 animate-pulse rounded bg-muted" />
          ) : funnelFailed ? (
            <p className="py-8 text-center text-sm text-destructive">
              Could not load funnel data: {errorMessage(funnelError)}
            </p>
          ) : funnel?.steps && funnel.steps.length > 0 ? (
            <FunnelChart steps={funnel.steps} />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">No funnel data</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
