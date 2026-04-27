'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Clock,
  Activity,
  CheckCircle2,
  XCircle,
  FileText,
  Layers,
  Copy,
  SkipForward,
} from 'lucide-react';

import {
  useIngestionPipelineStats,
  useIngestionJobHistory,
  useIngestionCandidates,
  useEndpointStatus,
  useDispatchCitationsBackfill,
} from '@/features/admin/hooks/use-admin';
import { AdminCardSkeleton, AdminListSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-100 text-green-800',
  running: 'bg-blue-100 text-blue-800',
  pending: 'bg-yellow-100 text-yellow-800',
  failed: 'bg-red-100 text-red-800',
};

const DEDUP_COLORS: Record<string, string> = {
  exact_duplicate: 'bg-red-100 text-red-800',
  mirror_duplicate: 'bg-orange-100 text-orange-800',
  version_update: 'bg-blue-100 text-blue-800',
  possible_duplicate: 'bg-yellow-100 text-yellow-800',
  new_document: 'bg-green-100 text-green-800',
};

export default function IngestionDashboardPage() {
  const [period, setPeriod] = useState<string>('week');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [triggerFilter, setTriggerFilter] = useState<string>('');
  const [jobCursor, setJobCursor] = useState<string | undefined>(undefined);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  // Citations backfill controls
  const [confirmCitationsBackfill, setConfirmCitationsBackfill] = useState(false);
  const [citationsLimit, setCitationsLimit] = useState<string>('');
  const [citationsMsg, setCitationsMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const { data: stats, isLoading: statsLoading } = useIngestionPipelineStats(period);
  const { data: jobsData, isLoading: jobsLoading } = useIngestionJobHistory({
    status: statusFilter || undefined,
    triggerType: triggerFilter || undefined,
    cursor: jobCursor,
  });
  const { data: endpoints, isLoading: endpointsLoading } = useEndpointStatus();
  const citationsBackfill = useDispatchCitationsBackfill();

  const handleCitationsBackfillConfirm = () => {
    const parsed = citationsLimit.trim() === '' ? undefined : Number(citationsLimit);
    if (parsed !== undefined && (!Number.isFinite(parsed) || parsed < 1)) {
      setCitationsMsg({ type: 'error', text: 'Limit must be a positive integer.' });
      return;
    }
    citationsBackfill.mutate(
      { limit: parsed },
      {
        onSuccess: (data) => {
          setConfirmCitationsBackfill(false);
          setCitationsMsg({
            type: 'success',
            text: `Citations backfill dispatched (task ${data.taskId.slice(0, 8)}…).`,
          });
        },
        onError: (err) => {
          setConfirmCitationsBackfill(false);
          setCitationsMsg({
            type: 'error',
            text: err instanceof Error ? err.message : 'Failed to dispatch backfill',
          });
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/admin"
          className="mb-2 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Admin
        </Link>
        <h1 className="text-2xl font-bold">Ingestion Pipeline</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Monitor ingestion jobs, pipeline stats, and source endpoint health
        </p>
      </div>

      {/* Period Selector + Citations Backfill */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Period:</span>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">Last 7 days</SelectItem>
              <SelectItem value="month">Last 30 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setCitationsLimit('');
            setConfirmCitationsBackfill(true);
          }}
          disabled={citationsBackfill.isPending}
        >
          {citationsBackfill.isPending ? 'Dispatching...' : 'Backfill Citations'}
        </Button>
      </div>

      {citationsMsg && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${citationsMsg.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}
        >
          {citationsMsg.text}
        </div>
      )}

      {confirmCitationsBackfill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold">Confirm Citations Backfill</h3>
            <p className="mt-2 text-sm text-gray-600">
              Dispatch the citation extraction task across the corpus. Existing
              citations are not duplicated. The task runs asynchronously on the
              worker pool.
            </p>
            <label className="mt-4 block text-sm font-medium text-gray-700">
              Limit (optional)
              <input
                type="number"
                value={citationsLimit}
                onChange={(e) => setCitationsLimit(e.target.value)}
                placeholder="No limit"
                min={1}
                max={10000}
                className="mt-1 w-full rounded border-gray-300 text-sm"
              />
            </label>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setConfirmCitationsBackfill(false)}
                className="rounded border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleCitationsBackfillConfirm}
                disabled={citationsBackfill.isPending}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {citationsBackfill.isPending ? 'Dispatching...' : 'Dispatch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      {statsLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <AdminCardSkeleton key={i} />
          ))}
        </div>
      ) : stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Activity className="h-4 w-4" />
                Total Jobs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{stats.totalJobs}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <CheckCircle2 className="h-4 w-4" />
                Success Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-green-600">
                {stats.successRate != null ? `${stats.successRate}%` : 'N/A'}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Clock className="h-4 w-4" />
                Avg Duration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {stats.avgDurationMs != null
                  ? `${(stats.avgDurationMs / 1000).toFixed(1)}s`
                  : 'N/A'}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <FileText className="h-4 w-4" />
                Docs Ingested
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-blue-600">{stats.documentsIngested}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Layers className="h-4 w-4" />
                Active Endpoints
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{stats.activeEndpoints}</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Secondary Stats Row */}
      {stats && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Copy className="h-5 w-5 text-orange-500" />
              <div>
                <p className="text-sm text-muted-foreground">Duplicates Detected</p>
                <p className="text-lg font-semibold">{stats.documentsDuplicate}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <SkipForward className="h-5 w-5 text-yellow-500" />
              <div>
                <p className="text-sm text-muted-foreground">Skipped</p>
                <p className="text-lg font-semibold">{stats.documentsSkipped}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <XCircle className="h-5 w-5 text-red-500" />
              <div>
                <p className="text-sm text-muted-foreground">Failed Jobs</p>
                <p className="text-lg font-semibold">{stats.failedJobs}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Separator />

      {/* Job History */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Job History</h2>
        <div className="mb-4 flex items-center gap-4">
          <Select
            value={statusFilter || 'all'}
            onValueChange={(v) => {
              setStatusFilter(v === 'all' ? '' : v);
              setJobCursor(undefined);
            }}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={triggerFilter || 'all'}
            onValueChange={(v) => {
              setTriggerFilter(v === 'all' ? '' : v);
              setJobCursor(undefined);
            }}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All Triggers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Triggers</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {jobsLoading ? (
          <AdminListSkeleton />
        ) : jobsData?.items && jobsData.items.length > 0 ? (
          <div className="space-y-2">
            {jobsData.items.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                isExpanded={expandedJobId === job.id}
                onToggle={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}
              />
            ))}

            {jobsData.meta?.hasNext && (
              <div className="flex justify-center pt-4">
                <Button
                  variant="outline"
                  onClick={() => setJobCursor(jobsData.meta?.nextCursor)}
                >
                  Load More
                </Button>
              </div>
            )}
          </div>
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No ingestion jobs found matching the current filters.
            </CardContent>
          </Card>
        )}
      </div>

      <Separator />

      {/* Endpoint Status */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Source Endpoints</h2>

        {endpointsLoading ? (
          <AdminListSkeleton />
        ) : endpoints && endpoints.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {endpoints.map((ep) => (
              <Card key={ep.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="truncate text-sm font-medium">
                        {ep.source.name}
                      </CardTitle>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {ep.endpointUrl}
                      </p>
                    </div>
                    <Badge
                      variant="secondary"
                      className={ep.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}
                    >
                      {ep.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Parser</span>
                    <span>{ep.parserType}</span>
                  </div>
                  {ep.scheduleCron && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Schedule</span>
                      <span className="font-mono">{ep.scheduleCron}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Last Fetched</span>
                    <span>
                      {ep.lastFetchedAt
                        ? new Date(ep.lastFetchedAt).toLocaleDateString()
                        : 'Never'}
                    </span>
                  </div>
                  {ep.fetchSuccessRate != null && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Success Rate (recent)</span>
                      <span
                        className={
                          ep.fetchSuccessRate >= 80
                            ? 'text-green-600'
                            : ep.fetchSuccessRate >= 50
                              ? 'text-yellow-600'
                              : 'text-red-600'
                        }
                      >
                        {ep.fetchSuccessRate}%
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No source endpoints configured.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---- Job Row with expandable candidates ----

function JobRow({
  job,
  isExpanded,
  onToggle,
}: {
  job: Record<string, unknown>;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const j = job as {
    id: string;
    status: string;
    triggerType: string;
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    recordsFound: number;
    recordsCreated: number;
    recordsUpdated: number;
    recordsSkipped: number;
    recordsDuplicate: number;
    source: { id: string; name: string; type: string };
    sourceEndpoint: { id: string; endpointUrl: string; parserType: string } | null;
  };

  return (
    <Card>
      <CardContent className="p-4">
        <button
          onClick={onToggle}
          className="flex w-full items-start justify-between text-left"
        >
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="font-medium">{j.source.name}</span>
              <Badge variant="secondary" className={STATUS_COLORS[j.status] || ''}>
                {j.status}
              </Badge>
              <Badge variant="outline">{j.triggerType}</Badge>
            </div>
            <div className="ml-8 mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
              {j.startedAt && (
                <span>Started: {new Date(j.startedAt).toLocaleString()}</span>
              )}
              {j.durationMs != null && (
                <span>Duration: {(j.durationMs / 1000).toFixed(1)}s</span>
              )}
              <span>Found: {j.recordsFound}</span>
              <span>Created: {j.recordsCreated}</span>
              {j.recordsDuplicate > 0 && (
                <span className="text-orange-600">Duplicates: {j.recordsDuplicate}</span>
              )}
              {j.recordsSkipped > 0 && (
                <span className="text-yellow-600">Skipped: {j.recordsSkipped}</span>
              )}
            </div>
          </div>
        </button>

        {isExpanded && <CandidatesPanel jobId={j.id} />}
      </CardContent>
    </Card>
  );
}

// ---- Expandable Candidates Panel ----

function CandidatesPanel({ jobId }: { jobId: string }) {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const { data, isLoading } = useIngestionCandidates(jobId, cursor);

  if (isLoading) {
    return (
      <div className="ml-8 mt-3 text-sm text-muted-foreground">
        Loading candidates...
      </div>
    );
  }

  if (!data?.items || data.items.length === 0) {
    return (
      <div className="ml-8 mt-3 text-sm text-muted-foreground">
        No candidates recorded for this job.
      </div>
    );
  }

  return (
    <div className="ml-8 mt-3 space-y-2">
      <p className="text-xs font-semibold uppercase text-muted-foreground">
        Candidates
      </p>
      {data.items.map((c) => (
        <div
          key={c.id}
          className="flex items-start justify-between rounded border p-2 text-sm"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              {c.detectedTitle || c.detectedUrl || 'Unknown'}
            </p>
            <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
              {c.detectedDocumentType && <span>{c.detectedDocumentType}</span>}
              <span>Status: {c.status}</span>
              {c.processedAt && (
                <span>Processed: {new Date(c.processedAt).toLocaleString()}</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {c.dedupClassification && (
              <Badge
                variant="secondary"
                className={DEDUP_COLORS[c.dedupClassification] || ''}
              >
                {c.dedupClassification.replace(/_/g, ' ')}
              </Badge>
            )}
            {c.dedupConfidence != null && (
              <Badge variant="outline">
                {Math.round(c.dedupConfidence * 100)}%
              </Badge>
            )}
          </div>
        </div>
      ))}

      {data.meta?.hasNext && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCursor(data.meta?.nextCursor)}
        >
          Load more candidates
        </Button>
      )}
    </div>
  );
}
