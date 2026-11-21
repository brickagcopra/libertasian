'use client';

import { useMemo, useState } from 'react';
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
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { AdminListSkeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

import { useModerationSanctions, useRevokeSanction } from '../hooks/use-moderation';
import { formatDateTime } from '../sla';
import { REASON_LABELS, type ModerationSanction } from '../types';
import { SanctionTypeBadge } from './moderation-badges';

function endsAtLabel(s: ModerationSanction): string {
  if (s.type === 'warning') return '—';
  return s.endsAt ? formatDateTime(s.endsAt) : 'Permanent';
}

export function RevokeSanctionDialog({
  sanction,
  onClose,
}: {
  sanction: ModerationSanction | null;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const revoke = useRevokeSanction();

  const close = () => {
    setNote('');
    revoke.reset();
    onClose();
  };

  const submit = () => {
    if (!sanction) return;
    const trimmed = note.trim();
    revoke.mutate(
      { sanctionId: sanction.id, input: trimmed ? { note: trimmed } : {} },
      {
        onSuccess: () => {
          toast.success(`Sanction on ${sanction.user.fullName} revoked`);
          close();
        },
      },
    );
  };

  return (
    <AlertDialog open={sanction !== null} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke this sanction?</AlertDialogTitle>
          <AlertDialogDescription>
            {sanction
              ? `${sanction.user.fullName}'s ${sanction.type} will end now and any restriction it imposes is lifted.`
              : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="revoke-note">Note (optional)</Label>
          <Textarea
            id="revoke-note"
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {revoke.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {revoke.error instanceof Error ? revoke.error.message : 'Failed to revoke'}
            </AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={revoke.isPending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={revoke.isPending} onClick={submit}>
            {revoke.isPending ? 'Revoking…' : 'Revoke'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SanctionsList() {
  const [includePast, setIncludePast] = useState(false);
  const [revoking, setRevoking] = useState<ModerationSanction | null>(null);
  const { data, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useModerationSanctions(!includePast);

  const sanctions = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Checkbox
          id="include-past"
          checked={includePast}
          onCheckedChange={(v) => setIncludePast(v === true)}
        />
        <Label htmlFor="include-past">Include past sanctions</Label>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : 'Failed to load sanctions'}
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <AdminListSkeleton />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Ends</TableHead>
                  <TableHead>Issued by</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sanctions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      {includePast ? 'No sanctions yet.' : 'No active sanctions.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  sanctions.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.user.fullName}</TableCell>
                      <TableCell>
                        <SanctionTypeBadge type={s.type} />
                      </TableCell>
                      <TableCell className="text-sm">
                        {REASON_LABELS[s.reason] ?? s.reason}
                        {s.note && (
                          <p className="max-w-[260px] truncate text-xs text-muted-foreground" title={s.note}>
                            {s.note}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateTime(s.startsAt)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{endsAtLabel(s)}</TableCell>
                      <TableCell className="text-sm">{s.issuedBy?.fullName ?? '—'}</TableCell>
                      <TableCell className="text-right">
                        {s.revokedAt ? (
                          <span className="text-xs text-muted-foreground">
                            Revoked {formatDateTime(s.revokedAt)}
                            {s.revokedBy ? ` by ${s.revokedBy.fullName}` : ''}
                          </span>
                        ) : s.active ? (
                          <Button size="sm" variant="outline" onClick={() => setRevoking(s)}>
                            Revoke
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}

      <RevokeSanctionDialog sanction={revoking} onClose={() => setRevoking(null)} />
    </div>
  );
}
