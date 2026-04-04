'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Download } from 'lucide-react';

import {
  useSourceHealthReports,
  useRecomputeAllSourceHealth,
  useCoverageGaps,
  useStalenessReport,
  useEnhancedCoverageGaps,
  useBarSubjectCoverage,
  useIngestionTrends,
  useSourceGapDrilldown,
  useExportCoverageGaps,
} from '@/features/admin/hooks/use-admin';
import type {
  SourceHealthReport,
  CoverageGapItem,
  StalenessReportItem,
  EnhancedCoverageGapItem,
} from '@/features/admin/types';
import { AdminCardSkeleton, AdminListSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import dynamic from 'next/dynamic';

const BarChart = dynamic(
  () => import('@/components/charts/bar-chart').then((mod) => mod.BarChart),
  { ssr: false },
);
const Heatmap = dynamic(
  () => import('@/components/charts/heatmap').then((mod) => mod.Heatmap),
  { ssr: false },
);
const LineChart = dynamic(
  () => import('@/components/charts/line-chart').then((mod) => mod.LineChart),
  { ssr: false },
);
const RadialProgress = dynamic(
  () => import('@/components/charts/radial-progress').then((mod) => mod.RadialProgress),
  { ssr: false },
);

export default function SourceHealthPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Source Health</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Monitor source reliability, corpus coverage, and data freshness
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Dashboard
          </Link>
        </Button>
      </div>

      <Tabs defaultValue="health">
        <TabsList>
          <TabsTrigger value="health">Health Scores</TabsTrigger>
          <TabsTrigger value="coverage">Coverage Gaps</TabsTrigger>
          <TabsTrigger value="staleness">Staleness</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
        </TabsList>

        <TabsContent value="health">
          <HealthScoresTab />
        </TabsContent>
        <TabsContent value="coverage">
          <EnhancedCoverageGapsTab />
        </TabsContent>
        <TabsContent value="staleness">
          <StalenessTab />
        </TabsContent>
        <TabsContent value="trends">
          <TrendsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---- Health Scores Tab ----

function HealthScoresTab() {
  const { data: reports, isLoading, error } = useSourceHealthReports();
  const recompute = useRecomputeAllSourceHealth();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Source Health Reports</h2>
        <Button
          size="sm"
          onClick={() => recompute.mutate()}
          disabled={recompute.isPending}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          {recompute.isPending ? 'Recomputing...' : 'Recompute All'}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : 'Failed to load health reports'}
          </AlertDescription>
        </Alert>
      )}

      {recompute.isSuccess && (
        <Alert>
          <AlertDescription className="text-green-700">
            Health scores recomputed for {recompute.data.length} sources.
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <AdminCardSkeleton key={i} />
          ))}
        </div>
      ) : reports && reports.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {reports.map((report) => (
            <HealthCard key={report.sourceId} report={report} />
          ))}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">No source health data available.</p>
      )}
    </div>
  );
}

