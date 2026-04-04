'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useReportPost } from '../hooks/use-feed-interactions';
import type { FeedReportReason } from '@libertasian/types';

interface ReportDialogProps {
  postId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const REPORT_REASONS: { value: FeedReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'inappropriate', label: 'Inappropriate Content' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'misinformation', label: 'Misinformation' },
  { value: 'copyright', label: 'Copyright Violation' },
  { value: 'other', label: 'Other' },
];

export function ReportDialog({ postId, open, onOpenChange }: ReportDialogProps) {
  const [reason, setReason] = useState<FeedReportReason | ''>('');
  const [details, setDetails] = useState('');
  const reportMutation = useReportPost();

  const handleSubmit = () => {
    if (!reason) return;
    reportMutation.mutate(
      { postId, reason, details: details.trim() || undefined },
      {
        onSuccess: () => {
          setReason('');
          setDetails('');
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report Post</DialogTitle>
          <DialogDescription>
            Help us understand what&apos;s wrong with this post.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Reason</label>
            <Select value={reason} onValueChange={(v) => setReason(v as FeedReportReason)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {REPORT_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Details (optional)</label>
            <Textarea
              placeholder="Provide additional context..."
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={1000}
              rows={3}
            />
          </div>

          {reportMutation.error && (
            <Alert variant="destructive">
              <AlertDescription>
                {(reportMutation.error as Error).message || 'Failed to submit report.'}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!reason || reportMutation.isPending}
            >
              {reportMutation.isPending ? 'Submitting...' : 'Submit Report'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
