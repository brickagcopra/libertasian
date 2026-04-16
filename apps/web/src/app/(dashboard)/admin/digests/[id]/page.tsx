'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, X, RotateCcw } from 'lucide-react';

import { useAdminDigest, useSubmitReview } from '@/features/admin/hooks/use-admin';
import { DigestContentPanel } from '@/features/digests/components/digest-content-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { AdminCardSkeleton } from '@/components/ui/skeleton';
import { useQueryClient } from '@tanstack/react-query';

const REVIEW_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  ai_generated: 'bg-blue-100 text-blue-700',
  needs_human_review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function AdminDigestDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = params?.['id'] ?? '';

  const { data: digest, isLoading, error } = useAdminDigest(id);
  const submitReview = useSubmitReview();

  const [notes, setNotes] = useState('');
  const [truthfulness, setTruthfulness] = useState(80);
  const [completeness, setCompleteness] = useState(80);
  const [citationAccuracy, setCitationAccuracy] = useState(80);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleReview = async (verdict: string) => {
    try {
      const result = await submitReview.mutateAsync({
        id,
        verdict,
        notes: notes || undefined,
        truthfulness: truthfulness / 100,
        completeness: completeness / 100,
        citationAccuracy: citationAccuracy / 100,
      });
      setActionMsg({ type: 'success', text: `${result.verdict} — new status: ${result.newStatus}` });
      queryClient.invalidateQueries({ queryKey: ['admin', 'digest', id] });
      // Navigate back after a brief delay so user sees the success message
      setTimeout(() => router.push('/admin/derivatives'), 1500);
    } catch {
      setActionMsg({ type: 'error', text: `Failed to submit ${verdict} review.` });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <AdminCardSkeleton />
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <AdminCardSkeleton />
            <AdminCardSkeleton />
          </div>
          <div className="space-y-4">
            <AdminCardSkeleton />
            <AdminCardSkeleton />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/derivatives">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Derivatives
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : 'Failed to load digest'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!digest) return null;

  const confidenceColor =
    digest.confidenceScore !== null && digest.confidenceScore >= 0.7
      ? 'bg-green-100 text-green-700'
      : digest.confidenceScore !== null && digest.confidenceScore >= 0.4
        ? 'bg-yellow-100 text-yellow-700'
        : 'bg-red-100 text-red-700';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{digest.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{digest.digestType}</Badge>
            <Badge variant="secondary">{digest.sourceOrigin.replace(/_/g, ' ')}</Badge>
            <Badge className={REVIEW_STATUS_COLORS[digest.reviewStatus] ?? 'bg-gray-100 text-gray-700'}>
              {digest.reviewStatus.replace(/_/g, ' ')}
            </Badge>
            <Badge variant="secondary">{digest.visibility.replace(/_/g, ' ')}</Badge>
            {digest.confidenceScore !== null && (
              <Badge className={confidenceColor}>
                {(digest.confidenceScore * 100).toFixed(0)}% confidence
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Created {new Date(digest.createdAt).toLocaleString()}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/derivatives">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Derivatives
          </Link>
        </Button>
      </div>

      {/* Action message */}
      {actionMsg && (
        <Alert variant={actionMsg.type === 'error' ? 'destructive' : 'default'}>
          <AlertDescription className={actionMsg.type === 'success' ? 'text-green-700' : ''}>
            {actionMsg.text}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Digest Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Digest Content Panel */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Digest Content</CardTitle>
            </CardHeader>
            <CardContent>
              <DigestContentPanel
                digest={digest}
                citedAuthoritiesJson={digest.citedAuthoritiesJson}
                showHeader={false}
              />
            </CardContent>
          </Card>

          {/* Review History */}
          {digest.reviews.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Review History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {digest.reviews.map((review) => (
                    <div key={review.id} className="rounded-md border p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge
                            className={
                              review.verdict === 'approved'
                                ? 'bg-green-100 text-green-700'
                                : review.verdict === 'rejected'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-yellow-100 text-yellow-700'
                            }
                          >
                            {review.verdict}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            by {review.reviewer?.fullName ?? 'Unknown'}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(review.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {(review.truthfulnessScore !== null ||
                        review.completenessScore !== null ||
                        review.citationAccuracyScore !== null) && (
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          {review.truthfulnessScore !== null && (
                            <span>Truthfulness: {(review.truthfulnessScore * 100).toFixed(0)}%</span>
                          )}
                          {review.completenessScore !== null && (
                            <span>Completeness: {(review.completenessScore * 100).toFixed(0)}%</span>
                          )}
                          {review.citationAccuracyScore !== null && (
                            <span>Citation Accuracy: {(review.citationAccuracyScore * 100).toFixed(0)}%</span>
                          )}
                        </div>
                      )}
                      {review.notes && (
                        <p className="mt-2 text-sm text-gray-700" style={{ whiteSpace: 'pre-line' }}>
                          {review.notes}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Sidebar */}
        <div className="space-y-6">
          {/* Source Document */}
          {digest.legalDocument && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Source Document</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="font-medium">{digest.legalDocument.title}</p>
                {digest.legalDocument.grNo && (
                  <p className="text-muted-foreground">G.R. No. {digest.legalDocument.grNo}</p>
                )}
                {digest.legalDocument.citationText && (
                  <p className="text-muted-foreground">{digest.legalDocument.citationText}</p>
                )}
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {digest.legalDocument.court && <span>{digest.legalDocument.court}</span>}
                  {digest.legalDocument.ponente && (
                    <span>&middot; {digest.legalDocument.ponente}</span>
                  )}
                  {digest.legalDocument.decisionDate && (
                    <span>&middot; {new Date(digest.legalDocument.decisionDate).toLocaleDateString()}</span>
                  )}
                </div>
                <Badge variant="secondary" className="mt-1">
                  {digest.legalDocument.documentType.replace(/_/g, ' ')}
                </Badge>
              </CardContent>
            </Card>
          )}

          {/* Generation Job Info */}
          {digest.derivativeGenerationJob && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Generation Job</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="text-muted-foreground">
                  Type: <span className="text-foreground">{digest.derivativeGenerationJob.derivativeType}</span>
                </p>
                {digest.derivativeGenerationJob.modelName && (
                  <p className="text-muted-foreground">
                    Model: <span className="text-foreground">{digest.derivativeGenerationJob.modelName}</span>
                  </p>
                )}
                {digest.derivativeGenerationJob.promptTemplateVersion && (
                  <p className="text-muted-foreground">
                    Prompt: <span className="text-foreground">v{digest.derivativeGenerationJob.promptTemplateVersion}</span>
                  </p>
                )}
                <p className="text-muted-foreground">
                  Tokens: <span className="text-foreground">
                    {digest.derivativeGenerationJob.tokensIn.toLocaleString()} in / {digest.derivativeGenerationJob.tokensOut.toLocaleString()} out
                  </span>
                </p>
                <p className="text-muted-foreground">
                  Cost: <span className="text-foreground">${digest.derivativeGenerationJob.estimatedCostUsd.toFixed(4)}</span>
                </p>
                {digest.derivativeGenerationJob.startedAt && (
                  <p className="text-xs text-muted-foreground">
                    Started: {new Date(digest.derivativeGenerationJob.startedAt).toLocaleString()}
                  </p>
                )}
                {digest.derivativeGenerationJob.finishedAt && (
                  <p className="text-xs text-muted-foreground">
                    Finished: {new Date(digest.derivativeGenerationJob.finishedAt).toLocaleString()}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Related Counts */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Related</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="text-muted-foreground">
                Doctrine Extracts: <span className="font-medium text-foreground">{digest._count.doctrineExtracts}</span>
              </p>
              <p className="text-muted-foreground">
                Editorial Flags: <span className="font-medium text-foreground">{digest._count.editorialFlags}</span>
              </p>
              <p className="text-muted-foreground">
                Reviews: <span className="font-medium text-foreground">{digest.reviews.length}</span>
              </p>
            </CardContent>
          </Card>

          {/* Review Action Panel */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Submit Review</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="review-notes" className="text-sm">
                  Notes (optional)
                </Label>
                <Textarea
                  id="review-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="mt-1"
                  placeholder="Add notes about this review..."
                />
              </div>

              <div className="space-y-3 rounded-md border p-3">
                <p className="text-xs font-semibold text-muted-foreground">Review Scores</p>
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">Truthfulness: {truthfulness}%</Label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={truthfulness}
                      onChange={(e) => setTruthfulness(Number(e.target.value))}
                      className="mt-1 w-full"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Completeness: {completeness}%</Label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={completeness}
                      onChange={(e) => setCompleteness(Number(e.target.value))}
                      className="mt-1 w-full"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Citation Accuracy: {citationAccuracy}%</Label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={citationAccuracy}
                      onChange={(e) => setCitationAccuracy(Number(e.target.value))}
                      className="mt-1 w-full"
                    />
                  </div>
                </div>
              </div>

              <Separator />

              <div className="flex flex-col gap-2">
                <Button
                  onClick={() => handleReview('approved')}
                  disabled={submitReview.isPending}
                  className="w-full bg-green-600 hover:bg-green-700"
                >
                  <Check className="mr-1.5 h-4 w-4" />
                  {submitReview.isPending ? 'Submitting...' : 'Approve'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleReview('revision_requested')}
                  disabled={submitReview.isPending}
                  className="w-full border-yellow-400 text-yellow-700 hover:bg-yellow-50"
                >
                  <RotateCcw className="mr-1.5 h-4 w-4" />
                  Request Revision
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleReview('rejected')}
                  disabled={submitReview.isPending}
                  className="w-full"
                >
                  <X className="mr-1.5 h-4 w-4" />
                  Reject
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
