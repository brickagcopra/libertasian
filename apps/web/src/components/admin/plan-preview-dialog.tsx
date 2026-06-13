'use client';

import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import { motionTokens } from '@/lib/motion';

export interface PlanSummarySlot {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: 'default' | 'warn';
}

export interface PlanItemizedRow {
  key: string;
  label: ReactNode;
  status: 'pending' | 'done' | 'disabled';
  statusLabel?: string;
  count?: number;
  sourceUrl?: string;
  selected?: boolean;
  selectable?: boolean;
  meta?: ReactNode;
  ariaLabel?: string;
}

export interface PlanItemizedColumn {
  key: string;
  header: string;
  align?: 'left' | 'right';
}

export interface PlanPreviewDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  isLoadingPlan: boolean;
  planError: string | null;
  isDispatching: boolean;
  summaryHeadline?: ReactNode;
  summarySlots: PlanSummarySlot[];
  summaryExtraContent?: ReactNode;
  itemizedRows?: PlanItemizedRow[];
  itemizedColumns?: PlanItemizedColumn[];
  onToggleRow?: (key: string) => void;
  footerLeft?: ReactNode;
  primaryActionLabel: string;
  primaryActionDisabled?: boolean;
  onCancel: () => void;
  onPrimaryAction: () => void;
}

const DEFAULT_COLUMNS: PlanItemizedColumn[] = [
  { key: 'select', header: 'Include' },
  { key: 'label', header: 'Label' },
  { key: 'status', header: 'Status' },
  { key: 'meta', header: '' },
];

export function PlanPreviewDialog({
  open,
  title,
  description,
  isLoadingPlan,
  planError,
  isDispatching,
  summaryHeadline,
  summarySlots,
  summaryExtraContent,
  itemizedRows,
  itemizedColumns,
  onToggleRow,
  footerLeft,
  primaryActionLabel,
  primaryActionDisabled,
  onCancel,
  onPrimaryAction,
}: PlanPreviewDialogProps) {
  const reduce = useReducedMotion();

  if (!open) return null;

  const titleId = `plan-preview-${slugify(title)}-title`;
  const showRows = !!itemizedRows && itemizedRows.length > 0;
  const columns = itemizedColumns ?? DEFAULT_COLUMNS;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="border-b px-6 py-4">
          <h3 id={titleId} className="text-lg font-semibold">
            {title}
          </h3>
          {description && (
            <p className="mt-1 text-sm text-gray-600">{description}</p>
          )}
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
          ) : (
            <div className="space-y-4">
              <SummaryCard
                headline={summaryHeadline}
                slots={summarySlots}
                extra={summaryExtraContent}
              />

              {showRows && (
                <ItemizedTable
                  rows={itemizedRows!}
                  columns={columns}
                  onToggleRow={onToggleRow}
                />
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t bg-gray-50 px-6 py-3">
          <div className="text-xs text-gray-600">{footerLeft}</div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded border px-4 py-2 text-sm"
              disabled={isDispatching}
            >
              Cancel
            </button>
            <motion.button
              type="button"
              onClick={onPrimaryAction}
              disabled={
                isDispatching || isLoadingPlan || primaryActionDisabled === true
              }
              whileTap={reduce ? undefined : { scale: 0.97 }}
              transition={motionTokens.easing.spring}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isDispatching ? 'Dispatching…' : primaryActionLabel}
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  headline,
  slots,
  extra,
}: {
  headline?: ReactNode;
  slots: PlanSummarySlot[];
  extra?: ReactNode;
}) {
  if (slots.length === 0 && !headline && !extra) return null;
  return (
    <div className="rounded-md border bg-blue-50 p-4 text-sm">
      {headline && (
        <p className="font-medium text-blue-900">{headline}</p>
      )}
      {slots.length > 0 && (
        <dl className={`grid gap-3 sm:grid-cols-2 ${headline ? 'mt-3' : ''}`}>
          {slots.map((slot, idx) => (
            <div key={`${slot.label}-${idx}`}>
              <dt className="text-xs uppercase tracking-wide text-blue-700">
                {slot.label}
              </dt>
              <dd
                className={`mt-0.5 font-semibold ${
                  slot.accent === 'warn'
                    ? 'text-amber-700'
                    : 'text-blue-900'
                }`}
              >
                {slot.value}
              </dd>
              {slot.hint && (
                <p className="mt-0.5 text-xs text-blue-800">{slot.hint}</p>
              )}
            </div>
          ))}
        </dl>
      )}
      {extra && <div className="mt-3 text-xs text-blue-800">{extra}</div>}
    </div>
  );
}

function ItemizedTable({
  rows,
  columns,
  onToggleRow,
}: {
  rows: PlanItemizedRow[];
  columns: PlanItemizedColumn[];
  onToggleRow?: (key: string) => void;
}) {
  const showSelectColumn = columns.some((c) => c.key === 'select');

  return (
    <div className="overflow-hidden rounded-md border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-3 py-2 ${
                  col.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {rows.map((row) => {
            const isMuted = row.status === 'done' || row.status === 'disabled';
            const isSelectable = row.selectable !== false && row.status !== 'done';
            return (
              <tr
                key={row.key}
                className={isMuted ? 'bg-gray-50 text-gray-500' : ''}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-3 py-2 ${
                      col.align === 'right' ? 'text-right' : ''
                    }`}
                  >
                    {renderCell(col.key, row, {
                      isSelectable: isSelectable && showSelectColumn,
                      onToggle: () => onToggleRow?.(row.key),
                    })}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function renderCell(
  columnKey: string,
  row: PlanItemizedRow,
  ctx: { isSelectable: boolean; onToggle: () => void },
): ReactNode {
  switch (columnKey) {
    case 'select':
      return (
        <input
          type="checkbox"
          aria-label={
            row.ariaLabel ?? (typeof row.label === 'string' ? `Include ${row.label}` : 'Include row')
          }
          checked={row.selected ?? false}
          disabled={!ctx.isSelectable}
          onChange={ctx.onToggle}
        />
      );
    case 'label':
      return <span className="font-medium text-gray-900">{row.label}</span>;
    case 'status':
      return <StatusBadge status={row.status} statusLabel={row.statusLabel} count={row.count} />;
    case 'count':
      return row.count != null ? row.count : '—';
    case 'source':
      return row.sourceUrl ? (
        <a
          href={row.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          Source
        </a>
      ) : (
        '—'
      );
    case 'meta':
      return row.meta ?? null;
    default:
      return null;
  }
}

function StatusBadge({
  status,
  statusLabel,
  count,
}: {
  status: PlanItemizedRow['status'];
  statusLabel?: string;
  count?: number;
}) {
  if (status === 'done') {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
        {statusLabel ?? 'Done'}
        {count != null ? ` (${count})` : ''}
      </span>
    );
  }
  if (status === 'disabled') {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
        {statusLabel ?? 'Disabled'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
      {statusLabel ?? 'Pending'}
    </span>
  );
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
