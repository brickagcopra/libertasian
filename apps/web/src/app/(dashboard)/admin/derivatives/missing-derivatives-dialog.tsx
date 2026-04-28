'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  PlanPreviewDialog,
  type PlanItemizedColumn,
  type PlanItemizedRow,
} from '@/components/admin/plan-preview-dialog';
import {
  useBackfillMissingDerivatives,
  useMissingDerivativesPlan,
} from '@/features/admin/hooks/use-admin';
import type {
  BackfillMissingDerivativesResponse,
  MissingDerivativeType,
} from '@/features/admin/types';

interface MissingDerivativesDialogProps {
  open: boolean;
  onCancel: () => void;
  onSuccess: (response: BackfillMissingDerivativesResponse) => void;
  onError: (message: string) => void;
}

const TYPE_LABELS: Record<MissingDerivativeType, string> = {
  essay_prompt: 'Essay Prompt',
  mcq_question: 'MCQ Question',
  flashcard: 'Flashcard',
};

const COLUMNS: PlanItemizedColumn[] = [
  { key: 'select', header: 'Include' },
  { key: 'label', header: 'Type' },
  { key: 'count', header: 'Missing', align: 'right' },
  { key: 'meta', header: 'Per-type limit' },
  { key: 'status', header: 'Cost' },
];

function formatUsd(amount: number): string {
  if (amount === 0) return '$0';
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString();
}

