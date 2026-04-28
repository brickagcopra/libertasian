'use client';

import { useEffect, useMemo, useState } from 'react';

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

  const dispatchableCount = selectedKeys.size;

  const dispatchPayload = useMemo(() => {
    if (!plan) return [];
    return plan.sittings
      .filter((s) => selectedKeys.has(rowKey(s)))
      .map((s) => ({ year: s.year, subjectSlug: s.subjectSlug }));
  }, [plan, selectedKeys]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="backfill-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="border-b px-6 py-4">
          <h3 id="backfill-dialog-title" className="text-lg font-semibold">
            Confirm LawPhil Archive Backfill
          </h3>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoadingPlan ? (
            <div className="py-12 text-center text-sm text-gray-500">
              Loading plan…
            </div>
          ) : planError ? (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              Failed to load plan: {planError}
            </div>
          ) : plan ? (
            <PlanBody
              plan={plan}
              selectedKeys={selectedKeys}
              setSelectedKeys={setSelectedKeys}
            />
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t bg-gray-50 px-6 py-3">
          <div className="text-xs text-gray-600">
            {plan && (
              <>
                Window: {formatHour(plan.configuredFetchWindow.startHour)}–
                {formatHour(plan.configuredFetchWindow.endHour)}{' '}
                {plan.configuredFetchWindow.tz} (PH off-peak)
              </>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded border px-4 py-2 text-sm"
              disabled={isDispatching}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onDispatch(dispatchPayload)}
              disabled={
                isDispatching ||
                dispatchableCount === 0 ||
                isLoadingPlan ||
                !plan
              }
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isDispatching
                ? 'Dispatching…'
                : `Dispatch ${dispatchableCount} sitting${
                    dispatchableCount === 1 ? '' : 's'
                  }`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanBody({
  plan,
  selectedKeys,
  setSelectedKeys,
}: {
  plan: BackfillPlan;
  selectedKeys: Set<string>;
  setSelectedKeys: (next: Set<string>) => void;
}) {
  const toggleRow = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedKeys(next);
  };

  const { totals, sittings, coverage, configuredFetchWindow } = plan;

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-blue-50 p-4 text-sm">
        <p className="font-medium text-blue-900">
          Will fetch {totals.pending} new sitting
          {totals.pending === 1 ? '' : 's'} ({totals.alreadyIngested} already
          present). Est. {totals.estimatedQuestionsLow}–
          {totals.estimatedQuestionsHigh} questions. Est.{' '}
          {totals.estimatedFetchMinutes} minute
          {totals.estimatedFetchMinutes === 1 ? '' : 's'} spread across{' '}
          {totals.estimatedFetchWindowsNeeded} fetch window
          {totals.estimatedFetchWindowsNeeded === 1 ? '' : 's'}.
        </p>
        <p className="mt-1 text-xs text-blue-800">
          Window: {formatHour(configuredFetchWindow.startHour)}–
          {formatHour(configuredFetchWindow.endHour)}{' '}
          {configuredFetchWindow.tz} (PH off-peak).
        </p>
        <p className="mt-2 text-xs text-blue-800">
          Years available: {coverage.yearsAvailable.join(', ')}.
        </p>
        {coverage.yearsAbsentOnLawphil.length > 0 && (
          <p className="mt-1 text-xs text-blue-800">
            Years absent ({coverage.yearsAbsentOnLawphil.join(', ')}):{' '}
            {coverage.absenceReason}
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left">Include</th>
              <th className="px-3 py-2 text-left">Year</th>
              <th className="px-3 py-2 text-left">Subject</th>
              <th className="px-3 py-2 text-left">Part</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {sittings.map((s) => {
              const key = rowKey(s);
              const isIngested = s.status === 'already_ingested';
              const checked = selectedKeys.has(key);
              return (
                <tr
                  key={key}
                  className={isIngested ? 'bg-gray-50 text-gray-500' : ''}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Include ${s.year} ${s.label}${
                        s.part ? ` Part ${s.part}` : ''
                      }`}
                      checked={checked}
                      disabled={isIngested}
                      onChange={() => toggleRow(key)}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {s.year}
                  </td>
                  <td className="px-3 py-2">{s.label}</td>
                  <td className="px-3 py-2">{s.part ?? '—'}</td>
                  <td className="px-3 py-2">
                    {isIngested ? (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                        Ingested
                        {s.existingQuestionCount != null
                          ? ` (${s.existingQuestionCount} Q)`
                          : ''}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                        Pending
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <a
                      href={s.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      LawPhil
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
