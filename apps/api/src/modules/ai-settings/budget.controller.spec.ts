import { BudgetController } from './budget.controller';
import { AiSettingsController } from './ai-settings.controller';

/**
 * Every admin read route answers with `{ success: true, data }`.
 *
 * The web api-client does no unwrapping — `apiClient.get` is a plain
 * `response.json()` — while every admin hook returns `res.data`. A bare
 * payload therefore reaches the page as `undefined`, which is exactly how
 * the Budget page came to show a $0 ceiling and empty tables. These specs
 * pin the envelope on each route so that cannot regress silently.
 */

const SNAPSHOT = {
  month: '2026-09',
  day: '2026-09-12',
  monthlyCeiling: 50,
  dailyCeiling: 5,
  monthSpend: 12.34,
  daySpend: 0.75,
  monthUtilizationPercent: 24.68,
  dayUtilizationPercent: 15,
};

function makeAiSettings() {
  return {
    getBudgetSnapshot: jest.fn().mockResolvedValue(SNAPSHOT),
    getLedgerByScope: jest.fn().mockResolvedValue([{ scope: 'mcq_generation' }]),
    getScopeBudgetStatus: jest.fn().mockResolvedValue([{ scope: 'mcq_question' }]),
    getLedgerHistory: jest.fn().mockResolvedValue([{ periodYearMonth: '2026-09' }]),
    getAllSettings: jest.fn().mockResolvedValue([{ key: 'llm.monthly_budget' }]),
    getSetting: jest.fn().mockResolvedValue({ key: 'llm.monthly_budget' }),
    getUsageSummary: jest.fn().mockResolvedValue({ month: '2026-09' }),
    getUsageHistory: jest.fn().mockResolvedValue([{ month: '2026-09' }]),
  };
}

describe('BudgetController response envelope', () => {
  let aiSettings: ReturnType<typeof makeAiSettings>;
  let controller: BudgetController;

  beforeEach(() => {
    aiSettings = makeAiSettings();
    controller = new BudgetController(aiSettings as never);
  });

  it('GET /admin/budget/current wraps the snapshot', async () => {
    const res = await controller.getCurrent();

    expect(res.success).toBe(true);
    expect(res.data.snapshot).toEqual(SNAPSHOT);
    expect(res.data.byScope).toHaveLength(1);
    expect(res.data.scopeBudgets).toHaveLength(1);
    // The payload must NOT be reachable at the top level: that is the
    // shape the web hooks cannot read.
    expect((res as Record<string, unknown>)['snapshot']).toBeUndefined();
  });

  it('GET /admin/budget/history wraps the ledger rows', async () => {
    const res = await controller.getHistory('6');

    expect(res.success).toBe(true);
    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data[0]).toEqual({ periodYearMonth: '2026-09' });
    expect(aiSettings.getLedgerHistory).toHaveBeenCalledWith(6);
  });

  it('clamps the history window', async () => {
    await controller.getHistory('999');
    expect(aiSettings.getLedgerHistory).toHaveBeenCalledWith(24);
  });
});

describe('AiSettingsController response envelope', () => {
  let aiSettings: ReturnType<typeof makeAiSettings>;
  let controller: AiSettingsController;

  beforeEach(() => {
    aiSettings = makeAiSettings();
    controller = new AiSettingsController(aiSettings as never);
  });

  it('GET /admin/ai-settings wraps the settings array', async () => {
    const res = await controller.getAll();

    expect(res.success).toBe(true);
    expect(res.data).toEqual([{ key: 'llm.monthly_budget' }]);
  });

  it('GET /admin/ai-settings/:key wraps the setting', async () => {
    const res = await controller.getOne('llm.monthly_budget');

    expect(res.success).toBe(true);
    expect(res.data).toEqual({ key: 'llm.monthly_budget' });
  });

  it('GET /admin/ai-settings/usage/current wraps the summary', async () => {
    const res = await controller.getUsageCurrent();

    expect(res.success).toBe(true);
    expect(res.data).toEqual({ month: '2026-09' });
    expect((res as Record<string, unknown>)['month']).toBeUndefined();
  });

  it('GET /admin/ai-settings/usage/history wraps the rows', async () => {
    const res = await controller.getUsageHistory();

    expect(res.success).toBe(true);
    expect(res.data).toEqual([{ month: '2026-09' }]);
    expect(aiSettings.getUsageHistory).toHaveBeenCalledWith(12);
  });
});