function HealthCard({ report }: { report: SourceHealthReport }) {
  const score = report.healthScore;
  const scoreColor =
    score >= 80 ? 'text-green-600' : score >= 50 ? 'text-yellow-600' : 'text-red-600';
  const scoreBg =
    score >= 80 ? 'bg-green-100' : score >= 50 ? 'bg-yellow-100' : 'bg-red-100';

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium">{report.sourceName}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {report.documentCount} docs &middot; {report.endpointCount} endpoints
              {!report.enabled && (
                <Badge className="ml-1 bg-muted text-muted-foreground">disabled</Badge>
              )}
            </p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-sm font-bold ${scoreColor} ${scoreBg}`}>
            {score.toFixed(0)}
          </span>
        </div>

        <div className="mt-3 space-y-1.5">
          <ComponentBar label="Endpoint Availability" value={report.components.endpointAvailability} />
          <ComponentBar label="Fetch Success Rate" value={report.components.fetchSuccessRate} />
          <ComponentBar label="Document Quality" value={report.components.documentQuality} />
          <ComponentBar label="Freshness" value={report.components.freshness} />
        </div>

        {report.lastHealthCheckAt && (
          <p className="mt-2 text-xs text-muted-foreground">
            Last check: {new Date(report.lastHealthCheckAt).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ComponentBar({ label, value }: { label: string; value: number }) {
  const pct = Math.min(Math.max(value, 0), 100);
  const barColor = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{pct.toFixed(0)}%</span>
      </div>
      <div className="mt-0.5 h-1.5 w-full rounded-full bg-muted">
        <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ---- Enhanced Coverage Gaps Tab ----

function EnhancedCoverageGapsTab() {
  const [dimension, setDimension] = useState<string>('');
  const [status, setStatus] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('gapScore');
  const [sortDir, setSortDir] = useState<string>('desc');
  const [minDocCount, setMinDocCount] = useState<string>('');
  const [drilldownSourceId, setDrilldownSourceId] = useState<string | null>(null);

  const params = {
    ...(dimension && { dimension }),
    status,
    sortBy,
    sortDir,
    ...(minDocCount && { minDocCount: Number(minDocCount) }),
  };

  const { data: enhancedGaps, isLoading, error } = useEnhancedCoverageGaps(params);
  const { data: barSubjects } = useBarSubjectCoverage();
  const exportGaps = useExportCoverageGaps();
  const { data: drilldown } = useSourceGapDrilldown(drilldownSourceId);

  // Flatten all dimensions for the bar chart
  const allItems = useMemo(() => {
    if (!enhancedGaps) return [];
    const items: EnhancedCoverageGapItem[] = [];
    for (const arr of Object.values(enhancedGaps)) {
      items.push(...arr);
    }
    return items;
  }, [enhancedGaps]);

  // Heatmap data (court x documentType)
  const heatmapData = useMemo(() => {
    if (!enhancedGaps) return [];
    const courts = enhancedGaps['byCourt'] ?? [];
    const types = enhancedGaps['byDocumentType'] ?? [];
    // Create a cross-product heatmap skeleton
    return courts.flatMap((c) =>
      types.map((t) => ({
        row: c.value,
        col: t.value,
        value: Math.min(c.documentCount, t.documentCount),
      })),
    );
  }, [enhancedGaps]);

  // Bar chart: top gaps by gap score
  const barChartData = useMemo(() => {
    return allItems
      .sort((a, b) => b.gapScore - a.gapScore)
      .slice(0, 15)
      .map((item) => ({
        label: `${formatValue(item.value)}`,
        value: item.documentCount,
        color: item.gapScore > 0.7 ? '#ef4444' : item.gapScore > 0.4 ? '#f59e0b' : '#22c55e',
      }));
  }, [allItems]);

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Dimension</Label>
          <Select value={dimension} onValueChange={setDimension}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="documentType">Document Type</SelectItem>
              <SelectItem value="court">Court</SelectItem>
              <SelectItem value="tag">Tag</SelectItem>
              <SelectItem value="barSubject">Bar Subject</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Sort by</Label>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gapScore">Gap Score</SelectItem>
              <SelectItem value="documentCount">Doc Count</SelectItem>
              <SelectItem value="latestDate">Latest Date</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Direction</Label>
          <Select value={sortDir} onValueChange={setSortDir}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">Desc</SelectItem>
              <SelectItem value="asc">Asc</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Min docs</Label>
          <Input
            className="w-[80px]"
            type="number"
            min={0}
            value={minDocCount}
            onChange={(e) => setMinDocCount(e.target.value)}
            placeholder="0"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportGaps.mutate({ format: 'csv', dimension, status })}
          disabled={exportGaps.isPending}
        >
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : 'Failed to load coverage gaps'}
          </AlertDescription>
        </Alert>
      )}

      {/* Bar Subject Coverage */}
      {barSubjects && barSubjects.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold">Bar Subject Coverage</h3>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            {barSubjects.map((bs) => (
              <RadialProgress
                key={bs.code}
                value={bs.coverageScore}
                label={formatValue(bs.subject)}
                sublabel={`${bs.documentCount} docs`}
                size={90}
              />
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <AdminListSkeleton count={3} />
      ) : (
        <>
          {/* Bar chart - Gap sizes */}
          {barChartData.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Top Coverage Gaps (by gap score)</h3>
              <Card>
                <CardContent className="p-4 overflow-x-auto">
                  <BarChart data={barChartData} width={600} height={Math.max(200, barChartData.length * 28)} />
                </CardContent>
              </Card>
            </div>
          )}

          {/* Heatmap - Court x Document Type */}
          {heatmapData.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Court x Document Type Coverage</h3>
              <Card>
                <CardContent className="p-4 overflow-x-auto">
                  <Heatmap data={heatmapData} width={700} height={400} />
                </CardContent>
              </Card>
            </div>
          )}

          {/* Prioritized gap table */}
          {allItems.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">All Gaps (sorted by priority)</h3>
              <Card>
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-muted text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Dimension</th>
                      <th className="px-4 py-2 font-medium">Value</th>
                      <th className="px-4 py-2 font-medium text-right">Documents</th>
                      <th className="px-4 py-2 font-medium text-right">Latest</th>
                      <th className="px-4 py-2 font-medium text-right">Stale Days</th>
                      <th className="px-4 py-2 font-medium text-right">Gap Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {allItems.map((item, i) => (
                      <tr key={`${item.dimension}-${item.value}-${i}`}>
                        <td className="px-4 py-2">
                          <Badge variant="secondary">{formatDimension(item.dimension)}</Badge>
                        </td>
                        <td className="px-4 py-2">{formatValue(item.value)}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">
                          {item.documentCount.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right text-muted-foreground">
                          {item.latestDate ? new Date(item.latestDate).toLocaleDateString() : '-'}
                        </td>
                        <td className="px-4 py-2 text-right text-muted-foreground">
                          {item.staleDays !== null ? `${item.staleDays}d` : '-'}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <GapScoreBadge score={item.gapScore} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          )}
        </>
      )}

      {/* Source Drilldown Sheet */}
      <Sheet open={!!drilldownSourceId} onOpenChange={() => setDrilldownSourceId(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{drilldown?.sourceName ?? 'Source Drilldown'}</SheetTitle>
          </SheetHeader>
          {drilldown && (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Health Score:</span>{' '}
                  <span className="font-medium">{drilldown.healthScore?.toFixed(0) ?? '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total Docs:</span>{' '}
                  <span className="font-medium">{drilldown.totalDocuments}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Last Fetched:</span>{' '}
                  <span className="font-medium">
                    {drilldown.lastFetchedAt
                      ? new Date(drilldown.lastFetchedAt).toLocaleString()
                      : 'Never'}
                  </span>
                </div>
              </div>
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">By Document Type</h4>
                <div className="space-y-1">
                  {drilldown.byDocumentType.map((t) => (
                    <div key={t.documentType} className="flex justify-between text-sm">
                      <span>{formatValue(t.documentType)}</span>
                      <span className="text-muted-foreground">{t.count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">By Court</h4>
                <div className="space-y-1">
                  {drilldown.byCourt.map((c) => (
                    <div key={c.court} className="flex justify-between text-sm">
                      <span>{c.court}</span>
                      <span className="text-muted-foreground">{c.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function GapScoreBadge({ score }: { score: number }) {
  const color =
    score > 0.7 ? 'bg-red-100 text-red-700' : score > 0.4 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700';
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${color}`}>{score.toFixed(2)}</span>;
}

