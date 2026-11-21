'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { useCreateSanction, useResolveCase, useRestoreContent } from '../hooks/use-moderation';
import {
  REASON_LABELS,
  SUSPENSION_DAYS,
  TARGET_TYPE_LABELS,
  type CreateSanctionInput,
  type ModerationReason,
  type ModerationTargetType,
  type SanctionType,
  type SuspensionDays,
} from '../types';

const REASONS = Object.keys(REASON_LABELS) as ModerationReason[];
const NOTE_MAX = 1000;

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function ReasonSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: ModerationReason | '';
  onChange: (r: ModerationReason) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ModerationReason)}>
      <SelectTrigger id={id} className="w-full" aria-label="Reason">
        <SelectValue placeholder="Choose a reason" />
      </SelectTrigger>
      <SelectContent>
        {REASONS.map((r) => (
          <SelectItem key={r} value={r}>
            {REASON_LABELS[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NoteField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        maxLength={NOTE_MAX}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function CheckField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  );
}

interface TargetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: ModerationTargetType;
  targetId: string;
}

// ---- Dismiss ----

export function DismissDialog({
  open,
  onOpenChange,
  targetType,
  targetId,
  autoHidden,
  reportCount,
}: TargetProps & { autoHidden: boolean; reportCount: number }) {
  const [note, setNote] = useState('');
  const resolve = useResolveCase();

  const change = (next: boolean) => {
    if (!next) {
      setNote('');
      resolve.reset();
    }
    onOpenChange(next);
  };

  const submit = () => {
    const trimmed = note.trim();
    resolve.mutate(
      {
        targetType,
        targetId,
        input: { decision: 'dismiss', ...(trimmed ? { note: trimmed } : {}) },
      },
      {
        onSuccess: () => {
          toast.success('Reports dismissed');
          change(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dismiss reports</DialogTitle>
          <DialogDescription>
            Close {reportCount} open report{reportCount === 1 ? '' : 's'} without acting on the
            content.
          </DialogDescription>
        </DialogHeader>
        {autoHidden && (
          <Alert>
            <AlertDescription>
              This content was auto-hidden after reaching the report threshold. Dismissing makes it
              visible again.
            </AlertDescription>
          </Alert>
        )}
        <NoteField id="dismiss-note" label="Note (optional)" value={note} onChange={setNote} />
        {resolve.error && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(resolve.error, 'Failed to dismiss')}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => change(false)} disabled={resolve.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={resolve.isPending}>
            {resolve.isPending ? 'Dismissing…' : 'Dismiss reports'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Remove ----

export function RemoveContentDialog({ open, onOpenChange, targetType, targetId }: TargetProps) {
  const [reason, setReason] = useState<ModerationReason | ''>('');
  const [note, setNote] = useState('');
  const [notifyAuthor, setNotifyAuthor] = useState(true);
  const resolve = useResolveCase();

  const change = (next: boolean) => {
    if (!next) {
      setReason('');
      setNote('');
      setNotifyAuthor(true);
      resolve.reset();
    }
    onOpenChange(next);
  };

  const submit = () => {
    if (!reason) return;
    const trimmed = note.trim();
    resolve.mutate(
      {
        targetType,
        targetId,
        input: {
          decision: 'remove',
          reason,
          notifyAuthor,
          ...(trimmed ? { note: trimmed } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success(`${TARGET_TYPE_LABELS[targetType]} removed`);
          change(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove content</DialogTitle>
          <DialogDescription>
            The {TARGET_TYPE_LABELS[targetType].toLowerCase()} is hidden from everyone and all open
            reports are resolved as actioned. You can restore it later.
          </DialogDescription>
        </DialogHeader>
        {targetType === 'digest' && (
          <Alert>
            <AlertDescription>
              Removing a digest unpublishes it from the community listing.
            </AlertDescription>
          </Alert>
        )}
        <div className="space-y-2">
          <Label htmlFor="remove-reason">Reason</Label>
          <ReasonSelect id="remove-reason" value={reason} onChange={setReason} />
        </div>
        <NoteField id="remove-note" label="Note (optional)" value={note} onChange={setNote} />
        <CheckField
          id="remove-notify"
          label="Notify author"
          checked={notifyAuthor}
          onChange={setNotifyAuthor}
        />
        {resolve.error && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(resolve.error, 'Failed to remove')}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => change(false)} disabled={resolve.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={!reason || resolve.isPending}>
            {resolve.isPending ? 'Removing…' : 'Remove content'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Restore ----

export function RestoreDialog({ open, onOpenChange, targetType, targetId }: TargetProps) {
  const [note, setNote] = useState('');
  const restore = useRestoreContent();

  const change = (next: boolean) => {
    if (!next) {
      setNote('');
      restore.reset();
    }
    onOpenChange(next);
  };

  const submit = () => {
    const trimmed = note.trim();
    restore.mutate(
      { targetType, targetId, input: trimmed ? { note: trimmed } : {} },
      {
        onSuccess: () => {
          toast.success(`${TARGET_TYPE_LABELS[targetType]} restored`);
          change(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore content</DialogTitle>
          <DialogDescription>
            Make this {TARGET_TYPE_LABELS[targetType].toLowerCase()} visible again.
          </DialogDescription>
        </DialogHeader>
        <NoteField id="restore-note" label="Note (optional)" value={note} onChange={setNote} />
        {restore.error && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(restore.error, 'Failed to restore')}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => change(false)} disabled={restore.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={restore.isPending}>
            {restore.isPending ? 'Restoring…' : 'Restore'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Sanction ----

const SANCTION_COPY: Record<SanctionType, { title: string; description: string; submit: string }> = {
  warning: {
    title: 'Warn user',
    description: 'A formal warning is recorded on their account. It does not restrict them.',
    submit: 'Send warning',
  },
  suspension: {
    title: 'Suspend user',
    description: 'They cannot post, comment or share to the community until the suspension ends.',
    submit: 'Suspend',
  },
  ban: {
    title: 'Ban from community',
    description: 'They permanently lose the ability to post, comment or share to the community.',
    submit: 'Ban',
  },
};

export function SanctionDialog({
  type,
  userId,
  userName,
  onClose,
}: {
  /** null = closed. */
  type: SanctionType | null;
  userId: string;
  userName: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ModerationReason | ''>('');
  const [note, setNote] = useState('');
  const [durationDays, setDurationDays] = useState<SuspensionDays>(7);
  const [removeContent, setRemoveContent] = useState(false);
  const [notifyUser, setNotifyUser] = useState(true);
  const create = useCreateSanction();

  const close = () => {
    setReason('');
    setNote('');
    setDurationDays(7);
    setRemoveContent(false);
    setNotifyUser(true);
    create.reset();
    onClose();
  };

  const submit = () => {
    if (!type || !reason) return;
    const trimmed = note.trim();
    const input: CreateSanctionInput = {
      type,
      reason,
      notifyUser,
      ...(trimmed ? { note: trimmed } : {}),
      ...(type === 'suspension' ? { durationDays } : {}),
      ...(type === 'ban' ? { removeContent } : {}),
    };
    create.mutate(
      { userId, input },
      {
        onSuccess: () => {
          toast.success(
            type === 'warning'
              ? `${userName} warned`
              : type === 'suspension'
                ? `${userName} suspended for ${durationDays} day${durationDays === 1 ? '' : 's'}`
                : `${userName} banned`,
          );
          close();
        },
      },
    );
  };

  const copy = type ? SANCTION_COPY[type] : null;

  return (
    <Dialog open={type !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy?.title}</DialogTitle>
          <DialogDescription>
            {userName}: {copy?.description}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="sanction-reason">Reason</Label>
          <ReasonSelect id="sanction-reason" value={reason} onChange={setReason} />
        </div>
        {type === 'suspension' && (
          <div className="space-y-2">
            <Label htmlFor="sanction-duration">Duration</Label>
            <Select
              value={String(durationDays)}
              onValueChange={(v) => setDurationDays(Number(v) as SuspensionDays)}
            >
              <SelectTrigger id="sanction-duration" className="w-full" aria-label="Duration">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUSPENSION_DAYS.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} day{d === 1 ? '' : 's'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <NoteField id="sanction-note" label="Note (optional)" value={note} onChange={setNote} />
        {type === 'ban' && (
          <CheckField
            id="sanction-remove-content"
            label="Also remove all their published posts and comments"
            checked={removeContent}
            onChange={setRemoveContent}
          />
        )}
        <CheckField
          id="sanction-notify"
          label="Notify user"
          checked={notifyUser}
          onChange={setNotifyUser}
        />
        {create.error && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(create.error, 'Failed to apply sanction')}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            variant={type === 'warning' ? 'default' : 'destructive'}
            onClick={submit}
            disabled={!reason || create.isPending}
          >
            {create.isPending ? 'Saving…' : copy?.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
