'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, X } from 'lucide-react';

import {
  useClassificationReviewQueue,
  useClassificationStats,
  useConfirmClassification,
  useRejectClassification,
} from '@/features/admin/hooks/use-admin';
import { AdminCardSkeleton, AdminListSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const TIER_COLORS: Record<string, string> = {
  needs_review: 'bg-yellow-100 text-yellow-800',
  auto: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};

export default function ClassificationPage() {
  const [statusFilter, setStatusFilter] = useState<string>('needs_review');
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  // TODO(admin-ui-display-bugs): The /admin/classification/stats endpoint
  // counts `legal_document_tag_map.review_status`, but the live data is in
  // `document_subject_assignments` (5,517 ai + 336 manual). Fix requires a
  // backend change — out of scope for this frontend-only PR. Tracked
  // separately; counters will read 0 until the BE bucket query is rewired
  // to bucket by classified_by/manual_override.
  const { data: stats, isLoading: statsLoading } = useClassificationStats();
  const { data, isLoading } = useClassificationReviewQueue({
    reviewStatus: statusFilter || undefined,
    cursor,
  });
  const confirmMutation = useConfirmClassification();
  const rejectMutation = useRejectClassification();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/admin"
            className="mb-2 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to Admin
          </Link>
          <h1 className="text-2xl font-bold">Classification Review</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review and confirm document subject classifications
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      {statsLoading ? (
        <AdminCardSkeleton />
      ) : stats ? (
        <div className="grid gap-4 sm:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Needs Review
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-yellow-600">{stats.needsReview ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Auto-Classified
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-blue-600">{stats.auto ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Confirmed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-green-600">{stats.confirmed ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Rejected
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-600">{stats.rejected ?? 0}</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Separator />

      {/* Filters */}
      <div className="flex items-center gap-4">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCursor(undefined); }}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Review Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="needs_review">Needs Review</SelectItem>
            <SelectItem value="auto">Auto-Classified</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Document List */}
      {isLoading ? (
        <AdminListSkeleton />
      ) : data?.items && data.items.length > 0 ? (
        <div className="space-y-3">
          {data.items.map((doc) => (
            <Card key={doc.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-medium">{doc.title}</h3>
                    <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                      <span>{doc.documentType}</span>
                      {doc.court && <span>| {doc.court}</span>}
                      {doc.grNo && <span>| {doc.grNo}</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {doc.tagMaps.map((tagMap) => (
                        <div key={tagMap.id} className="flex items-center gap-1">
                          <Badge
                            variant="outline"
                            className={tagMap.isPrimary ? 'border-primary' : ''}
                          >
                            {tagMap.tag.name}
                            {tagMap.isPrimary && ' (Primary)'}
                            {tagMap.confidence !== null && (
                              <span className="ml-1 text-xs opacity-70">
                                {Math.round(tagMap.confidence * 100)}%
                              </span>
                            )}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className={TIER_COLORS[tagMap.reviewStatus] || ''}
                          >
                            {tagMap.reviewStatus}
                          </Badge>
                          {tagMap.reviewStatus === 'needs_review' && (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-green-600 hover:text-green-700"
                                onClick={() =>
                                  confirmMutation.mutate({
                                    documentId: doc.id,
                                    tagId: tagMap.tag.id,
                                  })
                                }
                                disabled={confirmMutation.isPending}
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                                onClick={() =>
                                  rejectMutation.mutate({
                                    documentId: doc.id,
                                    tagId: tagMap.tag.id,
                                  })
                                }
                                disabled={rejectMutation.isPending}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {/* Pagination */}
          {data.meta?.hasNext && (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={() => setCursor(data.meta?.nextCursor)}
              >
                Load More
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No documents found matching the current filter.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