// ---- Trends Tab ----

function TrendsTab() {
  const [interval, setInterval] = useState<string>('day');
  const [periods, setPeriods] = useState<number>(30);

  const { data: trends, isLoading, error } = useIngestionTrends({ interval, periods });

  const chartData = useMemo(() => {
    if (!trends) return [];
    return trends.map((t) => ({
      date: new Date(t.period),
      value: t.documentCount,
      cumulative: t.cumulativeCount,
    }));
  }, [trends]);

  const totalDocs = trends?.reduce((sum, t) => sum + t.documentCount, 0) ?? 0;
  const avgPerPeriod = trends && trends.length > 0 ? Math.round(totalDocs / trends.length) : 0;
  const peakPeriod = trends?.reduce(
    (max, t) => (t.documentCount > max.documentCount ? t : max),
    { documentCount: 0, periodLabel: '-' },
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Interval</Label>
          <Select value={interval} onValueChange={setInterval}>
            <SelectTrigger className="w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Daily</SelectItem>
              <SelectItem value="week">Weekly</SelectItem>
              <SelectItem value="month">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Lookback</Label>
          <Select value={String(periods)} onValueChange={(v) => setPeriods(Number(v))}>
            <SelectTrigger className="w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 periods</SelectItem>
              <SelectItem value="60">60 periods</SelectItem>
              <SelectItem value="90">90 periods</SelectItem>
              <SelectItem value="180">180 periods</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Ingested</p>
            <p className="text-xl font-bold">{totalDocs.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Avg per {interval}</p>
            <p className="text-xl font-bold">{avgPerPeriod.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Peak Period</p>
            <p className="text-xl font-bold">{peakPeriod?.documentCount.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">{peakPeriod?.periodLabel}</p>
          </CardContent>
        </Card>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : 'Failed to load trends'}
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <AdminListSkeleton count={1} />
      ) : chartData.length > 0 ? (
        <Card>
          <CardContent className="p-4 overflow-x-auto">
            <LineChart data={chartData} width={700} height={300} showCumulative />
          </CardContent>
        </Card>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">No ingestion data in this range.</p>
      )}
    </div>
  );
}

