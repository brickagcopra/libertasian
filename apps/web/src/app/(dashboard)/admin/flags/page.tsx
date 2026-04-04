'use client';

import { useState } from 'react';

import { useEditorialFlags } from '@/features/admin/hooks/use-admin';
import { AdminListSkeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

const STATUS_FILTERS = ['all', 'open', 'resolved', 'dismissed'] as const;

const severityVariants: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-muted text-muted-foreground',
};

const statusVariants: Record<string, string> = {
  open: 'bg-yellow-100 text-yellow-700',
  resolved: 'bg-green-100 text-green-700',
  dismissed: 'bg-muted text-muted-foreground',
};

export default function EditorialFlagsPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const queryStatus = statusFilter === 'all' ? undefined : statusFilter;
  const { data: flags, isLoading, error } = useEditorialFlags(queryStatus);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Editorial Flags</h1>
        <p className="mt-1 text-sm text-muted-foreground">Content quality and accuracy flags</p>
      </div>

      {/* Status Filter */}
      <div className="flex gap-2">
        {STATUS_FILTERS.map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : 'Failed to load flags'}
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <AdminListSkeleton />
      ) : flags && flags.length > 0 ? (
        <Card>
          <div className="divide-y">
            {flags.map((flag) => (
              <div key={flag.id} className="px-4 py-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {flag.flagType.replace(/_/g, ' ')}
                      </span>
                      <Badge className={severityVariants[flag.severity] ?? 'bg-muted text-muted-foreground'}>
                        {flag.severity}
                      </Badge>
                      <Badge className={statusVariants[flag.status] ?? 'bg-muted text-muted-foreground'}>
                        {flag.status}
                      </Badge>
                    </div>
                    {flag.details && (
                      <p className="mt-1 text-sm text-muted-foreground">{flag.details}</p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {flag.legalDocument && (
                        <span>Doc: {flag.legalDocument.title}</span>
                      )}
                      {flag.digest && (
                        <span>Digest: {flag.digest.title}</span>
                      )}
                      <span>{new Date(flag.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">No editorial flags found.</p>
      )}
    </div>
  );
}
