'use client';

import { useState } from 'react';

import { PlanPreviewDialog } from '@/components/admin/plan-preview-dialog';
import {
  useCitationsBackfillPlan,
  useDispatchCitationsBackfill,
} from '@/features/admin/hooks/use-admin';
import type { BackfillCitationsResponse } from '@/features/admin/types';

interface CitationsBackfillDialogProps {
  open: boolean;
  onCancel: () => void;
  onSuccess: (response: BackfillCitationsResponse) => void;
  onError: (message: string) => void;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString();
}

function actorLabel(id: string | null): string {
  if (!id) return '—';
  return `${id.slice(0, 8)}…`;
}

export function CitationsBackfillDialog({
  open,
  onCancel,
  onSuccess,
  onError,
}: CitationsBackfillDialogProps) {
  const [limitInput, setLimitInput] = useState<string>('');

  const planQuery = useCitationsBackfillPlan({ enabled: open });
  const dispatchMutation = useDispatchCitationsBackfill();

  const plan = planQuery.data ?? null;
  const isLoadingPlan = open && (planQuery.isLoading || planQuery.isFetching);
  const planError =
    planQuery.error instanceof Error ? planQuery.error.message : null;

  const parsedLimit = limitInput.trim() === '' ? undefined : Number(limitInput);
  const limitInvalid =
    parsedLimit !== undefined &&
    (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 10_000);

  const effectiveCount =
    parsedLimit !== undefined && plan
      ? Math.min(parsedLimit, plan.docsPending)
      : plan?.docsPending ?? 0;

  const handleDispatch = () => {
    if (limitInvalid) {
      onError('Limit must be an integer between 1 and 10,000.');
      return;
    }
    dispatchMutation.mutate(
      { limit: parsedLimit },
      {
        onSuccess: (data) => {
          onSuccess(data);
          setLimitInput('');
        },
        onError: (err) => {
          onError(err instanceof Error ? err.message : 'Dispatch failed');
        },
      },
    );
  };

  const headline = plan ? (
    <>
      Will dispatch citation extraction across {formatNumber(plan.docsPending)}{' '}
      pending document{plan.docsPending === 1 ? '' : 's'} (
      {formatNumber(plan.docsAlreadyHaveCitations)} already extracted of{' '}
      {formatNumber(plan.totalCorpusDocs)} total). Est.{' '}
      {formatNumber(plan.estimatedNewCitationsRange.low)}–
      {formatNumber(plan.estimatedNewCitationsRange.high)} new citations, ~
      {plan.estimatedMinutes} min.
    </>
  ) : null;

  const summarySlots = plan
    ? [
        { label: 'Total corpus docs', value: formatNumber(plan.totalCorpusDocs) },
        {
          label: 'Already extracted',
          value: formatNumber(plan.docsAlreadyHaveCitations),
        },
        {
          label: 'Pending',
          value: formatNumber(plan.docsPending),
          accent: plan.docsPending === 0 ? 'default' : ('warn' as const),
        },
        {
          label: 'Est. new citations',
          value: `${formatNumber(plan.estimatedNewCitationsRange.low)}–${formatNumber(plan.estimatedNewCitationsRange.high)}`,
          hint: '10–25 per doc, average yield',
        },
      ]
    : [];

  const summaryExtra = plan ? (
    <>
      <p>Last backfill: {formatTimestamp(plan.lastBackfillAt)}</p>
      {plan.lastBackfillDispatchedBy && (
        <p className="mt-1">
          Last dispatched by user {actorLabel(plan.lastBackfillDispatchedBy)}
        </p>
      )}
    </>
  ) : null;

  const dispatchLabel = plan
    ? parsedLimit !== undefined
      ? `Dispatch up to ${formatNumber(effectiveCount)} doc${effectiveCount === 1 ? '' : 's'}`
      : `Dispatch all ${formatNumber(plan.docsPending)} pending`
    : 'Dispatch';

  return (
    <PlanPreviewDialog
      open={open}
      title="Backfill Citations"
      description="Re-runs the citation extractor across legal_documents that have no citations yet. The Celery worker processes these asynchronously."
      isLoadingPlan={isLoadingPlan}
      planError={planError}
      isDispatching={dispatchMutation.isPending}
      summaryHeadline={headline}
      summarySlots={summarySlots}
      summaryExtraContent={summaryExtra}
      itemizedRows={[]}
      footerLeft={
        <div className="flex items-center gap-2">
          <label htmlFor="citations-limit" className="text-xs">
            Limit (optional):
          </label>
          <input
            id="citations-limit"
            type="number"
            min={1}
            max={10_000}
            placeholder="all pending"
            value={limitInput}
            onChange={(e) => setLimitInput(e.target.value)}
            disabled={dispatchMutation.isPending}
            className={`w-32 rounded border px-2 py-1 text-xs ${
              limitInvalid ? 'border-red-400 bg-red-50' : 'border-gray-300'
            }`}
          />
        </div>
      }
      primaryActionLabel={dispatchLabel}
      primaryActionDisabled={
        !plan || plan.docsPending === 0 || limitInvalid === true
      }
      onCancel={onCancel}
      onPrimaryAction={handleDispatch}
    />
  );
}
