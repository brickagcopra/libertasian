'use client';

import { useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircleIcon, CheckCircle2Icon } from 'lucide-react';

import { useReviewArtifact } from '../hooks/use-derivatives-admin';

interface ArtifactReviewActionsProps {
  artifactId: string;
  reviewStatus: string;
  visibility: string;
  hasDisclaimer?: boolean;
}

export function ArtifactReviewActions({
  artifactId,
  reviewStatus,
  visibility,
  hasDisclaimer = true,
}: ArtifactReviewActionsProps) {
  const [notes, setNotes] = useState('');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const review = useReviewArtifact();

  const disabled = !hasDisclaimer;

  const runReview = (verdict: 'approve' | 'reject' | 'needs_revision') => {
    review.mutate(
      { id: artifactId, verdict, notes: notes.trim() || undefined },
      {
        onSuccess: (data) => {
          setSuccessMsg(
            `Review recorded: ${data.newStatus}` +
              (data.newVisibility === 'public_editorial' ? ' (published)' : '') +
              (data.subjectsCopiedFromParent > 0
                ? ` — ${data.subjectsCopiedFromParent} subject tag(s) inherited from parent`
                : ''),
          );
          setNotes('');
        },
      },
    );
  };

  return (
    <div className="space-y-2 rounded-md border bg-gray-50 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
        <span className="font-medium">Review</span>
        <span className="rounded bg-white px-2 py-0.5 font-medium text-gray-700">
          status: {reviewStatus.replace(/_/g, ' ')}
        </span>
        <span className="rounded bg-white px-2 py-0.5 font-medium text-gray-700">
          visibility: {visibility.replace(/_/g, ' ')}
        </span>
      </div>

      {disabled && (
        <Alert variant="destructive" className="py-2">
          <AlertCircleIcon className="size-4" />
          <AlertDescription className="text-xs">
            Missing content disclaimer — cannot approve. Contact data platform team.
          </AlertDescription>
        </Alert>
      )}

      {successMsg && (
        <Alert className="border-green-200 bg-green-50 py-2">
          <CheckCircle2Icon className="size-4 text-green-700" />
          <AlertDescription className="text-xs text-green-800">{successMsg}</AlertDescription>
        </Alert>
      )}

      {review.error && (
        <Alert variant="destructive" className="py-2">
          <AlertCircleIcon className="size-4" />
          <AlertDescription className="text-xs">
            {review.error instanceof Error ? review.error.message : 'Review failed'}
          </AlertDescription>
        </Alert>
      )}

      <Textarea
        placeholder="Optional review notes (max 5000 chars)..."
        value={notes}
        onChange={(e) => setNotes(e.target.value.slice(0, 5000))}
        className="text-xs"
        rows={2}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="default"
          className="bg-green-600 hover:bg-green-700"
          onClick={() => runReview('approve')}
          disabled={disabled || review.isPending}
        >
          {review.isPending && review.variables?.verdict === 'approve' ? 'Approving...' : 'Approve'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => runReview('needs_revision')}
          disabled={disabled || review.isPending}
        >
          Needs revision
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => runReview('reject')}
          disabled={disabled || review.isPending}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
