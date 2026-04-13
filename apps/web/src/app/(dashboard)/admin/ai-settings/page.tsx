'use client';

import { useState } from 'react';

import {
  useAiSettings,
  useAiUsage,
  useAiUsageHistory,
  useUpdateAiSetting,
  useUpdateBudget,
  useUpdateIngestionWindow,
  useRunIngestion,
} from '@/features/admin/hooks/use-ai-settings';
import { AdminCardSkeleton } from '@/components/ui/skeleton';

// ---- Model pricing display ----

const AVAILABLE_MODELS = [
  { model: 'gpt-4o-mini', label: 'GPT-4o Mini', price: '$0.15 / $0.60 per 1M tokens' },
  { model: 'gpt-4o', label: 'GPT-4o', price: '$2.50 / $10.00 per 1M tokens' },
  { model: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', price: '$0.40 / $1.60 per 1M tokens' },
  { model: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', price: '$0.10 / $0.40 per 1M tokens' },
];

const CRON_PRESETS = [
  { label: 'Daily at 2 AM', cron: '0 2 * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Every 12 hours', cron: '0 */12 * * *' },
  { label: 'Weekly on Sunday', cron: '0 2 * * 0' },
];

/** Allowlisted timezones for the §7.3 ingestion window picker. */
const INGESTION_WINDOW_TIMEZONES = ['Asia/Manila'] as const;

const HH_MM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

// ---- Helper to get a setting value from the settings array ----

function getSettingValue<T>(
  settings: { key: string; value: unknown }[] | undefined,
  key: string,
  defaultValue: T,
): T {
  if (!settings) return defaultValue;
  const found = settings.find((s) => s.key === key);
  return found ? (found.value as T) : defaultValue;
}

// ---- Main Page ----

export default function AiSettingsPage() {
  const { data: settings, isLoading: settingsLoading } = useAiSettings();
  const { data: usage, isLoading: usageLoading } = useAiUsage();
  const { data: history } = useAiUsageHistory();
  const updateSetting = useUpdateAiSetting();
  const updateBudget = useUpdateBudget();
  const updateIngestionWindow = useUpdateIngestionWindow();
  const runIngestion = useRunIngestion();

  if (settingsLoading || usageLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">AI Settings</h1>
          <p className="mt-1 text-sm text-gray-500">Manage LLM spending, model selection, and ingestion schedules</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <AdminCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  const budget = getSettingValue<{ amount: number }>(settings, 'llm_monthly_budget_usd', { amount: 200 });
  const dailyBudget = getSettingValue<{ amount: number } | null>(settings, 'llm_daily_budget_usd', null);
  const llmModel = getSettingValue<{ model: string; provider: string }>(settings, 'llm_model', {
    model: 'gpt-4o-mini',
    provider: 'openai',
  });
  const llmEnabled = getSettingValue<{ enabled: boolean }>(settings, 'llm_enabled', { enabled: true });
  const ingestionSchedule = getSettingValue<{
    enabled: boolean;
    schedules: { sourceKey: string; cron: string; enabled: boolean }[];
  }>(settings, 'ingestion_schedule', { enabled: false, schedules: [] });
  const ingestionWindow = getSettingValue<{
    startLocal: string;
    stopLocal: string;
    timezone: string;
  } | null>(settings, 'ingestion_window', null);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">AI Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Manage LLM spending, model selection, and ingestion schedules</p>
      </div>

      {/* Section 1: API Usage & Budget */}
      <UsageBudgetSection
        usage={usage}
        history={history}
        budget={budget}
        dailyBudget={dailyBudget}
        llmEnabled={llmEnabled}
        llmModel={llmModel}
        onUpdateSetting={updateSetting.mutate}
        onUpdateBudget={updateBudget.mutate}
        isPending={updateSetting.isPending || updateBudget.isPending}
      />

      {/* Section 2: Ingestion Window (§7.3) */}
      <IngestionWindowSection
        window={ingestionWindow}
        onUpdateWindow={updateIngestionWindow.mutate}
        isPending={updateIngestionWindow.isPending}
      />

      {/* Section 3: Ingestion Schedule */}
      <IngestionScheduleSection
        schedule={ingestionSchedule}
        onUpdateSchedule={(value) => updateSetting.mutate({ key: 'ingestion_schedule', value })}
        onRunNow={(sourceId) => runIngestion.mutate(sourceId)}
        isRunning={runIngestion.isPending}
        isPending={updateSetting.isPending}
      />

      {/* Section 4: Configuration Summary */}
      <ConfigSummarySection
        model={llmModel}
        budget={budget}
        dailyBudget={dailyBudget}
        enabled={llmEnabled.enabled}
        ingestionEnabled={ingestionSchedule.enabled}
        ingestionWindow={ingestionWindow}
      />
    </div>
  );
}

// ---- Section 1: Usage & Budget ----

function UsageBudgetSection({
  usage,
  history,
  budget,
  dailyBudget,
  llmEnabled,
  llmModel,
  onUpdateSetting,
  onUpdateBudget,
  isPending,
}: {
  usage: { estimatedCostUsd: number; budgetUsd: number; tokensIn: number; tokensOut: number; requestCount: number; utilizationPercent: number } | undefined;
  history: { month: string; estimatedCostUsd: number }[] | undefined;
  budget: { amount: number };
  dailyBudget: { amount: number } | null;
  llmEnabled: { enabled: boolean };
  llmModel: { model: string; provider: string };
  onUpdateSetting: (args: { key: string; value: Record<string, unknown> }) => void;
  onUpdateBudget: (args: { monthlyBudgetUsd: number; dailyBudgetUsd?: number | null }) => void;
  isPending: boolean;
}) {
  const [monthlyInput, setMonthlyInput] = useState(String(budget.amount));
  const [dailyInput, setDailyInput] = useState(dailyBudget ? String(dailyBudget.amount) : '');
  const [budgetError, setBudgetError] = useState<string | null>(null);

  const costUsd = usage?.estimatedCostUsd ?? 0;
  const budgetUsd = usage?.budgetUsd ?? budget.amount;
  const utilization = budgetUsd > 0 ? (costUsd / budgetUsd) * 100 : 0;
  const barColor = utilization < 60 ? 'bg-green-500' : utilization < 85 ? 'bg-yellow-500' : 'bg-red-500';
  const avgCost = (usage?.requestCount ?? 0) > 0 ? costUsd / usage!.requestCount : 0;

  const handleSaveBudget = () => {
    setBudgetError(null);
    const monthly = Number(monthlyInput);
    if (!Number.isFinite(monthly) || monthly < 0 || monthly > 100000) {
      setBudgetError('Monthly budget must be a number between 0 and 100,000.');
      return;
    }

    let daily: number | null | undefined;
    const trimmed = dailyInput.trim();
    if (trimmed === '') {
      daily = null;
    } else {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100000) {
        setBudgetError('Daily budget must be a number between 0 and 100,000, or blank.');
        return;
      }
      daily = parsed;
    }

    onUpdateBudget({ monthlyBudgetUsd: monthly, dailyBudgetUsd: daily });
  };

  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">API Usage & Budget</h2>

      {/* Budget bar */}
      <div className="mb-4">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-2xl font-bold">${costUsd.toFixed(2)}</span>
          <span className="text-sm text-gray-500">/ ${budgetUsd.toFixed(2)} this month</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-gray-200">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(utilization, 100)}%` }} />
        </div>
        <p className="mt-1 text-xs text-gray-500">{utilization.toFixed(1)}% utilized</p>
      </div>

      {/* Stats row */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MiniStat label="Total Requests" value={String(usage?.requestCount ?? 0)} />
        <MiniStat label="Tokens In" value={formatNumber(usage?.tokensIn ?? 0)} />
        <MiniStat label="Tokens Out" value={formatNumber(usage?.tokensOut ?? 0)} />
        <MiniStat label="Avg Cost/Request" value={`$${avgCost.toFixed(4)}`} />
      </div>

      {/* Monthly usage chart (simple bar chart) */}
      {history && history.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-2 text-sm font-medium text-gray-700">Monthly Usage (last 6 months)</h3>
          <div className="flex items-end gap-2" style={{ height: 120 }}>
            {history.slice(0, 6).reverse().map((m) => {
              const maxCost = Math.max(...history.slice(0, 6).map((h) => h.estimatedCostUsd), 1);
              const height = maxCost > 0 ? (m.estimatedCostUsd / maxCost) * 100 : 0;
              return (
                <div key={m.month} className="flex flex-1 flex-col items-center">
                  <span className="mb-1 text-xs text-gray-500">${m.estimatedCostUsd.toFixed(0)}</span>
                  <div className="w-full rounded-t bg-blue-400" style={{ height: `${Math.max(height, 2)}%` }} />
                  <span className="mt-1 text-xs text-gray-400">{m.month.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Budget inputs (§7.2 — monthly required, daily optional) */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Monthly Budget Limit (USD)</label>
          <input
            type="number"
            min={0}
            max={100000}
            step={1}
            value={monthlyInput}
            onChange={(e) => setMonthlyInput(e.target.value)}
            className="w-32 rounded-md border px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Daily Budget Limit (USD) <span className="text-gray-400">— optional</span>
          </label>
          <input
            type="number"
            min={0}
            max={100000}
            step={1}
            placeholder="leave blank for no daily cap"
            value={dailyInput}
            onChange={(e) => setDailyInput(e.target.value)}
            className="w-56 rounded-md border px-3 py-1.5 text-sm"
          />
        </div>
        <button
          onClick={handleSaveBudget}
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Save Budget
        </button>

        <div className="ml-auto flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700">Enable AI Features</label>
          <button
            onClick={() => onUpdateSetting({ key: 'llm_enabled', value: { enabled: !llmEnabled.enabled } })}
            disabled={isPending}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${llmEnabled.enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${llmEnabled.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>
      {budgetError && (
        <p className="mt-2 text-xs text-red-600">{budgetError}</p>
      )}
      {dailyBudget && (
        <p className="mt-2 text-xs text-gray-500">
          Current daily cap: <span className="font-medium">${dailyBudget.amount.toFixed(2)}</span>. Clear the
          daily input and click Save to remove the cap.
        </p>
      )}

      {/* Model selector */}
      <div className="mt-4">
        <label className="mb-1 block text-sm font-medium text-gray-700">AI Model</label>
        <select
          value={llmModel.model}
          onChange={(e) => onUpdateSetting({ key: 'llm_model', value: { model: e.target.value, provider: 'openai' } })}
          disabled={isPending}
          className="rounded-md border px-3 py-1.5 text-sm"
        >
          {AVAILABLE_MODELS.map((m) => (
            <option key={m.model} value={m.model}>
              {m.label} — {m.price}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ---- Section 2: Ingestion Window (§7.3) ----

function IngestionWindowSection({
  window,
  onUpdateWindow,
  isPending,
}: {
  window: { startLocal: string; stopLocal: string; timezone: string } | null;
  onUpdateWindow: (input: { startLocal: string; stopLocal: string; timezone: string }) => void;
  isPending: boolean;
}) {
  const [startLocal, setStartLocal] = useState(window?.startLocal ?? '02:00');
  const [stopLocal, setStopLocal] = useState(window?.stopLocal ?? '06:00');
  const [timezone, setTimezone] = useState<string>(
    window?.timezone ?? INGESTION_WINDOW_TIMEZONES[0],
  );
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    setError(null);
    if (!HH_MM_REGEX.test(startLocal)) {
      setError('Start time must be in 24-hour HH:MM format (e.g. 02:00).');
      return;
    }
    if (!HH_MM_REGEX.test(stopLocal)) {
      setError('Stop time must be in 24-hour HH:MM format (e.g. 06:00).');
      return;
    }
    if (!(INGESTION_WINDOW_TIMEZONES as readonly string[]).includes(timezone)) {
      setError(`Timezone must be one of: ${INGESTION_WINDOW_TIMEZONES.join(', ')}.`);
      return;
    }
    onUpdateWindow({ startLocal, stopLocal, timezone });
  };

  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold">Ingestion Wall-Clock Window</h2>
      <p className="mb-4 text-xs text-gray-500">
        Restrict automatic ingestion to a daily wall-clock window. Scheduled crawls outside this
        window will be deferred until the next in-window tick.
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Start (local)</label>
          <input
            type="time"
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
            className="w-32 rounded-md border px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Stop (local)</label>
          <input
            type="time"
            value={stopLocal}
            onChange={(e) => setStopLocal(e.target.value)}
            className="w-32 rounded-md border px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Timezone</label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            {INGESTION_WINDOW_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={handleSave}
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Save Window
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {window && (
        <p className="mt-3 text-xs text-gray-500">
          Active:{' '}
          <span className="font-medium">
            {window.startLocal}–{window.stopLocal} {window.timezone}
          </span>
        </p>
      )}
    </div>
  );
}

// ---- Section 3: Ingestion Schedule ----

function IngestionScheduleSection({
  schedule,
  onUpdateSchedule,
  onRunNow,
  isRunning,
  isPending,
}: {
  schedule: { enabled: boolean; schedules: { sourceKey: string; cron: string; enabled: boolean }[] };
  onUpdateSchedule: (value: Record<string, unknown>) => void;
  onRunNow: (sourceId: string) => void;
  isRunning: boolean;
  isPending: boolean;
}) {
  const [localSchedules, setLocalSchedules] = useState(schedule.schedules);
  const [globalEnabled, setGlobalEnabled] = useState(schedule.enabled);

  const handleSave = () => {
    onUpdateSchedule({ enabled: globalEnabled, schedules: localSchedules });
  };

  const updateCron = (idx: number, cron: string) => {
    const updated = [...localSchedules];
    updated[idx] = { ...updated[idx], cron };
    setLocalSchedules(updated);
  };

  const toggleSource = (idx: number) => {
    const updated = [...localSchedules];
    updated[idx] = { ...updated[idx], enabled: !updated[idx].enabled };
    setLocalSchedules(updated);
  };

  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Ingestion Schedule</h2>
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700">Enable Automatic Ingestion</label>
          <button
            onClick={() => setGlobalEnabled(!globalEnabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${globalEnabled ? 'bg-blue-600' : 'bg-gray-300'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${globalEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="pb-2 pr-4 font-medium">Source</th>
              <th className="pb-2 pr-4 font-medium">Schedule (Cron)</th>
              <th className="pb-2 pr-4 font-medium">Enabled</th>
              <th className="pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {localSchedules.map((entry, idx) => (
              <tr key={entry.sourceKey} className="border-b">
                <td className="py-3 pr-4 font-medium">{formatSourceKey(entry.sourceKey)}</td>
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={entry.cron}
                      onChange={(e) => updateCron(idx, e.target.value)}
                      className="w-32 rounded border px-2 py-1 font-mono text-xs"
                    />
                    <span className="text-xs text-gray-400">{describeCron(entry.cron)}</span>
                  </div>
                  <div className="mt-1 flex gap-1">
                    {CRON_PRESETS.map((preset) => (
                      <button
                        key={preset.cron}
                        onClick={() => updateCron(idx, preset.cron)}
                        className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-200"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </td>
                <td className="py-3 pr-4">
                  <button
                    onClick={() => toggleSource(idx)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${entry.enabled ? 'bg-green-500' : 'bg-gray-300'}`}
                  >
                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${entry.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </td>
                <td className="py-3">
                  <button
                    onClick={() => onRunNow(entry.sourceKey)}
                    disabled={isRunning}
                    className="rounded bg-gray-100 px-3 py-1 text-xs font-medium hover:bg-gray-200 disabled:opacity-50"
                  >
                    Run Now
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-amber-600">
          Ingestion triggers AI digest generation which counts toward your monthly API budget.
        </p>
        <button
          onClick={handleSave}
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Save Schedule
        </button>
      </div>
    </div>
  );
}

// ---- Section 4: Configuration Summary ----

function ConfigSummarySection({
  model,
  budget,
  dailyBudget,
  enabled,
  ingestionEnabled,
  ingestionWindow,
}: {
  model: { model: string; provider: string };
  budget: { amount: number };
  dailyBudget: { amount: number } | null;
  enabled: boolean;
  ingestionEnabled: boolean;
  ingestionWindow: { startLocal: string; stopLocal: string; timezone: string } | null;
}) {
  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Configuration Summary</h2>
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-gray-500">Current Model</dt>
          <dd className="mt-0.5 font-medium">{model.model}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Provider</dt>
          <dd className="mt-0.5 font-medium capitalize">{model.provider}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Monthly Budget</dt>
          <dd className="mt-0.5 font-medium">${budget.amount}/month</dd>
        </div>
        <div>
          <dt className="text-gray-500">Daily Budget</dt>
          <dd className="mt-0.5 font-medium">
            {dailyBudget ? `$${dailyBudget.amount}/day` : <span className="text-gray-400">not set</span>}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">AI Features</dt>
          <dd className={`mt-0.5 font-medium ${enabled ? 'text-green-600' : 'text-red-600'}`}>
            {enabled ? 'Enabled' : 'Disabled'}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Auto Ingestion</dt>
          <dd className={`mt-0.5 font-medium ${ingestionEnabled ? 'text-green-600' : 'text-gray-400'}`}>
            {ingestionEnabled ? 'Enabled' : 'Disabled'}
          </dd>
        </div>
        <div className="sm:col-span-3">
          <dt className="text-gray-500">Ingestion Window</dt>
          <dd className="mt-0.5 font-medium">
            {ingestionWindow
              ? `${ingestionWindow.startLocal}–${ingestionWindow.stopLocal} ${ingestionWindow.timezone}`
              : <span className="text-gray-400">not set (crawls run whenever scheduled)</span>}
          </dd>
        </div>
      </dl>
    </div>
  );
}

// ---- Utility Components ----

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold">{value}</p>
    </div>
  );
}

// ---- Helpers ----

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatSourceKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return '';

  const [minute, hour, , , dayOfWeek] = parts;

  if (dayOfWeek !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `Weekly on ${days[Number(dayOfWeek)] ?? dayOfWeek} at ${hour}:${minute.padStart(2, '0')}`;
  }

  if (hour.startsWith('*/')) {
    return `Every ${hour.slice(2)} hours`;
  }

  if (hour !== '*' && minute !== '*') {
    return `Daily at ${hour}:${minute.padStart(2, '0')}`;
  }

  return cron;
}
