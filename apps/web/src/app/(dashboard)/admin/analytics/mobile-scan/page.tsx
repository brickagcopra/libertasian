'use client';

import { useState, useMemo } from 'react';
import {
  ScanLine,
  CheckCircle2,
  Gauge,
  ArrowUpCircle,
  Smartphone,
  TrendingUp,
} from 'lucide-react';
import dynamic from 'next/dynamic';

import type { AnalyticsDashboardQuery } from '@libertasian/types';
import type { LineChartPoint } from '@/components/charts/line-chart';
import {
  useAnalyticsScanMetrics,
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

export default function MobileScanPage() {
  const [query, setQuery] = useState<AnalyticsDashboardQuery>({});
  const { data: scanData, isLoading: loadingScans } = useAnalyticsScanMetrics(query);
  const { data: funnel, isLoading: loadingFunnel } = useAnalyticsFunnel(
    'scan_to_digest',
    query,
  );

  const metrics = scanData?.metrics ?? [];

  const scansStarted = extractMetric(metrics, 'scans_started', 'sum');
  const scansCompleted = extractMetric(metrics, 'scans_completed', 'sum');
  const scanSuccessRate = extractMetric(metrics, 'scan_success_rate', 'latest');
  const avgQuality = extractMetric(metrics, 'scan_avg_quality', 'latest');
  const upgradePrompts = extractMetric(metrics, 'scan_upgrade_prompts', 'sum');
  const upgradeConversions = extractMetric(metrics, 'scan_upgrade_conversions', 'sum');

  const scansTrend: LineChartPoint[] = useMemo(() => {
    return metrics
      .filter((r) => r.metricName === 'scans_completed')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ date: new Date(r.date), value: r.metricValue }));
  }, [metrics]);

  const qualityTrend: LineChartPoint[] = useMemo(() => {
    return metrics
      .filter((r) => r.metricName === 'scan_avg_quality')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ date: new Date(r.date), value: r.metricValue }));
  }, [metrics]);

  const upgradeConversionRate =
    upgradePrompts > 0 ? upgradeConversions / upgradePrompts : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Mobile &amp; Scan Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Camera scan usage, OCR quality, and mobile upgrade conversions
        </p>
      </div>

      <DateRangeFilter query={query} onChange={setQuery} showGranularity showDimension />

      {loadingScans ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <AdminCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            label="Scans Started"
            value={formatNumber(scansStarted)}
            trend={scansStarted > 0 ? 'up' : 'neutral'}
            comparison="Total scan attempts"
            icon={ScanLine}
          />
          <KpiCard
            label="Scans Completed"
            value={formatNumber(scansCompleted)}
            trend={scansCompleted > 0 ? 'up' : 'neutral'}
            comparison="Successfully processed"
            icon={CheckCircle2}
          />
          <KpiCard
            label="Success Rate"
            value={formatPercent(scanSuccessRate)}
            trend={scanSuccessRate > 0.8 ? 'up' : 'down'}
            comparison="Completed / Started"
            icon={Gauge}
          />
          <KpiCard
            label="Avg OCR Quality"
            value={avgQuality > 0 ? avgQuality.toFixed(2) : '—'}
            trend={avgQuality >= 0.7 ? 'up' : avgQuality > 0 ? 'down' : 'neutral'}
            comparison="Quality score (0-1)"
            icon={Smartphone}
          />
          <KpiCard
            label="Upgrade Prompts"
            value={formatNumber(upgradePrompts)}
            trend="neutral"
            comparison="Free users prompted"
            icon={ArrowUpCircle}
          />
          <KpiCard
            label="Upgrade Conversion"
            value={formatPercent(upgradeConversionRate)}
            trend={upgradeConversionRate > 0.05 ? 'up' : 'neutral'}
            comparison="Prompt → Upgrade rate"
            icon={TrendingUp}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Scan Volume</CardTitle>
            <CardDescription>Completed scans over time</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingScans ? (
              <div className="h-[300px] animate-pulse rounded bg-muted" />
            ) : scansTrend.length > 0 ? (
              <LineChart data={scansTrend} width={550} height={300} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No scan data</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">OCR Quality Trend</CardTitle>
            <CardDescription>Average quality score over time</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingScans ? (
              <div className="h-[300px] animate-pulse rounded bg-muted" />
            ) : qualityTrend.length > 0 ? (
              <LineChart data={qualityTrend} width={550} height={300} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No quality data
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Scan to Digest Funnel</CardTitle>
          <CardDescription>
            Track user progression from camera scan to digest generation
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
  );
}
