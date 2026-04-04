'use client';

import { useState, useMemo } from 'react';
import {
  Search,
  BrainCircuit,
  Clock,
  MousePointerClick,
  AlertCircle,
  ThumbsUp,
} from 'lucide-react';
import dynamic from 'next/dynamic';

import type { AnalyticsDashboardQuery } from '@libertasian/types';
import type { LineChartPoint } from '@/components/charts/line-chart';
import {
  useAnalyticsSearchMetrics,
  useAnalyticsAiMetrics,
  extractMetric,
} from '@/features/analytics/hooks/use-analytics-dashboard';
import { KpiCard, DateRangeFilter } from '@/components/analytics';
import { AdminCardSkeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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

function formatMs(value: number): string {
  if (value < 1000) return `${value.toFixed(0)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

// ─── Search Tab ──────────────────────────────────────────────

function SearchTab() {
  const [query, setQuery] = useState<AnalyticsDashboardQuery>({});
  const { data, isLoading } = useAnalyticsSearchMetrics(query);

  const metrics = data?.metrics ?? [];
  const totalSearches = extractMetric(metrics, 'searches', 'sum');
  const zeroResultRate = extractMetric(metrics, 'zero_result_rate', 'latest');
  const clickThroughRate = extractMetric(metrics, 'search_ctr', 'latest');
  const meanPosition = extractMetric(metrics, 'mean_click_position', 'latest');

  const searchTrend: LineChartPoint[] = useMemo(() => {
    return metrics
      .filter((r) => r.metricName === 'searches')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ date: new Date(r.date), value: r.metricValue }));
  }, [metrics]);

  if (isLoading) return <AdminCardSkeleton />;

  return (
    <div className="space-y-6">
      <DateRangeFilter query={query} onChange={setQuery} showGranularity />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Searches"
          value={formatNumber(totalSearches)}
          trend={totalSearches > 0 ? 'up' : 'neutral'}
          comparison="In selected period"
          icon={Search}
        />
        <KpiCard
          label="Zero-Result Rate"
          value={formatPercent(zeroResultRate)}
          trend={zeroResultRate < 0.1 ? 'up' : 'down'}
          comparison="Lower is better"
          icon={AlertCircle}
        />
        <KpiCard
          label="Click-Through Rate"
          value={formatPercent(clickThroughRate)}
          trend={clickThroughRate > 0.3 ? 'up' : 'down'}
          comparison="Searches with at least 1 click"
          icon={MousePointerClick}
        />
        <KpiCard
          label="Mean Position Clicked"
          value={meanPosition > 0 ? meanPosition.toFixed(1) : '—'}
          trend={meanPosition > 0 && meanPosition <= 3 ? 'up' : 'neutral'}
          comparison="Avg position of clicked result"
          icon={Search}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Search Volume</CardTitle>
          <CardDescription>Total searches over time</CardDescription>
        </CardHeader>
        <CardContent>
          {searchTrend.length > 0 ? (
            <LineChart data={searchTrend} width={700} height={300} />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">No search data</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── AI Tab ──────────────────────────────────────────────────

function AiTab() {
  const [query, setQuery] = useState<AnalyticsDashboardQuery>({});
  const { data, isLoading } = useAnalyticsAiMetrics(query);

  const metrics = data?.metrics ?? [];
  const totalAnswers = extractMetric(metrics, 'ai_answers', 'sum');
  const avgResponseTime = extractMetric(metrics, 'avg_response_time_ms', 'latest');
  const abstentionRate = extractMetric(metrics, 'abstention_rate', 'latest');
  const helpfulRate = extractMetric(metrics, 'helpful_rate', 'latest');
  const hallucinationReports = extractMetric(metrics, 'hallucination_reports', 'sum');

  const answerTrend: LineChartPoint[] = useMemo(() => {
    return metrics
      .filter((r) => r.metricName === 'ai_answers')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ date: new Date(r.date), value: r.metricValue }));
  }, [metrics]);

  if (isLoading) return <AdminCardSkeleton />;

  return (
    <div className="space-y-6">
      <DateRangeFilter query={query} onChange={setQuery} showGranularity />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total AI Answers"
          value={formatNumber(totalAnswers)}
          trend={totalAnswers > 0 ? 'up' : 'neutral'}
          comparison="In selected period"
          icon={BrainCircuit}
        />
        <KpiCard
          label="Avg Response Time"
          value={formatMs(avgResponseTime)}
          trend={avgResponseTime > 0 && avgResponseTime < 3000 ? 'up' : 'down'}
          comparison="Time to generate answer"
          icon={Clock}
        />
        <KpiCard
          label="Abstention Rate"
          value={formatPercent(abstentionRate)}
          trend={abstentionRate < 0.2 ? 'up' : 'down'}
          comparison="Queries with no confident answer"
          icon={AlertCircle}
        />
        <KpiCard
          label="Helpful Rate"
          value={formatPercent(helpfulRate)}
          trend={helpfulRate > 0.7 ? 'up' : 'down'}
          comparison="Positive user feedback"
          icon={ThumbsUp}
        />
      </div>

      {hallucinationReports > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 text-red-600 dark:text-red-400" />
            <p className="text-sm font-medium text-red-600 dark:text-red-400">
              {formatNumber(hallucinationReports)} hallucination report{hallucinationReports !== 1 ? 's' : ''} in this period
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">AI Answer Volume</CardTitle>
          <CardDescription>Total AI answers generated over time</CardDescription>
        </CardHeader>
        <CardContent>
          {answerTrend.length > 0 ? (
            <LineChart data={answerTrend} width={700} height={300} />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">No AI data</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────

export default function SearchAiPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Search &amp; AI Quality</h1>
        <p className="text-sm text-muted-foreground">
          Search performance, AI answer quality, and user satisfaction metrics
        </p>
      </div>

      <Tabs defaultValue="search" className="space-y-4">
        <TabsList>
          <TabsTrigger value="search" className="text-xs">
            <Search className="mr-1 size-3.5" />
            Search
          </TabsTrigger>
          <TabsTrigger value="ai" className="text-xs">
            <BrainCircuit className="mr-1 size-3.5" />
            AI Quality
          </TabsTrigger>
        </TabsList>

        <TabsContent value="search">
          <SearchTab />
        </TabsContent>
        <TabsContent value="ai">
          <AiTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
