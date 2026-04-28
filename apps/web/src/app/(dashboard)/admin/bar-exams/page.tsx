'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-states/empty-state';
import { AnimatedAlert } from '@/components/ui/animated-alert';
import { motion, useReducedMotion } from 'framer-motion';
import { motionTokens } from '@/lib/motion';

import { BackfillDialog, type BackfillPlan } from './backfill-dialog';

interface BarExamSittingRow {
  id: string;
  year: number;
  part: string | null;
  subjectStudyCode: string | null;
  subjectBarAdminCode: string | null;
  chairperson: string | null;
  sourceUrl: string | null;
  sourceDocumentId: string | null;
  questionCount: number;
  lastIngestedAt: string | null;
}

interface DispatchedTaskResp {
  taskId: string;
  taskName: string;
  kwargs: Record<string, unknown>;
}

interface DispatchListResult {
  dispatched: { year: number; subjectSlug: string; taskId: string }[];
  skipped: { year: number; subjectSlug: string; reason: string }[];
  totalDispatched: number;
  totalSkipped: number;
}

type DispatchResponse =
  | { mode: 'single_sitting' | 'single_year' | 'backfill_all'; task: DispatchedTaskResp }
  | { mode: 'sittings_list'; result: DispatchListResult };

const SITTINGS_QUERY_KEY = ['admin', 'bar-exams', 'sittings'];
const PLAN_QUERY_KEY = ['admin', 'bar-exams', 'backfill-plan'];

export default function AdminBarExamsPage() {
  const qc = useQueryClient();
  const [showBackfillDialog, setShowBackfillDialog] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);

  const sittingsQuery = useQuery({
    queryKey: SITTINGS_QUERY_KEY,
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: BarExamSittingRow[];
      }>('/admin/bar-exams');
      return res.data;
    },
  });

  const planQuery = useQuery({
    queryKey: PLAN_QUERY_KEY,
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: BackfillPlan;
      }>('/admin/bar-exams/backfill/plan');
      return res.data;
    },
    enabled: showBackfillDialog,
    staleTime: 30_000,
  });

  const ingestMutation = useMutation({
    mutationFn: async (body: {
      sittings?: { year: number; subjectSlug: string }[];
      backfillAll?: true;
      year?: number;
      subjectSlug?: string;
      limit?: number;
    }) => {
      const res = await apiClient.post<{
        success: boolean;
        data: DispatchResponse;
      }>('/admin/bar-exams/ingest', body);
      return res.data;
    },
    onSuccess: (data) => {
      if (data.mode === 'sittings_list') {
        setStatusMsg({
          kind: 'success',
          text:
            `Dispatched ${data.result.totalDispatched} sitting` +
            `${data.result.totalDispatched === 1 ? '' : 's'}; ` +
            `skipped ${data.result.totalSkipped}. ` +
            'Backfill will run during fetch window (1–6PM ET).',
        });
      } else {
        setStatusMsg({
          kind: 'success',
          text:
            `Dispatched ${data.task.taskName} (task ${data.task.taskId.slice(
              0,
              8,
            )}…). Backfill will run during fetch window (1–6PM ET).`,
        });
      }
      qc.invalidateQueries({ queryKey: SITTINGS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: PLAN_QUERY_KEY });
      setShowBackfillDialog(false);
    },
    onError: (err) => {
      setStatusMsg({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Dispatch failed',
      });
    },
  });

  const reparseMutation = useMutation({
    mutationFn: async (sittingId: string) => {
      const res = await apiClient.post<{
        success: boolean;
        data: DispatchedTaskResp;
      }>(`/admin/bar-exams/reparse/${sittingId}`, {});
      return res.data;
    },
    onSuccess: (data) => {
      setStatusMsg({
        kind: 'success',
        text: `Re-parse dispatched (task ${data.taskId.slice(0, 8)}…).`,
      });
      qc.invalidateQueries({ queryKey: SITTINGS_QUERY_KEY });
    },
    onError: (err) => {
      setStatusMsg({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Re-parse failed',
      });
    },
  });

  const sittings = sittingsQuery.data ?? [];
  const reduce = useReducedMotion();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="mb-2 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Admin
        </Link>
        <h1 className="text-2xl font-bold">Past Bar Examinations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ingest and re-parse LawPhil bar exam archive (2006-2022).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <motion.div
          whileTap={reduce ? undefined : { scale: 0.97 }}
          transition={motionTokens.easing.spring}
          className="inline-flex"
        >
          <Button
            variant="default"
            onClick={() => setShowBackfillDialog(true)}
            disabled={ingestMutation.isPending}
          >
            {ingestMutation.isPending
              ? 'Dispatching…'
              : 'Backfill LawPhil Archive'}
          </Button>
        </motion.div>
      </div>

      <AnimatedAlert
        message={
          statusMsg
            ? {
                type: statusMsg.kind === 'error' ? 'error' : 'success',
                text: statusMsg.text,
              }
            : null
        }
      />

      <BackfillDialog
        open={showBackfillDialog}
        plan={planQuery.data ?? null}
        isLoadingPlan={planQuery.isLoading || planQuery.isFetching}
        planError={
          planQuery.error instanceof Error ? planQuery.error.message : null
        }
        isDispatching={ingestMutation.isPending}
        onCancel={() => setShowBackfillDialog(false)}
        onDispatch={(picked) => {
          if (picked.length === 0) return;
          ingestMutation.mutate({ sittings: picked });
        }}
      />

      {sittingsQuery.isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Loading sittings…
          </CardContent>
        </Card>
      ) : sittings.length === 0 ? (
        <EmptyState
          illustration="scales"
          title="No bar exam sittings on record"
          message="Click “Backfill LawPhil Archive” above to populate the registry from LawPhil during the next fetch window."
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Year</th>
                <th className="px-3 py-2 text-left">Subject</th>
                <th className="px-3 py-2 text-left">Part</th>
                <th className="px-3 py-2 text-right">Questions</th>
                <th className="px-3 py-2 text-left">Last Ingested</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sittings.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {row.year}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {row.subjectStudyCode ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {row.part ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-900">
                    {row.questionCount}
                  </td>
                  <td className="px-3 py-2 text-gray-500">
                    {row.lastIngestedAt
                      ? new Date(row.lastIngestedAt).toLocaleDateString()
                      : 'Never'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.sourceDocumentId ? (
                      <Badge variant="secondary">Ingested</Badge>
                    ) : (
                      <Badge>Pending</Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-2"
                      onClick={() => reparseMutation.mutate(row.id)}
                      disabled={reparseMutation.isPending}
                    >
                      Re-parse
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
