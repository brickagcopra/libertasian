'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon } from 'lucide-react';

import {
  useBudgetSnapshot,
  useBudgetHistory,
  useUpdateBudgetSettings,
} from '@/features/admin/hooks/use-budget';
import type { LedgerScopeSummary, LedgerMonthSummary } from '@/features/admin/types';
import { AdminCardSkeleton } from '@/components/ui/skeleton';

export default function BudgetPage() {
  const { data, isLoading } = useBudgetSnapshot();
  const { data: history } = useBudgetHistory();
  const updateSettings = useUpdateBudgetSettings();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Link href="/admin" className="mb-2 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeftIcon className="h-4 w-4" /> Back to Admin
          </Link>
          <h1 className="text-2xl font-bold">Budget Management</h1>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <AdminCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  const snapshot = data?.snapshot;
  const byScope = data?.byScope ?? [];

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin" className="mb-2 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeftIcon className="h-4 w-4" /> Back to Admin
        </Link>
        <h1 className="text-2xl font-bold">Budget Management</h1>
        <p className="mt-1 text-sm text-gray-500">Monitor LLM spending and manage budget ceilings</p>
      </div>

      {/* Gauge Cards */}
      <div className="grid gap-6 sm:grid-cols-2">
        <GaugeCard
          title="Monthly Budget"
          spend={snapshot?.monthSpend ?? 0}
          ceiling={snapshot?.monthlyCeiling ?? 0}
          utilization={snapshot?.monthUtilizationPercent ?? 0}
          period={snapshot?.month ?? ''}
        />
        <GaugeCard
          title="Daily Budget"
          spend={snapshot?.daySpend ?? 0}
          ceiling={snapshot?.dailyCeiling ?? null}
          utilization={snapshot?.dayUtilizationPercent ?? null}
          period={snapshot?.day ?? ''}
        />
      </div>

      {/* Budget Editor */}
      <BudgetEditor
        monthlyCeiling={snapshot?.monthlyCeiling ?? 0}
        dailyCeiling={snapshot?.dailyCeiling ?? null}
        onSave={(monthly, daily) => updateSettings.mutate({ monthlyCeilingUsd: monthly, ...(daily !== undefined && { dailyCeilingUsd: daily }) })}
        isPending={updateSettings.isPending}
      />

      {/* Spend Breakdown by Scope */}
      <SpendBreakdown byScope={byScope} />

      {/* Monthly History */}
      <MonthlyHistory history={history ?? []} />
    </div>
  );
}

// ---- Gauge Card ----

function GaugeCard({
  title,
  spend,
  ceiling,
  utilization,
  period,
}: {
  title: string;
  spend: number;
  ceiling: number | null;
  utilization: number | null;
  period: string;
}) {
  const hasCeiling = ceiling !== null && ceiling > 0;
  const pct = utilization ?? 0;
  const barColor = pct < 60 ? 'bg-green-500' : pct < 85 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm">
      <h3 className="mb-1 text-sm font-medium text-gray-500">{title}</h3>
      {hasCeiling ? (
        <>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold">${spend.toFixed(2)}</span>
            <span className="text-sm text-gray-500">/ ${ceiling!.toFixed(2)}</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">{pct.toFixed(1)}% utilized — {period}</p>
        </>
      ) : (
        <div className="flex h-20 items-center justify-center">
          <p className="text-sm text-gray-400">
            {ceiling === null ? 'No daily limit set' : '$0.00 ceiling'}
          </p>
        </div>
      )}
    </div>
  );
}

// ---- Budget Editor ----

