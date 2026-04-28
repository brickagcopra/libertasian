'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

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

const SITTINGS_QUERY_KEY = ['admin', 'bar-exams', 'sittings'];

export default function AdminBarExamsPage() {
  const qc = useQueryClient();
  const [showBackfillConfirm, setShowBackfillConfirm] = useState(false);
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

  const ingestMutation = useMutation({
    mutationFn: async (body: {
      year?: number;
      subjectSlug?: string;
      limit?: number;
    }) => {
      const res = await apiClient.post<{
        success: boolean;
        data: DispatchedTaskResp;
      }>('/admin/bar-exams/ingest', body);
      return res.data;
    },
    onSuccess: (data) => {
      setStatusMsg({
        kind: 'success',
        text: `Dispatched ${data.taskName} (task ${data.taskId.slice(0, 8)}…).`,
      });
      qc.invalidateQueries({ queryKey: SITTINGS_QUERY_KEY });
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
        <Button
          variant="default"
          onClick={() => setShowBackfillConfirm(true)}
          disabled={ingestMutation.isPending}
        >
          {ingestMutation.isPending
            ? 'Dispatching…'
            : 'Backfill LawPhil Archive'}
        </Button>
      </div>

      {statusMsg && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            statusMsg.kind === 'error'
              ? 'bg-red-50 text-red-700'
              : 'bg-green-50 text-green-700'
          }`}
        >
          {statusMsg.text}
        </div>
      )}

      {showBackfillConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        >
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold">Confirm Archive Backfill</h3>
            <p className="mt-2 text-sm text-gray-600">
              This will fetch ~108 LawPhil bar exam pages over the next several
              fetch windows (PH off-peak only). Existing sittings are skipped;
              the task is idempotent. Continue?
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setShowBackfillConfirm(false)}
                className="rounded border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  ingestMutation.mutate({});
                  setShowBackfillConfirm(false);
                }}
                disabled={ingestMutation.isPending}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Dispatch Backfill
              </button>
            </div>
          </div>
        </div>
      )}

      {sittingsQuery.isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Loading sittings…
          </CardContent>
        </Card>
      ) : sittings.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No bar exam sittings on record. Click &ldquo;Backfill LawPhil
            Archive&rdquo; to populate.
          </CardContent>
        </Card>
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
