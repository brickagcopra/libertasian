'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { useModerationStats } from '../hooks/use-moderation';
import { formatHours, formatRelative } from '../sla';

function StatCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string | number;
  tone?: 'red' | 'amber';
  hint?: string;
}) {
  return (
    <Card className="py-4">
      <CardContent className="px-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p
          className={cn(
            'mt-1 text-2xl font-bold',
            tone === 'red' && 'text-red-600',
            tone === 'amber' && 'text-amber-600',
          )}
        >
          {value}
        </p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function ModerationStatCards() {
  const { data: stats, isLoading, error } = useModerationStats();

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }

  if (error || !stats) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error instanceof Error ? error.message : 'Failed to load moderation stats'}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <StatCard
        label="Open cases"
        value={stats.openCases}
        hint={`${stats.openReports} report${stats.openReports === 1 ? '' : 's'}`}
      />
      <StatCard
        label="Over 24h"
        value={stats.overdueCases}
        tone={stats.overdueCases > 0 ? 'red' : undefined}
      />
      <StatCard
        label="Due soon (12–24h)"
        value={stats.dueSoonCases}
        tone={stats.dueSoonCases > 0 ? 'amber' : undefined}
      />
      <StatCard label="Oldest open" value={formatRelative(stats.oldestOpenAt)} />
      <StatCard label="Resolved (7d)" value={stats.resolvedLast7d} />
      <StatCard label="Median resolution" value={formatHours(stats.medianResolutionHours7d)} />
    </div>
  );
}
