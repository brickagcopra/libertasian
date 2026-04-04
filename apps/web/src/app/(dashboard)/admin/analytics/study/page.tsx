'use client';

import { useState, useMemo } from 'react';
import {
  GraduationCap,
  BookOpen,
  CheckCircle2,
  WifiOff,
  Clock,
  Target,
} from 'lucide-react';
import dynamic from 'next/dynamic';

import type { AnalyticsDashboardQuery } from '@libertasian/types';
import type { LineChartPoint } from '@/components/charts/line-chart';
import {
  useAnalyticsStudyMetrics,
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

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default function StudyAnalyticsPage() {
  const [query, setQuery] = useState<AnalyticsDashboardQuery>({});
  const { data, isLoading } = useAnalyticsStudyMetrics(query);

  const metrics = data?.metrics ?? [];

  const studySessions = extractMetric(metrics, 'study_sessions', 'sum');
  const flashcardSessions = extractMetric(metrics, 'flashcard_sessions', 'sum');
  const flashcardAccuracy = extractMetric(metrics, 'flashcard_accuracy', 'latest');
  const codalViews = extractMetric(metrics, 'codal_views', 'sum');
  const offlineUsage = extractMetric(metrics, 'offline_usage', 'sum');

  const studyTrend: LineChartPoint[] = useMemo(() => {
    return metrics
      .filter((r) => r.metricName === 'study_sessions')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ date: new Date(r.date), value: r.metricValue }));
  }, [metrics]);

  const flashcardTrend: LineChartPoint[] = useMemo(() => {
    return metrics
      .filter((r) => r.metricName === 'flashcard_sessions')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ date: new Date(r.date), value: r.metricValue }));
  }, [metrics]);

  const accuracyTrend: LineChartPoint[] = useMemo(() => {
    return metrics
      .filter((r) => r.metricName === 'flashcard_accuracy')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ date: new Date(r.date), value: r.metricValue }));
  }, [metrics]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Study Mode Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Study sessions, flashcard performance, codal engagement, and offline usage
        </p>
      </div>

      <DateRangeFilter query={query} onChange={setQuery} showGranularity showDimension />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <AdminCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            label="Study Sessions"
            value={formatNumber(studySessions)}
            trend={studySessions > 0 ? 'up' : 'neutral'}
            comparison="Total study sessions"
            icon={GraduationCap}
          />
          <KpiCard
            label="Flashcard Sessions"
            value={formatNumber(flashcardSessions)}
            trend={flashcardSessions > 0 ? 'up' : 'neutral'}
            comparison="Total flashcard sessions"
            icon={Target}
          />
          <KpiCard
            label="Flashcard Accuracy"
            value={formatPercent(flashcardAccuracy)}
            trend={flashcardAccuracy > 0.6 ? 'up' : flashcardAccuracy > 0 ? 'down' : 'neutral'}
            comparison="Correct answer rate"
            icon={CheckCircle2}
          />
          <KpiCard
            label="Codal Views"
            value={formatNumber(codalViews)}
            trend={codalViews > 0 ? 'up' : 'neutral'}
            comparison="Codal sections viewed"
            icon={BookOpen}
          />
          <KpiCard
            label="Offline Usage"
            value={formatNumber(offlineUsage)}
            trend={offlineUsage > 0 ? 'up' : 'neutral'}
            comparison="Offline study events"
            icon={WifiOff}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Study Sessions Trend</CardTitle>
            <CardDescription>Study sessions over time</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-[300px] animate-pulse rounded bg-muted" />
            ) : studyTrend.length > 0 ? (
              <LineChart data={studyTrend} width={550} height={300} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No study session data
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Flashcard Sessions Trend</CardTitle>
            <CardDescription>Flashcard sessions over time</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-[300px] animate-pulse rounded bg-muted" />
            ) : flashcardTrend.length > 0 ? (
              <LineChart data={flashcardTrend} width={550} height={300} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No flashcard data
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Flashcard Accuracy Trend</CardTitle>
          <CardDescription>
            Average correct answer rate over time — tracks learning effectiveness
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-[300px] animate-pulse rounded bg-muted" />
          ) : accuracyTrend.length > 0 ? (
            <LineChart data={accuracyTrend} width={700} height={300} />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No accuracy data
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
