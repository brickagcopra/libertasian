'use client';

import { useState } from 'react';
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
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

import { useBulkResolve } from '../hooks/use-moderation';
import type { BulkResolveResult, ModerationReason, ModerationTargetType } from '../types';
import { NoteField, ReasonSelect, errorMessage } from './case-action-dialogs';

export type BulkDecision = 'dismiss' | 'remove';

interface Props {
  decision: BulkDecision | null;
  cases: Array<{ targetType: ModerationTargetType; targetId: string }>;
  onClose: () => void;
  /** Called with the cases that were resolved, so the queue can clear them from the selection. */
  onDone: (result: BulkResolveResult) => void;
}

/** One decision applied to every selected case. Each case is decided independently server-side. */
export function BulkActionDialog({ decision, cases, onClose, onDone }: Props) {
  const [reason, setReason] = useState<ModerationReason | ''>('');
  const [note, setNote] = useState('');
  const bulk = useBulkResolve();
  const n = cases.length;
  const removing = decision === 'remove';

  const close = () => {
    setReason('');
    setNote('');
    bulk.reset();
    onClose();
  };

  const submit = () => {
    if (!decision || n === 0) return;
    if (removing && !reason) return;
    const trimmed = note.trim();
    bulk.mutate(
      {
        cases,
        decision,
        ...(reason ? { reason } : {}),
        ...(trimmed ? { note: trimmed } : {}),
      },
      {
        onSuccess: (result) => {
          const ok = result.succeeded.length;
          const verb = removing ? 'removed' : 'dismissed';
          if (result.failed.length === 0) {
            toast.success(`${ok} case${ok === 1 ? '' : 's'} ${verb}`);
          } else {
            toast.warning(
              `${ok} ${verb}, ${result.failed.length} skipped: ${result.failed[0]!.error}${result.failed.length > 1 ? ' (and more)' : ''}`,
            );
          }
          onDone(result);
          close();
        },
      },
    );
  };

  return (
    <AlertDialog open={decision !== null} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {removing ? `Remove ${n} item${n === 1 ? '' : 's'}?` : `Dismiss reports on ${n} case${n === 1 ? '' : 's'}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {removing
              ? 'Each item is taken down, its authors are notified and every open report on it is marked actioned. Authors can appeal.'
              : 'Every open report on these cases is closed with no action. Auto-hidden items become visible again.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {removing && (
          <div className="space-y-2">
            <Label htmlFor="bulk-reason">Reason</Label>
            <ReasonSelect id="bulk-reason" value={reason} onChange={setReason} />
          </div>
        )}
        <NoteField id="bulk-note" label="Note (optional, moderators only)" value={note} onChange={setNote} />
        {bulk.error && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(bulk.error, 'Bulk action failed')}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={bulk.isPending}>Cancel</AlertDialogCancel>
          <Button
            variant={removing ? 'destructive' : 'default'}
            disabled={bulk.isPending || (removing && !reason)}
            onClick={submit}
          >
            {bulk.isPending ? 'Working…' : removing ? `Remove ${n}` : `Dismiss ${n}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
