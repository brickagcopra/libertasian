'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type {
  GenerationJobDetail,
  GenerationJobSummary,
} from '@/features/admin/hooks/use-admin-bar-exam-answers';
import { isJobActive } from '@/features/admin/hooks/use-admin-bar-exam-answers';

/**
 * Per-question failures used to exist only inside a Celery result nobody
 * read. Shown to an editor they have to say what actually happened, in words
 * — the raw code is kept alongside for a bug report.
 */
const ERROR_LABELS: Record<string, string> = {
  llm_invalid_json: 'Model returned invalid output',
  llm_malformed: 'Model output was missing required sections',
  llm_abstained: 'Model declined to answer',
  question_not_found: 'Question no longer exists',
  error: 'Unexpected error during generation',
  unknown_status: 'Unrecognised generator result',
};

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  completed_with_failures: 'Completed with failures',
  cancelled: 'Cancelled',
  paused_budget: 'Paused — AI budget reached',
};

export interface GenerationJobsPanelProps {
  jobs: GenerationJobSummary[];
  expandedJobId: string | null;
  expandedJob?: GenerationJobDetail | undefined;
  isLoadingExpanded?: boolean;
  busyJobId?: string | null;
  onToggleExpand: (id: string) => void;
  onCancel: (id: string) => void;
  onRetryFailed: (id: string) => void;
}

export function GenerationJobsPanel({
  jobs,
  expandedJobId,
  expandedJob,
  isLoadingExpanded,
  busyJobId,
  onToggleExpand,
  onCancel,
  onRetryFailed,
}: GenerationJobsPanelProps) {
  if (jobs.length === 0) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          No generation jobs yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Generation jobs
      </h2>
      {jobs.map((job) => {
        const expanded = expandedJobId === job.id;
        const pct =
          job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
        const active = isJobActive(job);
        const busy = busyJobId === job.id;

        return (
          <Card key={job.id}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={active ? 'default' : 'outline'}>
                    {STATUS_LABELS[job.status] ?? job.status}
                  </Badge>
                  {job.stalled && (
                    <Badge className="bg-orange-100 text-orange-900">
                      Stalled — no progress for 15 minutes
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {new Date(job.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="flex gap-2">
                  {job.counts.failed > 0 || job.status === 'paused_budget' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onRetryFailed(job.id)}
                    >
                      {job.status === 'paused_budget'
                        ? 'Resume'
                        : `Retry failed (${job.counts.failed})`}
                    </Button>
                  ) : null}
                  {(active || job.status === 'paused_budget') && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onCancel(job.id)}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-3">
                <div
                  className="h-2 w-full overflow-hidden rounded bg-muted"
                  role="progressbar"
                  aria-valuenow={job.done}
                  aria-valuemin={0}
                  aria-valuemax={job.total}
                  aria-label="Generation progress"
                >
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {job.done}/{job.total} done ({pct}%) · {job.counts.generated}{' '}
                  grounded · {job.counts.generatedUngrounded} ungrounded ·{' '}
                  {job.counts.skippedExisting} already answered ·{' '}
                  {job.counts.keptExisting} kept existing (new answer
                  wasn&apos;t better) · {job.counts.failed} failed ·{' '}
                  {job.counts.queued} queued
                </p>
              </div>

              {job.counts.failed > 0 && (
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="px-1"
                    onClick={() => onToggleExpand(job.id)}
                  >
                    {expanded ? (
                      <ChevronDown className="mr-1 h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="mr-1 h-3.5 w-3.5" />
                    )}
                    {expanded ? 'Hide' : 'Show'} failed questions
                  </Button>

                  {expanded && (
                    <div className="mt-2 space-y-1 rounded border bg-muted/30 p-2">
                      {isLoadingExpanded && (
                        <p className="text-xs text-muted-foreground">Loading…</p>
                      )}
                      {expandedJob?.failedItems.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex flex-wrap items-baseline gap-x-2 text-xs"
                        >
                          <span className="font-medium tabular-nums">
                            {item.sittingYear} ·{' '}
                            {item.subjectStudyCode ?? 'unclassified'} · Q
                            {item.questionNumber}
                          </span>
                          <span className="text-muted-foreground">
                            {ERROR_LABELS[item.errorCode ?? ''] ??
                              item.errorCode ??
                              'Unknown failure'}
                          </span>
                          {item.errorMessage && (
                            <span className="text-muted-foreground/80">
                              — {item.errorMessage}
                            </span>
                          )}
                        </div>
                      ))}
                      {expandedJob?.failedItems.meta.hasNext && (
                        <p className="text-xs text-muted-foreground">
                          Showing the first {expandedJob.failedItems.meta.limit}{' '}
                          failures.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
