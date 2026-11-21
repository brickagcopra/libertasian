'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminListSkeleton } from '@/components/ui/skeleton';
import { ROUTES } from '@/lib/constants';

import { useModerationCase } from '../hooks/use-moderation';
import { formatDateTime } from '../sla';
import { TARGET_TYPE_LABELS, type ModerationTargetType } from '../types';
import { ActionEntryRow } from './action-log';
import { AuthorPanel } from './author-panel';
import { DismissDialog, RemoveContentDialog, RestoreDialog } from './case-action-dialogs';
import {
  AutoHiddenBadge,
  ContentStatusBadge,
  SlaBadge,
  reasonLabel,
} from './moderation-badges';

export const SELF_MODERATION_NOTE = "You can't moderate your own content";

const REPORT_STATUS_CLASSES: Record<string, string> = {
  open: 'bg-amber-100 text-amber-700',
  dismissed: 'bg-gray-100 text-gray-700',
  actioned: 'bg-red-100 text-red-700',
};

export function isModerationTargetType(v: string): v is ModerationTargetType {
  return Object.prototype.hasOwnProperty.call(TARGET_TYPE_LABELS, v);
}

function BackLink() {
  return (
    <Link
      href={ROUTES.ADMIN_MODERATION}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeftIcon className="size-4" />
      Back to queue
    </Link>
  );
}

export function CaseDetail({
  targetType,
  targetId,
}: {
  targetType: ModerationTargetType;
  targetId: string;
}) {
  const { data: c, isLoading, error } = useModerationCase(targetType, targetId);
  const [dialog, setDialog] = useState<'dismiss' | 'remove' | 'restore' | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <BackLink />
        <AdminListSkeleton count={3} />
      </div>
    );
  }

  if (error || !c) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : 'Failed to load this case'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const isOpen = c.status === 'open';
  const label = TARGET_TYPE_LABELS[c.targetType];
  const openDialog = (d: 'dismiss' | 'remove' | 'restore') => () => setDialog(d);
  const dialogProps = (d: 'dismiss' | 'remove' | 'restore') => ({
    open: dialog === d,
    onOpenChange: (o: boolean) => setDialog(o ? d : null),
    targetType: c.targetType,
    targetId: c.targetId,
  });

  return (
    <div className="space-y-6">
      <BackLink />

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">{label} report case</h1>
        {isOpen && <SlaBadge firstReportedAt={c.firstReportedAt} />}
        <ContentStatusBadge status={c.contentStatus} />
        {c.autoHidden && <AutoHiddenBadge />}
        {!isOpen && (
          <Badge variant="secondary">
            Resolved{c.resolution ? ` · ${c.resolution}` : ''} {formatDateTime(c.resolvedAt)}
          </Badge>
        )}
      </div>

      {/* Action bar */}
      <Card className="py-4">
        <CardContent className="flex flex-wrap items-center gap-2 px-4">
          {isOpen && (
            <>
              <Button variant="outline" disabled={!c.canAct} onClick={openDialog('dismiss')}>
                Dismiss reports
              </Button>
              <Button
                variant="destructive"
                disabled={!c.canAct || !c.canRemove}
                onClick={openDialog('remove')}
              >
                Remove content
              </Button>
            </>
          )}
          {c.canRestore && (
            <Button variant="outline" disabled={!c.canAct} onClick={openDialog('restore')}>
              Restore
            </Button>
          )}
          {!c.canAct ? (
            <p className="text-sm text-muted-foreground" data-testid="self-moderation-note">
              {SELF_MODERATION_NOTE}
            </p>
          ) : (
            !isOpen &&
            !c.canRestore && (
              <p className="text-sm text-muted-foreground">This case is resolved.</p>
            )
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          {/* Content */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reported {label.toLowerCase()}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {c.content.title && <p className="font-semibold">{c.content.title}</p>}
              {c.content.body ? (
                <p className="whitespace-pre-wrap break-words text-sm">{c.content.body}</p>
              ) : (
                <p className="text-sm italic text-muted-foreground">
                  {c.contentStatus === 'unknown' ? 'This content no longer exists.' : 'No body text.'}
                </p>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Created {formatDateTime(c.content.createdAt)}</span>
                {c.content.editedAt && <span>Edited {formatDateTime(c.content.editedAt)}</span>}
                {c.content.rawStatus && <span>Raw status: {c.content.rawStatus}</span>}
                {c.author && <span>By {c.author.fullName}</span>}
              </div>
            </CardContent>
          </Card>

          {c.context && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">In reply to post</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {c.context.preview ?? 'No preview'}
                </p>
                <div className="flex gap-3 text-xs">
                  {c.context.author && (
                    <span className="text-muted-foreground">By {c.context.author.fullName}</span>
                  )}
                  <Link
                    href={ROUTES.ADMIN_MODERATION_CASE(c.context.targetType, c.context.targetId)}
                    className="text-primary hover:underline"
                  >
                    Open post case
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Reports */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reports ({c.reports.length})</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {c.reports.length === 0 ? (
                <p className="text-sm text-muted-foreground">No reports.</p>
              ) : (
                c.reports.map((r) => (
                  <div key={r.id} className="space-y-1 py-3 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{reasonLabel(r.reason)}</span>
                      <Badge
                        variant="secondary"
                        className={REPORT_STATUS_CLASSES[r.status] ?? ''}
                      >
                        {r.status}
                      </Badge>
                    </div>
                    {r.details && (
                      <p className="whitespace-pre-wrap break-words text-sm">{r.details}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {r.reporter.fullName} · {formatDateTime(r.createdAt)}
                      {r.resolvedBy &&
                        ` · ${r.status} by ${r.resolvedBy.fullName} ${formatDateTime(r.resolvedAt)}`}
                    </p>
                    {r.resolutionNote && (
                      <p className="text-xs text-muted-foreground">“{r.resolutionNote}”</p>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* History */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">History</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {c.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No moderation actions yet.</p>
              ) : (
                c.history.map((h) => <ActionEntryRow key={h.id} entry={h} />)
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {c.authorProfile ? (
            <AuthorPanel profile={c.authorProfile} canAct={c.canAct} />
          ) : (
            <Card>
              <CardContent className="text-sm text-muted-foreground">
                The author account is unavailable.
              </CardContent>
            </Card>
          )}
          {c.authorProfile && c.authorProfile.history.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Author moderation history</CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                {c.authorProfile.history.map((h) => (
                  <ActionEntryRow key={h.id} entry={h} linkTarget />
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <DismissDialog
        {...dialogProps('dismiss')}
        autoHidden={c.autoHidden}
        reportCount={c.reportCount}
      />
      <RemoveContentDialog {...dialogProps('remove')} />
      <RestoreDialog {...dialogProps('restore')} />
    </div>
  );
}
