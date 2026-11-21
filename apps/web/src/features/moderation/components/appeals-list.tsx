'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AdminListSkeleton } from '@/components/ui/skeleton';
import { ROUTES } from '@/lib/constants';

import { useDecideAppeal, useModerationAppeals } from '../hooks/use-moderation';
import { formatDateTime } from '../sla';
import { REASON_LABELS, TARGET_TYPE_LABELS, type AppealStatus, type ModerationAppeal } from '../types';
import { NoteField, errorMessage } from './case-action-dialogs';
import { ACTION_LABELS } from './moderation-badges';

const STATUS_TABS: Array<{ value: AppealStatus; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'granted', label: 'Granted' },
  { value: 'denied', label: 'Denied' },
];

function decisionSummary(a: ModerationAppeal): string {
  const d = a.decision;
  const what =
    d.targetType === 'user'
      ? ACTION_LABELS[d.action]
      : `${ACTION_LABELS[d.action]} (${TARGET_TYPE_LABELS[d.targetType].toLowerCase()})`;
  return d.reason ? `${what} · ${REASON_LABELS[d.reason] ?? d.reason}` : what;
}

function DecideAppealDialog({
  appeal,
  grant,
  onClose,
}: {
  appeal: ModerationAppeal | null;
  grant: boolean;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const decide = useDecideAppeal();

  const close = () => {
    setNote('');
    decide.reset();
    onClose();
  };

  const submit = () => {
    if (!appeal) return;
    const trimmed = note.trim();
    decide.mutate(
      { appealId: appeal.id, input: { decision: grant ? 'grant' : 'deny', ...(trimmed ? { note: trimmed } : {}) } },
      {
        onSuccess: () => {
          toast.success(grant ? 'Appeal granted' : 'Appeal denied');
          close();
        },
      },
    );
  };

  const undo =
    appeal?.decision.targetType === 'user'
      ? 'The sanction is lifted now.'
      : 'The content is restored to the community.';

  return (
    <AlertDialog open={appeal !== null} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{grant ? 'Grant this appeal?' : 'Deny this appeal?'}</AlertDialogTitle>
          <AlertDialogDescription>
            {grant
              ? `${undo} ${appeal?.appellant.fullName ?? 'The author'} is notified.`
              : `The decision stands. ${appeal?.appellant.fullName ?? 'The author'} is notified, with your note if you add one.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <NoteField id="appeal-note" label="Note to the author (optional)" value={note} onChange={setNote} />
        {decide.error && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(decide.error, 'Failed to decide the appeal')}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={decide.isPending}>Cancel</AlertDialogCancel>
          <Button variant={grant ? 'default' : 'destructive'} disabled={decide.isPending} onClick={submit}>
            {decide.isPending ? 'Saving…' : grant ? 'Grant' : 'Deny'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function AppealsList() {
  const [status, setStatus] = useState<AppealStatus>('open');
  const [deciding, setDeciding] = useState<{ appeal: ModerationAppeal; grant: boolean } | null>(null);
  const { data, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useModerationAppeals(status);
  const appeals = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="group" aria-label="Appeal status">
        {STATUS_TABS.map((t) => (
          <Button
            key={t.value}
            size="sm"
            variant={status === t.value ? 'default' : 'outline'}
            onClick={() => setStatus(t.value)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(error, 'Failed to load appeals')}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <AdminListSkeleton />
      ) : appeals.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {status === 'open' ? 'No open appeals.' : `No ${status} appeals.`}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {appeals.map((a) => (
            <Card key={a.id} data-testid="moderation-appeal">
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{a.appellant.fullName}</span>
                  <span className="text-muted-foreground">appealed</span>
                  <Badge variant="outline" className="font-normal">
                    {decisionSummary(a)}
                  </Badge>
                  <span className="text-muted-foreground">
                    by {a.decision.moderator?.fullName ?? 'automation'} on {formatDateTime(a.decision.createdAt)}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">Filed {formatDateTime(a.createdAt)}</span>
                </div>

                {a.decision.targetType !== 'user' && (
                  <Link
                    href={ROUTES.ADMIN_MODERATION_CASE(a.decision.targetType, a.decision.targetId)}
                    className="block rounded-md border bg-muted/30 p-2 text-sm hover:underline"
                  >
                    {a.preview ?? <span className="italic text-muted-foreground">No preview</span>}
                  </Link>
                )}

                <blockquote className="whitespace-pre-wrap border-l-2 pl-3 text-sm">{a.statement}</blockquote>

                {a.status === 'open' ? (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => setDeciding({ appeal: a, grant: true })}>
                      Grant
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setDeciding({ appeal: a, grant: false })}>
                      Deny
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {a.status === 'granted' ? 'Granted' : 'Denied'}
                    {a.decidedBy ? ` by ${a.decidedBy.fullName}` : ''}
                    {a.decidedAt ? ` on ${formatDateTime(a.decidedAt)}` : ''}
                    {a.decisionNote ? ` · ${a.decisionNote}` : ''}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}

      <DecideAppealDialog
        appeal={deciding?.appeal ?? null}
        grant={deciding?.grant ?? false}
        onClose={() => setDeciding(null)}
      />
    </div>
  );
}