// ---- Staleness Tab ----

function StalenessTab() {
  const [staleDays, setStaleDays] = useState(7);
  const { data: report, isLoading, error } = useStalenessReport(staleDays);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Staleness Report</h2>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Stale threshold:</Label>
          <Select
            value={String(staleDays)}
            onValueChange={(val) => setStaleDays(Number(val))}
          >
            <SelectTrigger className="w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3 days</SelectItem>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="14">14 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : 'Failed to load staleness report'}
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <AdminListSkeleton count={3} />
      ) : report && report.length > 0 ? (
        <Card>
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium text-right">Documents</th>
                <th className="px-4 py-2 font-medium text-right">Last Fetched</th>
                <th className="px-4 py-2 font-medium text-right">Days Stale</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {report.map((item) => (
                <StalenessRow key={item.sourceId} item={item} staleDays={staleDays} />
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No sources are stale beyond {staleDays} days.
        </p>
      )}
    </div>
  );
}

function StalenessRow({ item, staleDays }: { item: StalenessReportItem; staleDays: number }) {
  const severity =
    item.daysSinceLastFetch === null
      ? 'text-red-600'
      : item.daysSinceLastFetch > staleDays * 2
        ? 'text-red-600'
        : 'text-yellow-600';

  return (
    <tr>
      <td className="px-4 py-2">
        <span className="font-medium">{item.sourceName}</span>
        {!item.enabled && (
          <Badge className="ml-1.5 bg-muted text-muted-foreground">disabled</Badge>
        )}
      </td>
      <td className="px-4 py-2 text-muted-foreground">{item.type.replace('_', ' ')}</td>
      <td className="px-4 py-2 text-right text-muted-foreground">{item.documentCount.toLocaleString()}</td>
      <td className="px-4 py-2 text-right text-muted-foreground">
        {item.lastFetchedAt ? new Date(item.lastFetchedAt).toLocaleDateString() : 'Never'}
      </td>
      <td className={`px-4 py-2 text-right font-medium ${severity}`}>
        {item.daysSinceLastFetch !== null ? `${item.daysSinceLastFetch}d` : 'Never'}
      </td>
    </tr>
  );
}

// ---- Helpers ----

function formatDimension(dim: string): string {
  return dim
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(val: string): string {
  return val
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
