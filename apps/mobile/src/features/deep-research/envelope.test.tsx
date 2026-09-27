import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import { apiClient } from '../../lib/api-client';
import { resolveRunDetail, resolveRunListPage } from './envelope';
import { useDeepResearchRun, useDeepResearchRuns } from './hooks/use-deep-research';

/**
 * Envelope resolution, pinned against the shapes the API ACTUALLY sends
 * (deep-research.controller.ts) after `apiClient`'s real unwrap rule.
 */

jest.mock('../../lib/api-client', () => {
  const actual = jest.requireActual('../../lib/api-client');
  return { ...actual, apiClient: { get: jest.fn(), delete: jest.fn() } };
});

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

const ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  question: 'What is estoppel?',
  status: 'completed',
  modelName: 'm',
  createdAt: '2026-09-01T00:00:00.000Z',
  latencyMs: 1000,
  costUsd: 0.01,
};

/** GET /deep-research: `{ success, data, meta }` — apiClient leaves it WRAPPED. */
const LIST_AS_RECEIVED = {
  success: true,
  data: [ROW],
  meta: { nextCursor: ROW.id, hasMore: true },
};

/** GET /deep-research/:id: `{ success, data }` — apiClient UNWRAPS it. */
const DETAIL_AS_RECEIVED = {
  ...ROW,
  organizationId: 'org',
  userId: 'u',
  resultJson: {
    summary: 's',
    sections: [],
    removedClaims: 0,
    abstained: false,
  },
  sourcesJson: [],
  subQueriesJson: ['q1'],
  promptTemplateVersion: 'v1',
  tokensIn: 1,
  tokensOut: 2,
};

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => jest.clearAllMocks());

describe('resolveRunListPage', () => {
  it('reads data + meta off the still-wrapped list envelope', () => {
    expect(resolveRunListPage(LIST_AS_RECEIVED)).toEqual({
      items: [ROW],
      nextCursor: ROW.id,
      hasMore: true,
    });
  });

  it('reads the API meta key hasMore, not the hasNext other lists use', () => {
    const page = resolveRunListPage({ success: true, data: [], meta: { hasNext: true, nextCursor: 'x' } });
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('tolerates a bare array and drops malformed rows', () => {
    expect(resolveRunListPage([ROW, { id: 7 }]).items).toEqual([ROW]);
  });

  it('throws on a shape it cannot read rather than rendering an empty history', () => {
    expect(() => resolveRunListPage({ success: true, data: ROW })).toThrow();
  });
});

describe('resolveRunDetail', () => {
  it('takes the already-unwrapped run as-is (no second .data)', () => {
    const run = resolveRunDetail(DETAIL_AS_RECEIVED);
    expect(run.id).toBe(ROW.id);
    expect(run.subQueriesJson).toEqual(['q1']);
  });

  it('still resolves if the envelope ever arrives wrapped', () => {
    expect(resolveRunDetail({ success: true, data: DETAIL_AS_RECEIVED }).id).toBe(ROW.id);
  });

  it('opens a run whose result never arrived', () => {
    const run = resolveRunDetail({ ...DETAIL_AS_RECEIVED, status: 'failed', resultJson: { junk: 1 } });
    expect(run.resultJson).toBeNull();
  });
});

describe('through the REAL apiClient unwrap rule', () => {
  // Not the mock above: the actual transport, fed the controller's raw bodies,
  // so a change to `unwrapEnvelope` shows up here instead of on a device.
  const realClient = (
    jest.requireActual('../../lib/api-client') as typeof import('../../lib/api-client')
  ).apiClient;
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  const respond = (body: unknown) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    }) as unknown as typeof fetch;
  };

  it('list: the raw { success, data, meta } body resolves to rows + cursor', async () => {
    respond({ success: true, data: [ROW], meta: { nextCursor: null, hasMore: false } });
    const page = resolveRunListPage(await realClient.get<unknown>('/deep-research'));
    expect(page.items.map((r) => r.id)).toEqual([ROW.id]);
  });

  it('detail: the raw { success, data } body resolves to the run', async () => {
    respond({ success: true, data: DETAIL_AS_RECEIVED });
    const run = resolveRunDetail(await realClient.get<unknown>(`/deep-research/${ROW.id}`));
    expect(run.id).toBe(ROW.id);
  });
});

describe('hooks resolve envelopes end to end', () => {
  it('useDeepResearchRuns flattens pages and paginates on meta.nextCursor', async () => {
    mockGet
      .mockResolvedValueOnce(LIST_AS_RECEIVED)
      .mockResolvedValueOnce({ success: true, data: [{ ...ROW, id: 'r2' }], meta: { nextCursor: null, hasMore: false } });

    const { result } = renderHook(() => useDeepResearchRuns(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((r) => r.id)).toEqual([ROW.id]);
    expect(mockGet).toHaveBeenCalledWith('/deep-research', { params: { limit: '20' } });

    expect(result.current.hasNextPage).toBe(true);
    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(mockGet).toHaveBeenLastCalledWith('/deep-research', {
      params: { limit: '20', cursor: ROW.id },
    });
    expect(result.current.hasNextPage).toBe(false);
  });

  it('useDeepResearchRun returns the run object, not undefined', async () => {
    mockGet.mockResolvedValueOnce(DETAIL_AS_RECEIVED);
    const { result } = renderHook(() => useDeepResearchRun(ROW.id), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.question).toBe('What is estoppel?');
    expect(mockGet).toHaveBeenCalledWith(`/deep-research/${ROW.id}`);
  });
});
