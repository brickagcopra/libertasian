'use client';

import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { FlagIcon } from 'lucide-react';

import { useCreateFlag } from '../hooks/use-community-flags';
import type { FlagEntityType, FlagReason } from '../types';

const FLAG_REASONS: Array<{ value: FlagReason; label: string }> = [
  { value: 'spam', label: 'Spam' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'copyright', label: 'Copyright violation' },
  { value: 'inaccurate', label: 'Inaccurate information' },
  { value: 'other', label: 'Other' },
];

interface FlagDialogProps {
  entityType: FlagEntityType;
  entityId: string;
}

export function FlagDialog({ entityType, entityId }: FlagDialogProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<FlagReason | ''>('');
  const [details, setDetails] = useState('');
  const createFlag = useCreateFlag();

  const handleSubmit = useCallback(() => {
    if (!reason) return;
    createFlag.mutate(
      {
        entityType,
        entityId,
        reason,
        details: details.trim() || undefined,
      },
      {
        onSuccess: () => {
          setOpen(false);
          setReason('');
          setDetails('');
        },
      },
    );
  }, [entityType, entityId, reason, details, createFlag]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
          <FlagIcon className="size-3.5" />
          Report
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report Content</DialogTitle>
          <DialogDescription>
            Help us keep the community safe. Select a reason for reporting this
            content.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>Reason</Label>
            <Select
              value={reason}
              onValueChange={(v) => setReason(v as FlagReason)}
            >
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {FLAG_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Details (optional)</Label>
            <Textarea
              className="mt-1.5"
              placeholder="Provide additional context..."
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={2000}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={!reason || createFlag.isPending}
          >
            {createFlag.isPending ? 'Submitting...' : 'Submit Report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
