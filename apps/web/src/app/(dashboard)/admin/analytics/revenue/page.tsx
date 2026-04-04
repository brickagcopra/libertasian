'use client';

import { useState, useMemo } from 'react';
import {
  CreditCard,
  TrendingUp,
  TrendingDown,
  UserMinus,
  ArrowUpDown,
} from 'lucide-react';
import dynamic from 'next/dynamic';

import type { AnalyticsDashboardQuery } from '@libertasian/types';
import type { LineChartPoint } from '@/components/charts/line-chart';
import {
  useAnalyticsRevenueMetrics,
  useAnalyticsFunnel,
  extractMetric,
} from '@/features/analytics/hooks/use-analytics-dashboard';
import { KpiCard, DateRangeFilter, FunnelChart } from '@/components/analytics';
import { AdminCardSkeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const LineChart = dynamic(
  () => import('@/components/charts/line-chart').then((mod) => mod.LineChart),
  { ssr: false },
);

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-PH').format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default function RevenuePage() {
  const [query, setQuery] = useState<AnalyticsDashboardQuery>({});
  const { data: revenueData, isLoading: loadingRevenue } = useAnalyticsRevenueMetrics(query);
  const { data: funnel, isLoading: loadingFunnel } = useAnalyticsFunnel('free_to_paid', query);

  const metrics = revenueData?.metrics ?? [];
  const newSubscriptions = extractMetric(metrics, 'new_subscriptions', 'sum');
  const upgrades = extractMetric(metrics, 'upgrades', 'sum');
  const cancellations = extractMetric(metrics, 'cancellations', 'sum');
  const churns = extractMetric(metrics, 'churns', 'sum');
  const paywallConversion = extractMetric(metrics, 'paywall_conversion_rate', 'latest');

  const subTrend: LineChartPoint[] = useMemo(() => {
    return metrics
      .filter((r) => r.metricName === 'new_subscriptions')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ date: new Date(r.date), value: r.metricValue }));
  }, [metrics]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Conversion &amp; Revenue</h1>
        <p className="text-sm text-muted-foreground">
          Subscription growth, conversion funnels, and churn analysis
        </p>
      </div>

      <DateRangeFilter query={query} onChange={setQuery} showGranularity />

      {loadingRevenue ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <AdminCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <KpiCard
            label="New Subscriptions"
            value={formatNumber(newSubscriptions)}
            trend={newSubscriptions > 0 ? 'up' : 'neutral'}
            comparison="In selected period"
            icon={CreditCard}
          />
          <KpiCard
            label="Upgrades"
            value={formatNumber(upgrades)}
            trend={upgrades > 0 ? 'up' : 'neutral'}
            comparison="Plan upgrades"
            icon={TrendingUp}
          />
          <KpiCard
            label="Cancellations"
            value={formatNumber(cancellations)}
            trend={cancellations > 0 ? 'down' : 'neutral'}
            comparison="Active cancellations"
            icon={TrendingDown}
          />
          <KpiCard
            label="Churns"
            value={formatNumber(churns)}
            trend={churns > 0 ? 'down' : 'neutral'}
            comparison="Expired subscriptions"
            icon={UserMinus}
          />
          <KpiCard
            label="Paywall Conversion"
            value={formatPercent(paywallConversion)}
            trend={paywallConversion > 0.05 ? 'up' : 'neutral'}
            comparison="Free → Paid rate"
            icon={ArrowUpDown}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Subscription Trend</CardTitle>
            <CardDescription>New subscriptions over time</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingRevenue ? (
              <div className="h-[300px] animate-pulse rounded bg-muted" />
            ) : subTrend.length > 0 ? (
              <LineChart data={subTrend} width={550} height={300} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No subscription data
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Free to Paid Funnel</CardTitle>
            <CardDescription>
              Conversion funnel from free users to paid subscribers
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingFunnel ? (
              <div className="h-64 animate-pulse rounded bg-muted" />
            ) : funnel?.steps && funnel.steps.length > 0 ? (
              <FunnelChart steps={funnel.steps} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No funnel data</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
