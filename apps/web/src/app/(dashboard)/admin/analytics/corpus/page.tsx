'use client';

import { useState, useMemo } from 'react';
import {
  Database,
  AlertTriangle,
  ClipboardCheck,
  Clock,
  FileText,
  TrendingDown,
} from 'lucide-react';
import dynamic from 'next/dynamic';

import type { AnalyticsDashboardQuery } from '@libertasian/types';
import type { LineChartPoint } from '@/components/charts/line-chart';
import {
  useAnalyticsIngestionMetrics,
  extractMetric,
} from '@/features/analytics/hooks/use-analytics-dashboard';
import { KpiCard, DateRangeFilter } from '@/components/analytics';
import { AdminCardSkeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const LineChart = dynamic(
  () => import('@/components/charts/line-chart').then((mod) => mod.LineChart),
  { ssr: false },
);

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-PH').format(value);
}

function formatMs(value: number): string {
  if (value < 1000) return `${value.toFixed(0)}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  return `${(value / 60_000).toFixed(1)}m`;
}

export default function CorpusIngestionPage() {
  const [query, setQuery] = useState<AnalyticsDashboardQuery>({});
  const { data, isLoading } = useAnalyticsIngestionMetrics(query);

  const metrics = data?.metrics ?? [];

  const documentsIngested = extractMetric(metrics, 'documents_ingested', 'sum');
  const ingestionErrors = extractMetric(metrics, 'ingestion_errors', 'sum');
  const editorialReviews = extractMetric(metrics, 'editorial_reviews', 'sum');
  const avgReviewTime = extractMetric(metrics, 'avg_review_time_ms', 'latest');

  const errorRate =
    documentsIngested > 0 ? ingestionErrors / (documentsIngested + ingestionErrors) : 0;

  const ingestionTrend: LineChartPoint[] = useMemo(() => {
    return metrics
      .filter((r) => r.metricName === 'documents_ingested')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ date: new Date(r.date), value: r.metricValue }));
  }, [metrics]);

  const errorTrend: LineChartPoint[] = useMemo(() => {
    return metrics
      .filter((r) => r.metricName === 'ingestion_errors')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ date: new Date(r.date), value: r.metricValue }));
  }, [metrics]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Corpus &amp; Ingestion Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Document ingestion pipeline health, editorial review throughput, and error tracking
        </p>
      </div>

      <DateRangeFilter query={query} onChange={setQuery} showGranularity />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <AdminCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <KpiCard
            label="Documents Ingested"
            value={formatNumber(documentsIngested)}
            trend={documentsIngested > 0 ? 'up' : 'neutral'}
            comparison="In selected period"
            icon={FileText}
          />
          <KpiCard
            label="Ingestion Errors"
            value={formatNumber(ingestionErrors)}
            trend={ingestionErrors > 0 ? 'down' : 'up'}
            comparison="Failed ingestions"
            icon={AlertTriangle}
          />
          <KpiCard
            label="Error Rate"
            value={`${(errorRate * 100).toFixed(1)}%`}
            trend={errorRate < 0.05 ? 'up' : 'down'}
            comparison="Lower is better"
            icon={TrendingDown}
          />
          <KpiCard
            label="Editorial Reviews"
            value={formatNumber(editorialReviews)}
            trend={editorialReviews > 0 ? 'up' : 'neutral'}
            comparison="Reviews completed"
            icon={ClipboardCheck}
          />
          <KpiCard
            label="Avg Review Time"
            value={avgReviewTime > 0 ? formatMs(avgReviewTime) : '—'}
            trend={avgReviewTime > 0 && avgReviewTime < 300_000 ? 'up' : 'neutral'}
            comparison="Time per review"
            icon={Clock}
          />
        </div>
      )}

      {ingestionErrors > 0 && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-yellow-600 dark:text-yellow-400" />
            <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
              {formatNumber(ingestionErrors)} ingestion error{ingestionErrors !== 1 ? 's' : ''} in
              this period — check the ingestion pipeline logs
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Ingestion Volume</CardTitle>
            <CardDescription>Documents ingested over time</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-[300px] animate-pulse rounded bg-muted" />
            ) : ingestionTrend.length > 0 ? (
              <LineChart data={ingestionTrend} width={550} height={300} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No ingestion data
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Error Trend</CardTitle>
            <CardDescription>Ingestion errors over time</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-[300px] animate-pulse rounded bg-muted" />
            ) : errorTrend.length > 0 ? (
              <LineChart data={errorTrend} width={550} height={300} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No error data</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
