import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * These hooks against a REAL enveloped payload.
 *
 * `admin-hooks-envelope.test.ts` asserts the unwrap shape by hand and never
 * imports a hook, so it stayed green while the API returned a bare payload
 * and `res.data` was `undefined` — the Budget page showed a $0 ceiling and
 * an empty table with every test passing. These tests call the hooks'
 * actual `queryFn` against what the controller actually returns.
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

import { useBudgetSnapshot, useBudgetHistory } from './use-budget';

type QueryFn = () => Promise<unknown>;

// `useQuery` is mocked to hand us back the options it was called with, so
// the queryFn under test is the one the hook really ships.
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: { queryFn: QueryFn }) => opts,
  useMutation: (opts: unknown) => opts,
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

/** The exact body `GET /admin/budget/current` returns. */
const CURRENT_RESPONSE = {
  success: true,
  data: {
    snapshot: {
      month: '2026-09',
      day: '2026-09-12',
      monthlyCeiling: 50,
      dailyCeiling: 5,
      monthSpend: 12.34,
      daySpend: 0.75,
      monthUtilizationPercent: 24.68,
      dayUtilizationPercent: 15,
    },
    byScope: [
      {
        scope: 'mcq_generation',
        totalAmountUsd: 35.65,
        totalTokensIn: 1000,
        totalTokensOut: 500,
        totalRequests: 10,
      },
    ],
    scopeBudgets: [
      {
        scope: 'mcq_question',
        monthlyUsd: 20,
        dailyUsd: null,
        monthSpend: 35.65,
        daySpend: 0,
        monthRemaining: 0,
        stopped: true,
      },
    ],
  },
};

beforeEach(() => {
  mockGet.mockReset();
});

describe('useBudgetSnapshot', () => {
  it('returns the snapshot fields from an enveloped controller response', async () => {
    mockGet.mockResolvedValue(CURRENT_RESPONSE);

    const result = (await (
      useBudgetSnapshot() as unknown as { queryFn: QueryFn }
    ).queryFn()) as (typeof CURRENT_RESPONSE)['data'];

    expect(mockGet).toHaveBeenCalledWith('/admin/budget/current');
    // The exact fields the page reads. A bare (unwrapped) API response
    // makes every one of these `undefined`.
    expect(result.snapshot.monthlyCeiling).toBe(50);
    expect(result.snapshot.monthSpend).toBe(12.34);
    expect(result.snapshot.dailyCeiling).toBe(5);
    expect(result.byScope).toHaveLength(1);
    expect(result.scopeBudgets[0]?.scope).toBe('mcq_question');
  });

  it('is undefined — visibly broken — if the API stops enveloping', async () => {
    // Guards the contract in the other direction: api-client does no
    // unwrapping of its own, so a bare payload cannot work here.
    mockGet.mockResolvedValue(CURRENT_RESPONSE.data);

    const result = await (
      useBudgetSnapshot() as unknown as { queryFn: QueryFn }
    ).queryFn();

    expect(result).toBeUndefined();
  });
});

describe('useBudgetHistory', () => {
  it('returns the ledger rows from an enveloped controller response', async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: [
        {
          periodYearMonth: '2026-09',
          totalAmountUsd: 57.04,
          totalTokensIn: 9,
          totalTokensOut: 8,
          totalRequests: 7,
        },
      ],
    });

    const result = (await (
      useBudgetHistory() as unknown as { queryFn: QueryFn }
    ).queryFn()) as Array<{ periodYearMonth: string; totalAmountUsd: number }>;

    expect(mockGet).toHaveBeenCalledWith('/admin/budget/history?months=12');
    expect(result).toHaveLength(1);
    expect(result[0]?.periodYearMonth).toBe('2026-09');
    expect(result[0]?.totalAmountUsd).toBe(57.04);
  });
});