function BudgetEditor({
  monthlyCeiling,
  dailyCeiling,
  onSave,
  isPending,
}: {
  monthlyCeiling: number;
  dailyCeiling: number | null;
  onSave: (monthly: number, daily?: number) => void;
  isPending: boolean;
}) {
  const [monthlyInput, setMonthlyInput] = useState(String(monthlyCeiling));
  const [dailyInput, setDailyInput] = useState(dailyCeiling !== null ? String(dailyCeiling) : '');
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSave = () => {
    setError(null);
    const monthly = Number(monthlyInput);
    if (!Number.isFinite(monthly) || monthly < 0) {
      setError('Monthly ceiling must be a non-negative number.');
      return;
    }
    const trimmedDaily = dailyInput.trim();
    if (trimmedDaily !== '') {
      const daily = Number(trimmedDaily);
      if (!Number.isFinite(daily) || daily < 0) {
        setError('Daily ceiling must be a non-negative number or blank.');
        return;
      }
    }
    setShowConfirm(true);
  };

  const handleConfirm = () => {
    setShowConfirm(false);
    const monthly = Number(monthlyInput);
    const trimmedDaily = dailyInput.trim();
    const daily = trimmedDaily !== '' ? Number(trimmedDaily) : undefined;
    onSave(monthly, daily);
  };

  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Budget Settings</h2>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Monthly Ceiling (USD)</label>
          <input
            type="number"
            min={0}
            step={1}
            value={monthlyInput}
            onChange={(e) => setMonthlyInput(e.target.value)}
            className="w-40 rounded-md border px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Daily Ceiling (USD) <span className="text-gray-400">— optional</span>
          </label>
          <input
            type="number"
            min={0}
            step={1}
            placeholder="leave blank for no daily cap"
            value={dailyInput}
            onChange={(e) => setDailyInput(e.target.value)}
            className="w-56 rounded-md border px-3 py-1.5 text-sm"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Save
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {/* Confirmation Dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="mb-2 text-lg font-semibold">Confirm Budget Change</h3>
            <p className="mb-4 text-sm text-gray-600">
              Update monthly ceiling to <span className="font-medium">${monthlyInput}</span>
              {dailyInput.trim() && (
                <> and daily ceiling to <span className="font-medium">${dailyInput.trim()}</span></>
              )}
              ?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="rounded-md border px-4 py-1.5 text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Spend Breakdown by Scope ----

function SpendBreakdown({ byScope }: { byScope: LedgerScopeSummary[] }) {
  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Spend Breakdown (Current Month)</h2>
      {byScope.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">No spend data yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 pr-4 font-medium">Scope</th>
                <th className="pb-2 pr-4 text-right font-medium">Amount (USD)</th>
                <th className="pb-2 pr-4 text-right font-medium">Tokens In</th>
                <th className="pb-2 pr-4 text-right font-medium">Tokens Out</th>
                <th className="pb-2 text-right font-medium">Requests</th>
              </tr>
            </thead>
            <tbody>
              {byScope.map((row) => (
                <tr key={row.scope} className="border-b last:border-0">
                  <td className="py-2.5 pr-4 font-medium">{formatScope(row.scope)}</td>
                  <td className="py-2.5 pr-4 text-right font-mono">${row.totalAmountUsd.toFixed(4)}</td>
                  <td className="py-2.5 pr-4 text-right">{formatNumber(row.totalTokensIn)}</td>
                  <td className="py-2.5 pr-4 text-right">{formatNumber(row.totalTokensOut)}</td>
                  <td className="py-2.5 text-right">{row.totalRequests.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Monthly History ----

function MonthlyHistory({ history }: { history: LedgerMonthSummary[] }) {
  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Monthly History</h2>
      {history.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">No history yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 pr-4 font-medium">Month</th>
                <th className="pb-2 pr-4 text-right font-medium">Total Spend (USD)</th>
                <th className="pb-2 pr-4 text-right font-medium">Tokens In</th>
                <th className="pb-2 pr-4 text-right font-medium">Tokens Out</th>
                <th className="pb-2 text-right font-medium">Requests</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.periodYearMonth} className="border-b last:border-0">
                  <td className="py-2.5 pr-4 font-medium">{row.periodYearMonth}</td>
                  <td className="py-2.5 pr-4 text-right font-mono">${row.totalAmountUsd.toFixed(4)}</td>
                  <td className="py-2.5 pr-4 text-right">{formatNumber(row.totalTokensIn)}</td>
                  <td className="py-2.5 pr-4 text-right">{formatNumber(row.totalTokensOut)}</td>
                  <td className="py-2.5 text-right">{row.totalRequests.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Helpers ----

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatScope(scope: string): string {
  return scope
    .replace(/_/g, ' ')
    .replace(/:/g, ': ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
