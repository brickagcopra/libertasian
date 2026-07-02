'use client';

import { useState, useMemo } from 'react';
import {
  Search,
  BrainCircuit,
  ScanLine,
  GraduationCap,
  Users,
  Activity,
} from 'lucide-react';
import dynamic from 'next/dynamic';

import type { AnalyticsDashboardQuery } from '@libertasian/types';
import type { LineChartPoint } from '@/components/charts/line-chart';
import { useAuthStore } from '@/stores/auth-store';
import {
  useAnalyticsOverview,
  extractMetric,
} from '@/features/analytics/hooks/use-analytics-dashboard';
import { KpiCard, DateRangeFilter } from '@/components/analytics';
import { PlatformAdminGate } from '@/components/layout/platform-admin-gate';
import { AdminCardSkeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const LineChart = dynamic(
  () => import('@/components/charts/line-chart').then((mod) => mod.LineChart),
  { ssr: false },
);

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-PH').format(value);
}

export default function OrgAnalyticsPage() {
  const user = useAuthStore((s) => s.user);
  const organizationId = user?.organizationId;

  const [query, setQuery] = useState<AnalyticsDashboardQuery>({});

  // Scope queries to the user's organization
  const orgQuery = useMemo<AnalyticsDashboardQuery>(
    () => ({ ...query, organizationId: organizationId ?? undefined }),
    [query, organizationId],
  );

  const { data: overview, isLoading } = useAnalyticsOverview(orgQuery);

  const metrics = overview?.metrics ?? [];

  const dau = extractMetric(metrics, 'dau', 'latest');
  const searches = extractMetric(metrics, 'searches', 'sum');
  const aiAnswers = extractMetric(metrics, 'ai_answers', 'sum');
  const scansCompleted = extractMetric(metrics, 'scans_completed', 'sum');
  const studySessions = extractMetric(metrics, 'study_sessions', 'sum');
  const sessions = extractMetric(metrics, 'sessions', 'sum');

  const dauTrend: LineChartPoint[] = useMemo(() => {
    return metrics
      .filter((r) => r.metricName === 'dau')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ date: new Date(r.date), value: r.metricValue }));
  }, [metrics]);

  const searchTrend: LineChartPoint[] = useMemo(() => {
    return metrics
      .filter((r) => r.metricName === 'searches')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ date: new Date(r.date), value: r.metricValue }));
  }, [metrics]);

  return (
    <PlatformAdminGate>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Organization Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Usage metrics for your organization — search, AI, scans, and study activity
          </p>
        </div>

        <DateRangeFilter query={query} onChange={setQuery} showGranularity />

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <AdminCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <KpiCard
              label="Active Users"
              value={formatNumber(dau)}
              trend={dau > 0 ? 'up' : 'neutral'}
              comparison="Daily active in org"
              icon={Users}
            />
            <KpiCard
              label="Total Sessions"
              value={formatNumber(sessions)}
              trend={sessions > 0 ? 'up' : 'neutral'}
              comparison="In selected period"
              icon={Activity}
            />
            <KpiCard
              label="Searches"
              value={formatNumber(searches)}
              trend={searches > 0 ? 'up' : 'neutral'}
              comparison="Search queries"
              icon={Search}
            />
            <KpiCard
              label="AI Answers"
              value={formatNumber(aiAnswers)}
              trend={aiAnswers > 0 ? 'up' : 'neutral'}
              comparison="AI-generated answers"
              icon={BrainCircuit}
            />
            <KpiCard
              label="Scans Completed"
              value={formatNumber(scansCompleted)}
              trend={scansCompleted > 0 ? 'up' : 'neutral'}
              comparison="Camera scans"
              icon={ScanLine}
            />
            <KpiCard
              label="Study Sessions"
              value={formatNumber(studySessions)}
              trend={studySessions > 0 ? 'up' : 'neutral'}
              comparison="Study / flashcard sessions"
              icon={GraduationCap}
            />
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Active Users Trend</CardTitle>
              <CardDescription>Daily active users in your organization</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-[300px] animate-pulse rounded bg-muted" />
              ) : dauTrend.length > 0 ? (
                <LineChart data={dauTrend} width={550} height={300} />
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No activity data yet
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Search Volume</CardTitle>
              <CardDescription>Organization search queries over time</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-[300px] animate-pulse rounded bg-muted" />
              ) : searchTrend.length > 0 ? (
                <LineChart data={searchTrend} width={550} height={300} />
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No search data yet
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PlatformAdminGate>
  );
}