export function MissingDerivativesDialog({
  open,
  onCancel,
  onSuccess,
  onError,
}: MissingDerivativesDialogProps) {
  const planQuery = useMissingDerivativesPlan({ enabled: open });
  const dispatchMutation = useBackfillMissingDerivatives();

  const plan = planQuery.data ?? null;
  const isLoadingPlan = open && (planQuery.isLoading || planQuery.isFetching);
  const planError =
    planQuery.error instanceof Error ? planQuery.error.message : null;

  // Per-type selection + limit inputs. Keyed by type.
  const [selected, setSelected] = useState<Record<MissingDerivativeType, boolean>>({
    essay_prompt: true,
    mcq_question: true,
    flashcard: true,
  });
  const [limits, setLimits] = useState<Record<MissingDerivativeType, string>>({
    essay_prompt: '200',
    mcq_question: '200',
    flashcard: '200',
  });

  // Re-seed from plan: when there's a tiny pending count, default the
  // limit to that count so "Dispatch X" matches what the operator sees.
  // Depend on a stable signature, not the plan object identity (the
  // React Query hook returns a fresh object on every render).
  const planSig = plan
    ? plan.perType.map((r) => `${r.type}:${r.missingCount}`).join('|')
    : null;
  useEffect(() => {
    if (!plan) return;
    setLimits((prev) => {
      const next = { ...prev };
      for (const row of plan.perType) {
        const seeded = Math.min(row.missingCount, 200);
        if (seeded > 0) next[row.type] = String(seeded);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planSig]);

  const parsedLimits = useMemo(() => {
    const out: Record<MissingDerivativeType, { value: number; valid: boolean }> = {
      essay_prompt: { value: 0, valid: false },
      mcq_question: { value: 0, valid: false },
      flashcard: { value: 0, valid: false },
    };
    for (const t of Object.keys(limits) as MissingDerivativeType[]) {
      const raw = limits[t].trim();
      if (raw === '') {
        out[t] = { value: 0, valid: false };
        continue;
      }
      const n = Number(raw);
      out[t] = {
        value: Math.floor(n),
        valid: Number.isFinite(n) && n >= 1 && n <= 5_000,
      };
    }
    return out;
  }, [limits]);

  const dispatchEntries = useMemo(() => {
    const entries: { type: MissingDerivativeType; limit: number }[] = [];
    for (const t of (['essay_prompt', 'mcq_question', 'flashcard'] as const)) {
      if (!selected[t]) continue;
      if (!parsedLimits[t].valid) continue;
      entries.push({ type: t, limit: parsedLimits[t].value });
    }
    return entries;
  }, [selected, parsedLimits]);

  const totalDispatchCount = useMemo(() => {
    if (!plan) return 0;
    return dispatchEntries.reduce((sum, e) => {
      const row = plan.perType.find((r) => r.type === e.type);
      if (!row) return sum;
      return sum + Math.min(row.missingCount, e.limit);
    }, 0);
  }, [plan, dispatchEntries]);

  const totalEstimatedCost = useMemo(() => {
    if (!plan) return 0;
    return dispatchEntries.reduce((sum, e) => {
      const row = plan.perType.find((r) => r.type === e.type);
      if (!row) return sum;
      const dispatched = Math.min(row.missingCount, e.limit);
      return sum + dispatched * row.costPerCallUsd;
    }, 0);
  }, [plan, dispatchEntries]);

  const headline = plan ? (
    <>
      {formatNumber(plan.totals.totalMissing)} doc/type pair
      {plan.totals.totalMissing === 1 ? '' : 's'} missing across the corpus.
      With current selection: {formatNumber(totalDispatchCount)} jobs (~
      {formatUsd(totalEstimatedCost)}).
    </>
  ) : null;

  const summarySlots = plan
    ? [
        {
          label: 'Total missing (corpus)',
          value: formatNumber(plan.totals.totalMissing),
          accent:
            plan.totals.totalMissing === 0 ? 'default' : ('warn' as const),
        },
        {
          label: 'Plan-wide est. cost',
          value: formatUsd(plan.totals.totalEstimatedCostUsd),
          hint: '@ $0.0003/call',
        },
        {
          label: 'Plan-wide est. time',
          value: `${plan.totals.totalEstimatedMinutes} min`,
        },
        {
          label: 'Last backfill',
          value: formatTimestamp(plan.totals.lastBackfillAt),
        },
      ]
    : [];

  const tableRows: PlanItemizedRow[] = useMemo(() => {
    if (!plan) return [];
    return plan.perType.map((row) => {
      const isSelected = selected[row.type];
      const limitState = parsedLimits[row.type];
      const dispatched = limitState.valid
        ? Math.min(row.missingCount, limitState.value)
        : 0;
      const cost = dispatched * row.costPerCallUsd;

      return {
        key: row.type,
        label: TYPE_LABELS[row.type],
        status: row.missingCount === 0 ? 'done' : 'pending',
        statusLabel: formatUsd(cost),
        count: row.missingCount,
        selected: isSelected,
        selectable: row.missingCount > 0,
        ariaLabel: `Include ${TYPE_LABELS[row.type]}`,
        meta: (
          <input
            type="number"
            min={1}
            max={5_000}
            value={limits[row.type]}
            onChange={(e) =>
              setLimits((prev) => ({ ...prev, [row.type]: e.target.value }))
            }
            disabled={!isSelected || row.missingCount === 0}
            aria-label={`Limit for ${TYPE_LABELS[row.type]}`}
            className={`w-24 rounded border px-2 py-1 text-xs ${
              isSelected && !limitState.valid
                ? 'border-red-400 bg-red-50'
                : 'border-gray-300'
            }`}
          />
        ),
      };
    });
  }, [plan, selected, limits, parsedLimits]);

  const toggleRow = (key: string) => {
    const t = key as MissingDerivativeType;
    setSelected((prev) => ({ ...prev, [t]: !prev[t] }));
  };

  const handleDispatch = () => {
    if (dispatchEntries.length === 0) {
      onError('Select at least one type with a valid limit.');
      return;
    }
    dispatchMutation.mutate(
      {
        perTypeLimits: dispatchEntries.map(({ type, limit }) => ({
          type,
          limit,
        })),
      },
      {
        onSuccess: (data) => onSuccess(data),
        onError: (err) =>
          onError(err instanceof Error ? err.message : 'Dispatch failed'),
      },
    );
  };

  const cantDispatch =
    !plan ||
    dispatchEntries.length === 0 ||
    totalDispatchCount === 0 ||
    dispatchMutation.isPending;

  return (
    <PlanPreviewDialog
      open={open}
      title="Fill Missing Derivatives"
      description="Per-type backfill across legal_documents that have no live artifact and no in-flight job. Each type carries its own limit."
      isLoadingPlan={isLoadingPlan}
      planError={planError}
      isDispatching={dispatchMutation.isPending}
      summaryHeadline={headline}
      summarySlots={summarySlots}
      itemizedRows={tableRows}
      itemizedColumns={COLUMNS}
      onToggleRow={toggleRow}
      footerLeft={
        plan ? (
          <span>
            Selection total: {formatNumber(totalDispatchCount)} job
            {totalDispatchCount === 1 ? '' : 's'} • {formatUsd(totalEstimatedCost)}
          </span>
        ) : null
      }
      primaryActionLabel={`Dispatch ${formatNumber(totalDispatchCount)} job${totalDispatchCount === 1 ? '' : 's'}`}
      primaryActionDisabled={cantDispatch}
      onCancel={onCancel}
      onPrimaryAction={handleDispatch}
    />
  );
}
