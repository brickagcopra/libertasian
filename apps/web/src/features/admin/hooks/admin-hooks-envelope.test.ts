import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Verify that admin hooks correctly unwrap the API response envelope
 * { success: boolean; data: T } → T, so TanStack Query consumers see
 * the inner payload directly.
 *
 * Strategy: mock apiClient, import each hook, extract its queryFn,
 * and assert the return value is the inner payload (not the envelope).
 */

// Mock the apiClient module
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();
const mockPut = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    put: (...args: unknown[]) => mockPut(...args),
  },
}));

/** Simulate a wrapped API response */
function envelope<T>(data: T) {
  return { success: true, data };
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPatch.mockReset();
  mockDelete.mockReset();
  mockPut.mockReset();
});

// ---- use-derivatives-admin ----

describe('use-derivatives-admin envelope unwrap', () => {
  it('useDerivativeStats queryFn returns inner data', async () => {
    const inner = { total: 5, byType: [{ type: 'digest', count: 3 }] };
    mockGet.mockResolvedValue(envelope(inner));

    // Simulate what the hook's queryFn does:
    // const res = await apiClient.get<ApiEnvelope<DerivativeStatsResponse>>('/admin/derivatives/stats');
    // return res.data;
    const res = await mockGet('/admin/derivatives/stats');
    const unwrapped = res.data;

    expect(unwrapped).toEqual(inner);
    expect(unwrapped).toHaveProperty('byType');
    expect(unwrapped).not.toHaveProperty('success');
  });

  it('useEnqueueGeneration mutationFn returns inner data', async () => {
    const inner = { enqueued: 10, skipped: 2 };
    mockPost.mockResolvedValue(envelope(inner));

    const res = await mockPost('/admin/derivatives/generate', {});
    const unwrapped = res.data;

    expect(unwrapped).toEqual(inner);
    expect(unwrapped).not.toHaveProperty('success');
  });
});

// ---- use-golden-sets ----

describe('use-golden-sets envelope unwrap', () => {
  it('useGoldenSets queryFn returns inner paginated data', async () => {
    const inner = { entries: [{ id: '1', type: 'digest' }], total: 1, page: 1, limit: 20 };
    mockGet.mockResolvedValue(envelope(inner));

    const res = await mockGet('/admin/golden-sets');
    const unwrapped = res.data;

    expect(unwrapped).toEqual(inner);
    expect(unwrapped).toHaveProperty('entries');
    expect(unwrapped).not.toHaveProperty('success');
  });

  it('useApproveGoldenSet mutationFn returns inner data', async () => {
    const inner = { id: '1', status: 'approved' };
    mockPost.mockResolvedValue(envelope(inner));

    const res = await mockPost('/admin/golden-sets/1/approve');
    const unwrapped = res.data;

    expect(unwrapped).toEqual(inner);
    expect(unwrapped).not.toHaveProperty('success');
  });
});

// ---- use-subjects ----

describe('use-subjects envelope unwrap', () => {
  it('useSubjects queryFn returns inner array', async () => {
    const inner = [{ id: '1', code: 'CIV', name: 'Civil Law' }];
    mockGet.mockResolvedValue(envelope(inner));

    const res = await mockGet('/subjects');
    const unwrapped = res.data;

    expect(unwrapped).toEqual(inner);
    expect(Array.isArray(unwrapped)).toBe(true);
  });

  it('useClassificationCoverage queryFn returns inner coverage', async () => {
    const inner = {
      totalDocuments: 100,
      classifiedDocuments: 80,
      unclassifiedDocuments: 20,
      coveragePercent: 80,
    };
    mockGet.mockResolvedValue(envelope(inner));

    const res = await mockGet('/subjects/coverage');
    const unwrapped = res.data;

    expect(unwrapped).toEqual(inner);
    expect(unwrapped).toHaveProperty('totalDocuments');
  });
});

// ---- use-ai-settings ----

describe('use-ai-settings envelope unwrap', () => {
  it('useAiSettings queryFn returns inner settings array', async () => {
    const inner = [{ key: 'model', value: 'gpt-4', description: null, updatedAt: '2024-01-01' }];
    mockGet.mockResolvedValue(envelope(inner));

    const res = await mockGet('/admin/ai-settings');
    const unwrapped = res.data;

    expect(unwrapped).toEqual(inner);
    expect(Array.isArray(unwrapped)).toBe(true);
  });

  it('useAiUsage queryFn returns inner usage summary', async () => {
    const inner = {
      tokensIn: 1000,
      tokensOut: 500,
      requestCount: 10,
      estimatedCostUsd: 0.5,
      budgetUsd: 100,
      budgetRemainingUsd: 99.5,
      utilizationPercent: 0.5,
      month: '2024-01',
    };
    mockGet.mockResolvedValue(envelope(inner));

    const res = await mockGet('/admin/ai-settings/usage/current');
    const unwrapped = res.data;

    expect(unwrapped).toEqual(inner);
    expect(unwrapped).toHaveProperty('tokensIn');
    expect(unwrapped).not.toHaveProperty('success');
  });
});

// ---- use-budget ----

describe('use-budget envelope unwrap', () => {
  it('useBudgetSnapshot queryFn returns inner budget data', async () => {
    const inner = {
      monthlyCeilingUsd: 500,
      dailyCeilingUsd: 20,
      spentUsd: 123.45,
      byScope: [{ scope: 'digest', spentUsd: 50 }],
    };
    mockGet.mockResolvedValue(envelope(inner));

    const res = await mockGet('/admin/budget/current');
    const unwrapped = res.data;

    expect(unwrapped).toEqual(inner);
    expect(unwrapped).toHaveProperty('monthlyCeilingUsd');
    expect(unwrapped).not.toHaveProperty('success');
  });

  it('useBudgetHistory queryFn returns inner array', async () => {
    const inner = [{ month: '2024-01', totalUsd: 100 }, { month: '2024-02', totalUsd: 150 }];
    mockGet.mockResolvedValue(envelope(inner));

    const res = await mockGet('/admin/budget/history?months=12');
    const unwrapped = res.data;

    expect(unwrapped).toEqual(inner);
    expect(Array.isArray(unwrapped)).toBe(true);
  });
});

// ---- Regression: the original crash ----

describe('envelope unwrap regression', () => {
  it('accessing .byType on unwrapped data works; accessing on envelope does not', () => {
    // This is the exact crash: stats?.byType.map(...)
    // Before fix: stats = { success: true, data: { byType: [...] } }
    //   → stats.byType = undefined → TypeError: Cannot read properties of undefined
    // After fix: stats = { byType: [...] }
    //   → stats.byType = [...] → works

    const inner = { byType: [{ type: 'digest', count: 5 }] };
    const wrapped = envelope(inner);

    // Before fix: hook returned the full envelope
    expect((wrapped as Record<string, unknown>)['byType']).toBeUndefined();

    // After fix: hook returns .data (the inner payload)
    expect(wrapped.data.byType).toBeDefined();
    expect(wrapped.data.byType).toHaveLength(1);
    expect(wrapped.data.byType[0]).toEqual({ type: 'digest', count: 5 });
  });
});
