'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, PlayIcon, Loader2 } from 'lucide-react';

import {
  useAutoPromoteStatus,
  useTriggerAutoPromoteSweep,
} from '@/features/admin/hooks/use-pipeline-ops';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AdminCardSkeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const RECENT_CLICK_DEBOUNCE_MS = 2000;

export default function PipelineOpsPage() {
  const status = useAutoPromoteStatus();
  const sweep = useTriggerAutoPromoteSweep();

  const [recentlyClicked, setRecentlyClicked] = useState(false);
  const [actionMsg, setActionMsg] = useState<
    | { tone: 'success' | 'error'; text: string }
    | null
  >(null);

  useEffect(() => {
    if (!recentlyClicked) return;
    const id = setTimeout(() => setRecentlyClicked(false), RECENT_CLICK_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [recentlyClicked]);

  // Auto-dismiss the action message after 6s so it doesn't pin to the page forever.
  useEffect(() => {
    if (!actionMsg) return;
    const id = setTimeout(() => setActionMsg(null), 6000);
    return () => clearTimeout(id);
  }, [actionMsg]);

  const handleSweep = () => {
    if (sweep.isPending || recentlyClicked) return;
    setRecentlyClicked(true);
    sweep.mutate(undefined, {
      onSuccess: (data) => {
        setActionMsg({
          tone: 'success',
          text: `Sweep complete — promoted ${data.promoted} / ${data.scanned} scanned.`,
        });
      },
      onError: (err) => {
        setActionMsg({
          tone: 'error',
          text: `Sweep failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        });
      },
    });
  };

  const sweepDisabled = sweep.isPending || recentlyClicked;
  const data = status.data;

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link
              href="/admin"
              className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Back to Dashboard
            </Link>
            <h1 className="text-2xl font-bold">Pipeline Operations</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manual triggers and live status for background corpus pipeline jobs.
            </p>
          </div>
          <Button
            onClick={handleSweep}
            disabled={sweepDisabled}
            aria-busy={sweep.isPending}
            aria-label="Run auto-promote sweep now"
            className="self-start sm:self-auto"
          >
            {sweep.isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Sweeping…
              </>
            ) : (
              <>
                <PlayIcon className="mr-2 size-4" />
                Run sweep now
              </>
            )}
          </Button>
        </div>

        {/* Action result */}
        {actionMsg && (
          <Alert variant={actionMsg.tone === 'error' ? 'destructive' : 'default'}>
            <AlertDescription
              className={actionMsg.tone === 'success' ? 'text-green-700' : undefined}
            >
              {actionMsg.text}
            </AlertDescription>
          </Alert>
        )}

        {/* KPI strip */}
        {status.isLoading ? (
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <AdminCardSkeleton key={i} />
            ))}
          </div>
        ) : status.error ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {status.error instanceof Error
                  ? status.error.message
                  : 'Failed to load auto-promote status.'}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => status.refetch()}
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : data ? (
          <>
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Last sweep"
                value={formatRelativeTime(data.lastSweepAt)}
                sublabel={
                  data.lastPromoted !== null
                    ? `${data.lastPromoted.toLocaleString()} promoted`
                    : undefined
                }
              />
              <KpiCard
                label="Promoted (24h)"
                value={data.last24hPromoted.toLocaleString()}
              />
              <KpiCard
                label="Promoted (all-time)"
                value={data.totalPromoted.toLocaleString()}
              />
              <KpiCard
                label="Config"
                value={data.configThreshold.toFixed(2)}
                sublabel="threshold"
                tooltip={
                  data.configExcludedTypes.length > 0
                    ? `Excluded types: ${data.configExcludedTypes.join(', ')}`
                    : 'No excluded types'
                }
              />
            </div>

            {/* Status block */}
            <Card>
              <CardContent className="space-y-4 p-6">
                <div>
                  <h2 className="text-base font-semibold">
                    Auto-promote configuration (read-only)
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Auto-promote runs continuously in the background. Use “Run sweep
                    now” to force an out-of-cycle pass.
                  </p>
                </div>
                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <DefRow label="Threshold">
                    <span className="font-mono tabular-nums">
                      {data.configThreshold.toFixed(2)}
                    </span>
                  </DefRow>
                  <DefRow label="Excluded types">
                    {data.configExcludedTypes.length === 0 ? (
                      <span className="text-muted-foreground">None</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {data.configExcludedTypes.map((t) => (
                          <Badge key={t} variant="secondary">
                            {t}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </DefRow>
                  <DefRow label="Last sweep">
                    <span className="tabular-nums">
                      {data.lastSweepAt
                        ? new Date(data.lastSweepAt).toLocaleString()
                        : '—'}
                    </span>
                  </DefRow>
                  <DefRow label="Last sweep promoted">
                    <span className="font-mono tabular-nums">
                      {data.lastPromoted ?? '—'}
                    </span>
                  </DefRow>
                </dl>
              </CardContent>
            </Card>
          </>
        ) : null}

        {/* Footer note */}
        <p className="text-xs text-muted-foreground">
          Manual sweeps are throttled to 10 per minute and audited. Action recorded in{' '}
          <code className="rounded bg-muted px-1 py-0.5">audit_logs</code> as{' '}
          <code className="rounded bg-muted px-1 py-0.5">
            admin_triggered_auto_promote_sweep
          </code>
          .
        </p>
      </div>
    </TooltipProvider>
  );
}

// ---- Sub-components ----

function KpiCard({
  label,
  value,
  sublabel,
  tooltip,
}: {
  label: string;
  value: string;
  sublabel?: string;
  tooltip?: string;
}) {
  const body = (
    <Card className="h-full">
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
        {sublabel && (
          <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p>
        )}
      </CardContent>
    </Card>
  );

  if (!tooltip) return body;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div tabIndex={0} className="cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
          {body}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p className="max-w-xs text-xs">{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function DefRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className="min-w-[140px] text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((then - now) / 1000);

  const absSec = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (absSec < 60) return rtf.format(diffSec, 'second');
  if (absSec < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (absSec < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (absSec < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), 'day');
  if (absSec < 86400 * 365)
    return rtf.format(Math.round(diffSec / (86400 * 30)), 'month');
  return rtf.format(Math.round(diffSec / (86400 * 365)), 'year');
}
