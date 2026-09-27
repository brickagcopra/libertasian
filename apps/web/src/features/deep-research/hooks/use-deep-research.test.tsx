import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGet = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    delete: vi.fn(),
    refresh: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ accessToken: 'tok' }) },
}));

import { useDeepResearchRun, useDeepResearchRuns } from './use-deep-research-runs';
import { useDeepResearchStream } from './use-deep-research-stream';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function sse(chunks: string[]) {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) c.enqueue(enc.encode(chunks[i++]));
      else c.close();
    },
  });
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  mockGet.mockReset();
});

const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  question: 'Q?',
  status: 'completed',
  createdAt: '2026-09-01T00:00:00.000Z',
};

describe('useDeepResearchRuns / useDeepResearchRun envelopes', () => {
  it('pages through GET /deep-research using meta.nextCursor / hasMore', async () => {
    mockGet
      .mockResolvedValueOnce({ success: true, data: [ROW], meta: { nextCursor: ROW.id, hasMore: true } })
      .mockResolvedValueOnce({ success: true, data: [{ ...ROW, id: 'r2' }], meta: { nextCursor: null, hasMore: false } });
    const { result } = renderHook(() => useDeepResearchRuns(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0]?.items[0]?.question).toBe('Q?');
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(mockGet).toHaveBeenLastCalledWith('/deep-research', {
      params: { limit: '20', cursor: ROW.id },
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  });

  it('GET /deep-research/:id resolves body.data once', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: { ...ROW, resultJson: { summary: 'S', sections: [] }, sourcesJson: [] },
    });
    const { result } = renderHook(() => useDeepResearchRun(ROW.id), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.resultJson?.summary).toBe('S');
  });
});

describe('useDeepResearchStream', () => {
  it('parses a split SSE stream into a finished run', async () => {
    const frames = [
      'event: stage\ndata: {"stage":"planning"}\n\n',
      'event: plan\ndata: {"subQueries":["a","b"]}\n\nevent: sou',
      'rces\ndata: {"sources":[{"sourceId":"S1","documentId":"d","title":"T"}]}\n\n',
      'event: result\ndata: {"summary":"S","sections":[],"removedClaims":0,"abstained":false}\n\n',
      'event: done\ndata: {"runId":"r1","modelName":"m","promptTemplateVersion":"v","latencyMs":1,"costUsd":0}\n\n',
    ];
    global.fetch = vi.fn().mockResolvedValue(new Response(sse(frames), { status: 200 }));
    const { result } = renderHook(() => useDeepResearchStream(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.start('Q?');
    });
    expect(result.current.state.status).toBe('done');
    expect(result.current.state.subQueries).toEqual(['a', 'b']);
    expect(result.current.state.sources[0]?.title).toBe('T');
    expect(result.current.state.done?.runId).toBe('r1');
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/deep-research\/stream$/);
    expect(JSON.parse(init.body as string)).toEqual({ question: 'Q?' });
  });

  it('maps a 402 refusal to subscription_required and does not retry', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'subscription_required', error: 'PAYMENT_REQUIRED' }), {
        status: 402,
      }),
    );
    const { result } = renderHook(() => useDeepResearchStream(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.start('Q?');
    });
    expect(result.current.state.error?.code).toBe('subscription_required');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces an in-stream error event', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(sse(['event: error\ndata: {"code":"budget_exhausted","message":"later"}\n\n']), {
        status: 200,
      }),
    );
    const { result } = renderHook(() => useDeepResearchStream(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.start('Q?');
    });
    expect(result.current.state.error).toEqual({ code: 'budget_exhausted', message: 'later' });
  });
});
