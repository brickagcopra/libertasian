'use client';

import { useState, useMemo } from 'react';
import { Users, CalendarDays, TrendingUp } from 'lucide-react';

import type { AnalyticsDashboardQuery } from '@libertasian/types';
import { useAnalyticsRetention } from '@/features/analytics/hooks/use-analytics-dashboard';
import { KpiCard, DateRangeFilter, RetentionHeatmap } from '@/components/analytics';
import { AdminCardSkeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default function RetentionPage() {
  const [query, setQuery] = useState<AnalyticsDashboardQuery>({});
  const [planSegment, setPlanSegment] = useState<string>('all');
  const { data, isLoading } = useAnalyticsRetention(query);

  const filteredCohorts = useMemo(() => {
    if (!data?.cohorts) return [];
    if (planSegment === 'all') return data.cohorts;
    return data.cohorts.filter((c) => c.planSegment === planSegment);
  }, [data, planSegment]);

  // Summary stats
  const stats = useMemo(() => {
    if (filteredCohorts.length === 0) return { week1: 0, week4: 0, bestCohort: '—' };

    const week1Rows = filteredCohorts.filter((c) => c.retentionWeek === 1);
    const week4Rows = filteredCohorts.filter((c) => c.retentionWeek === 4);

    const avgWeek1 =
      week1Rows.length > 0
        ? week1Rows.reduce((sum, r) => sum + r.retentionRate, 0) / week1Rows.length
        : 0;
    const avgWeek4 =
      week4Rows.length > 0
        ? week4Rows.reduce((sum, r) => sum + r.retentionRate, 0) / week4Rows.length
        : 0;

    // Best cohort: highest Week-1 retention
    let bestCohort = '—';
    if (week1Rows.length > 0) {
      const best = week1Rows.reduce((prev, curr) =>
        curr.retentionRate > prev.retentionRate ? curr : prev,
      );
      bestCohort = best.cohortWeek;
    }

    return { week1: avgWeek1, week4: avgWeek4, bestCohort };
  }, [filteredCohorts]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">User Retention</h1>
        <p className="text-sm text-muted-foreground">
          Cohort-based retention analysis with weekly breakdown
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <DateRangeFilter query={query} onChange={setQuery} showGranularity={false} />
        <div className="space-y-1">
          <Label className="text-xs">Plan Segment</Label>
          <Select value={planSegment} onValueChange={setPlanSegment}>
            <SelectTrigger className="h-8 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="edu">Edu</SelectItem>
              <SelectItem value="pro">Pro</SelectItem>
              <SelectItem value="team">Team</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <AdminCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <KpiCard
            label="Avg Week-1 Retention"
            value={formatPercent(stats.week1)}
            trend={stats.week1 > 0.4 ? 'up' : 'down'}
            comparison="Returning after first week"
            icon={Users}
          />
          <KpiCard
            label="Avg Week-4 Retention"
            value={formatPercent(stats.week4)}
            trend={stats.week4 > 0.2 ? 'up' : 'down'}
            comparison="Returning after four weeks"
            icon={CalendarDays}
          />
          <KpiCard
            label="Best Cohort"
            value={stats.bestCohort}
            trend="up"
            comparison="Highest Week-1 retention"
            icon={TrendingUp}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Retention Heatmap</CardTitle>
          <CardDescription>
            Rows = cohort signup week, Columns = weeks since signup (W0-W12).
            Values show % of users returning.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-[400px] animate-pulse rounded bg-muted" />
          ) : (
            <RetentionHeatmap cohorts={filteredCohorts} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
