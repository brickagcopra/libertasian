import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The AI-settings read hooks against real enveloped controller responses.
 * Companion to `use-budget.test.ts` — same failure, same shape of guard.
 */

const mockGet = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

type QueryFn = () => Promise<unknown>;

vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: { queryFn: QueryFn }) => opts,
  useMutation: (opts: unknown) => opts,
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import {
  useAiSettings,
  useAiUsage,
  useAiUsageHistory,
} from './use-ai-settings';

const USAGE = {
  tokensIn: 1_200_000,
  tokensOut: 340_000,
  requestCount: 812,
  estimatedCostUsd: 57.04,
  budgetUsd: 100,
  budgetRemainingUsd: 42.96,
  utilizationPercent: 57.04,
  month: '2026-09',
};

function run(hook: () => unknown): Promise<unknown> {
  return (hook() as { queryFn: QueryFn }).queryFn();
}

beforeEach(() => {
  mockGet.mockReset();
});

describe('use-ai-settings read hooks', () => {
  it('useAiSettings returns the settings array out of the envelope', async () => {
    const settings = [
      {
        key: 'llm.monthly_budget',
        value: { amount: 100 },
        description: null,
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ];
    mockGet.mockResolvedValue({ success: true, data: settings });

    const result = (await run(useAiSettings)) as typeof settings;

    expect(mockGet).toHaveBeenCalledWith('/admin/ai-settings');
    expect(result).toHaveLength(1);
    expect(result[0]?.key).toBe('llm.monthly_budget');
  });

  it('useAiUsage returns the usage summary fields', async () => {
    mockGet.mockResolvedValue({ success: true, data: USAGE });

    const result = (await run(useAiUsage)) as typeof USAGE;

    expect(mockGet).toHaveBeenCalledWith('/admin/ai-settings/usage/current');
    expect(result.estimatedCostUsd).toBe(57.04);
    expect(result.budgetRemainingUsd).toBe(42.96);
    expect(result.month).toBe('2026-09');
  });

  it('useAiUsageHistory returns the month rows', async () => {
    mockGet.mockResolvedValue({ success: true, data: [USAGE] });

    const result = (await run(useAiUsageHistory)) as (typeof USAGE)[];

    expect(mockGet).toHaveBeenCalledWith(
      '/admin/ai-settings/usage/history?months=12',
    );
    expect(result[0]?.tokensIn).toBe(1_200_000);
  });

  it('yields undefined when the API returns a bare payload', async () => {
    mockGet.mockResolvedValue(USAGE);
    expect(await run(useAiUsage)).toBeUndefined();
  });
});
