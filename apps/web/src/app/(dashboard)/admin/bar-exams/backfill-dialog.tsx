'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  PlanPreviewDialog,
  type PlanItemizedColumn,
  type PlanItemizedRow,
} from '@/components/admin/plan-preview-dialog';

interface BackfillPlanSitting {
  year: number;
  subjectSlug: string;
  subjectStudyCode: string;
  subjectAdminCode: string;
  part: string | null;
  label: string;
  status: 'pending' | 'already_ingested';
  existingSittingId: string | null;
  existingQuestionCount: number | null;
  sourceUrl: string;
}

export interface BackfillPlan {
  coverage: {
    yearsAvailable: number[];
    yearsAbsentOnLawphil: number[];
    absenceReason: string;
  };
  sittings: BackfillPlanSitting[];
  totals: {
    pending: number;
    alreadyIngested: number;
    totalCombinations: number;
    estimatedQuestionsLow: number;
    estimatedQuestionsHigh: number;
    estimatedFetchMinutes: number;
    estimatedFetchWindowsNeeded: number;
  };
  configuredFetchWindow: {
    tz: string;
    startHour: number;
    endHour: number;
  };
}

export interface BackfillDialogProps {
  open: boolean;
  plan: BackfillPlan | null;
  isLoadingPlan: boolean;
  planError: string | null;
  isDispatching: boolean;
  onCancel: () => void;
  onDispatch: (
    sittings: { year: number; subjectSlug: string }[],
  ) => void;
}

const BAR_EXAM_COLUMNS: PlanItemizedColumn[] = [
  { key: 'select', header: 'Include' },
  { key: 'label', header: 'Subject' },
  { key: 'meta', header: 'Part' },
  { key: 'status', header: 'Status' },
  { key: 'source', header: 'Source' },
];

function rowKey(s: BackfillPlanSitting): string {
  return `${s.year}|${s.subjectSlug}`;
}

function formatHour(hour: number): string {
  if (hour === 0) return '12AM';
  if (hour === 12) return '12PM';
  if (hour < 12) return `${hour}AM`;
  return `${hour - 12}PM`;
}

export function BackfillDialog({
  open,
  plan,
  isLoadingPlan,
  planError,
  isDispatching,
  onCancel,
  onDispatch,
}: BackfillDialogProps) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Default-select all 'pending' rows when a plan first arrives. We
  // only seed once per plan load (keyed by total combinations); after
  // that the operator owns the selection.
  const planSignature = plan
    ? `${plan.totals.totalCombinations}|${plan.totals.pending}`
    : null;
  useEffect(() => {
    if (!plan) return;
    const initial = new Set<string>();
    for (const s of plan.sittings) {
      if (s.status === 'pending') initial.add(rowKey(s));
    }
    setSelectedKeys(initial);
  }, [plan, planSignature]);

  const dispatchPayload = useMemo(() => {
    if (!plan) return [];
    return plan.sittings
      .filter((s) => selectedKeys.has(rowKey(s)))
      .map((s) => ({ year: s.year, subjectSlug: s.subjectSlug }));
  }, [plan, selectedKeys]);

  const dispatchableCount = dispatchPayload.length;

  const headline = plan ? (
    <>
      Will fetch {plan.totals.pending} new sitting
      {plan.totals.pending === 1 ? '' : 's'} ({plan.totals.alreadyIngested}{' '}
      already present). Est. {plan.totals.estimatedQuestionsLow}–
      {plan.totals.estimatedQuestionsHigh} questions. Est.{' '}
      {plan.totals.estimatedFetchMinutes} minute
      {plan.totals.estimatedFetchMinutes === 1 ? '' : 's'} spread across{' '}
      {plan.totals.estimatedFetchWindowsNeeded} fetch window
      {plan.totals.estimatedFetchWindowsNeeded === 1 ? '' : 's'}.
    </>
  ) : null;

  const summaryExtra = plan ? (
    <>
      <p>
        Window: {formatHour(plan.configuredFetchWindow.startHour)}–
        {formatHour(plan.configuredFetchWindow.endHour)}{' '}
        {plan.configuredFetchWindow.tz} (PH off-peak).
      </p>
      <p className="mt-1">
        Years available: {plan.coverage.yearsAvailable.join(', ')}.
      </p>
      {plan.coverage.yearsAbsentOnLawphil.length > 0 && (
        <p className="mt-1">
          Years absent ({plan.coverage.yearsAbsentOnLawphil.join(', ')}):{' '}
          {plan.coverage.absenceReason}
        </p>
      )}
    </>
  ) : null;

  const tableRows: PlanItemizedRow[] = useMemo(() => {
    if (!plan) return [];
    return plan.sittings.map((s) => {
      const k = rowKey(s);
      const isIngested = s.status === 'already_ingested';
      const ariaLabel = `Include ${s.year} ${s.label}${s.part ? ` Part ${s.part}` : ''}`;
      return {
        key: k,
        label: (
          <>
            <span className="mr-2 font-medium text-gray-900">{s.year}</span>
            <span className="text-gray-700">{s.label}</span>
          </>
        ),
        status: isIngested ? 'done' : 'pending',
        statusLabel: isIngested ? 'Ingested' : 'Pending',
        count: isIngested ? s.existingQuestionCount ?? undefined : undefined,
        sourceUrl: s.sourceUrl,
        selected: selectedKeys.has(k),
        selectable: !isIngested,
        ariaLabel,
        meta: s.part ?? '—',
      };
    });
  }, [plan, selectedKeys]);

  const footer = plan ? (
    <>
      Window: {formatHour(plan.configuredFetchWindow.startHour)}–
      {formatHour(plan.configuredFetchWindow.endHour)}{' '}
      {plan.configuredFetchWindow.tz} (PH off-peak)
    </>
  ) : null;

  const toggleRow = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <PlanPreviewDialog
      open={open}
      title="Confirm LawPhil Archive Backfill"
      isLoadingPlan={isLoadingPlan}
      planError={planError}
      isDispatching={isDispatching}
      summaryHeadline={headline}
      summarySlots={[]}
      summaryExtraContent={summaryExtra}
      itemizedRows={tableRows}
      itemizedColumns={BAR_EXAM_COLUMNS}
      onToggleRow={toggleRow}
      footerLeft={footer}
      primaryActionLabel={`Dispatch ${dispatchableCount} sitting${dispatchableCount === 1 ? '' : 's'}`}
      primaryActionDisabled={dispatchableCount === 0 || !plan}
      onCancel={onCancel}
      onPrimaryAction={() => onDispatch(dispatchPayload)}
    />
  );
}
