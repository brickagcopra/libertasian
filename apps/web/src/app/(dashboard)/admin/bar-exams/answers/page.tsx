'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Sparkles } from 'lucide-react';

import {
  useApproveBarExamAnswer,
  useBarExamAnswerDetail,
  useBarExamAnswers,
  useDispatchAnswerGeneration,
  useRejectBarExamAnswer,
  type ReviewStatus,
} from '@/features/admin/hooks/use-admin-bar-exam-answers';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AdminCardSkeleton, AdminListSkeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

import {
  DispatchGenerationDialog,
  type DispatchFormValue,
} from './dispatch-generation-dialog';

const STATUS_FILTERS: { value: ReviewStatus | 'all'; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

export default function BarExamAnswersAdminPage() {
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | 'all'>(
    'pending',
  );
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);

  const queryParams =
    statusFilter === 'all'
      ? { cursor }
      : { reviewStatus: statusFilter, cursor };
  const { data, isLoading, error } = useBarExamAnswers(queryParams);

  const dispatch = useDispatchAnswerGeneration();

  const handleDispatch = (value: DispatchFormValue) => {
    dispatch.mutate(value, {
      onSuccess: () => {
        setDispatchOpen(false);
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Bar Exam Answers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review AI-generated ALAC answers for past bar exam questions.
            Approved answers become eligible for public display (Phase 3b).
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setDispatchOpen(true)}>
            <Sparkles className="mr-1.5 h-4 w-4" />
            Generate answers
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/bar-exams">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Sittings
            </Link>
          </Button>
        </div>
      </div>

      {dispatch.isSuccess && (
        <Alert>
          <AlertDescription className="text-green-700">
            Dispatched {dispatch.data.questionCount} question
            {dispatch.data.questionCount === 1 ? '' : 's'} to the worker (task{' '}
            <code className="text-xs">{dispatch.data.taskId}</code>).
            {dispatch.data.truncated &&
              ' The request was truncated to the 50-question cap.'}{' '}
            New answers land here as Pending — refresh in a moment.
          </AlertDescription>
        </Alert>
      )}

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={statusFilter === f.value ? 'default' : 'outline'}
            onClick={() => {
              setStatusFilter(f.value);
              setCursor(undefined);
            }}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : 'Failed to load answers'}
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <AdminListSkeleton count={5} />
      ) : data && data.items.length > 0 ? (
        <div className="space-y-3">
          {data.items.map((row) => (
            <AnswerRow
              key={row.id}
              row={row}
              onView={() => setSelectedId(row.id)}
            />
          ))}

          {data.meta.hasNext && data.meta.nextCursor && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => setCursor(data.meta.nextCursor ?? undefined)}
              >
                Load More
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No answers in this view.
        </p>
      )}

      <DispatchGenerationDialog
        open={dispatchOpen}
        isDispatching={dispatch.isPending}
        errorMessage={
          dispatch.isError
            ? dispatch.error instanceof Error
              ? dispatch.error.message
              : 'Dispatch failed'
            : null
        }
        onCancel={() => setDispatchOpen(false)}
        onDispatch={handleDispatch}
      />

      <AnswerDetailDrawer
        id={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

// ---- Row ----

function AnswerRow({
  row,
  onView,
}: {
  row: ReturnType<typeof useBarExamAnswers>['data'] extends
    | { items: infer T }
    | undefined
    ? T extends Array<infer U>
      ? U
      : never
    : never;
  onView: () => void;
}) {
  const approve = useApproveBarExamAnswer();
  const reject = useRejectBarExamAnswer();
  const isPending = row.reviewStatus === 'pending';

  const statusColor: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-muted text-muted-foreground',
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <button onClick={onView} className="flex-1 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={statusColor[row.reviewStatus] ?? ''}>
                {row.reviewStatus}
              </Badge>
              <Badge variant="outline">
                {row.question.sittingYear}
                {row.question.subjectStudyCode
                  ? ` · ${row.question.subjectStudyCode}`
                  : ''}
              </Badge>
              <Badge variant="outline">Q{row.question.questionNumber}</Badge>
              {row.confidence !== null && (
                <Badge variant="outline">
                  conf {(row.confidence * 100).toFixed(0)}%
                </Badge>
              )}
              {row.modelRun && (
                <span className="text-xs text-muted-foreground">
                  {row.modelRun.modelName}
                </span>
              )}
            </div>
            <p className="mt-2 text-sm line-clamp-2">
              {row.question.excerpt}
            </p>
          </button>
        </div>

        {isPending && (
          <>
            <Separator className="my-3" />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={onView}>
                View
              </Button>
              <Button
                size="sm"
                onClick={() => approve.mutate(row.id)}
                disabled={approve.isPending}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => reject.mutate({ id: row.id })}
                disabled={reject.isPending}
              >
                Reject
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Detail drawer ----

function AnswerDetailDrawer({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useBarExamAnswerDetail(id);
  const approve = useApproveBarExamAnswer();
  const reject = useRejectBarExamAnswer();

  if (!id) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40">
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-background p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Answer detail</h2>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        {isLoading ? (
          <div className="mt-4">
            <AdminCardSkeleton />
          </div>
        ) : data ? (
          <div className="mt-4 space-y-5">
            <section>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Question — {data.question.sittingYear}{' '}
                {data.question.subjectStudyCode ?? ''} · Q
                {data.question.questionNumber}
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm">
                {data.question.questionText}
              </p>
            </section>

            <Separator />

            <section className="space-y-3 text-sm">
              <AlacBlock label="Answer" body={data.structuredAnswerJson?.answer} />
              <AlacBlock label="Law" body={data.structuredAnswerJson?.law} />
              <AlacBlock
                label="Analysis"
                body={data.structuredAnswerJson?.analysis}
              />
              <AlacBlock
                label="Conclusion"
                body={data.structuredAnswerJson?.conclusion}
              />
            </section>

            {data.reviewStatus === 'pending' && (
              <div className="flex gap-2">
                <Button
                  onClick={() => approve.mutate(data.id, { onSuccess: onClose })}
                  disabled={approve.isPending}
                >
                  Approve
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    reject.mutate({ id: data.id }, { onSuccess: onClose })
                  }
                  disabled={reject.isPending}
                >
                  Reject
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Answer not found.</p>
        )}
      </div>
    </div>
  );
}

function AlacBlock({ label, body }: { label: string; body?: string }) {
  if (!body) return null;
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h4>
      <p className="mt-1 whitespace-pre-wrap">{body}</p>
    </div>
  );
}
