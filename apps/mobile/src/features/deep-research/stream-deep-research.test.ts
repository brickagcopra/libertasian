import { fetch as expoFetch } from 'expo/fetch';

import { apiClient } from '../../lib/api-client';
import { authStorage } from '../../storage/auth-storage';
import { refusalToEvent, SseFrameBuffer, streamDeepResearch } from './stream-deep-research';
import type { DeepResearchEvent } from './types';

jest.mock('../../storage/auth-storage', () => ({
  authStorage: {
    getAccessToken: jest.fn().mockResolvedValue('token-1'),
    getRefreshToken: jest.fn(),
    setAccessToken: jest.fn(),
    setRefreshToken: jest.fn(),
  },
}));

const mockFetch = expoFetch as jest.MockedFunction<typeof expoFetch>;

function frame(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/** A 200 whose body is delivered as a ReadableStream-like reader in chunks. */
function streamed(chunks: string[]) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    status: 200,
    ok: true,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: encoder.encode(chunks[i++]) }
            : { done: true, value: undefined },
      }),
    },
  } as never;
}

function refused(status: number, body: unknown) {
  return { status, ok: false, body: null, json: async () => body } as never;
}

async function collect(): Promise<DeepResearchEvent[]> {
  const events: DeepResearchEvent[] = [];
  await streamDeepResearch({ question: 'What is estoppel?' }, (e) => events.push(e), new AbortController().signal);
  return events;
}

beforeEach(() => {
  jest.clearAllMocks();
  (authStorage.getAccessToken as jest.Mock).mockResolvedValue('token-1');
});

describe('SseFrameBuffer', () => {
  it('reassembles frames split across chunks and handles CRLF', () => {
    const buf = new SseFrameBuffer();
    expect(buf.push('event: stage\r\ndata: {"stage":')).toEqual([]);
    expect(buf.push('"planning"}\r\n\r\nevent: plan\ndata: {"subQueries":[]}\n\n')).toEqual([
      { event: 'stage', data: '{"stage":"planning"}' },
      { event: 'plan', data: '{"subQueries":[]}' },
    ]);
  });

  it('skips comments and flushes an unterminated trailing frame', () => {
    const buf = new SseFrameBuffer();
    expect(buf.push(': keep-alive\n\nevent: done\ndata: {}')).toEqual([]);
    expect(buf.flush()).toEqual([{ event: 'done', data: '{}' }]);
  });
});

describe('streamDeepResearch', () => {
  it('POSTs the question with the bearer token and delivers validated events', async () => {
    mockFetch.mockResolvedValueOnce(
      streamed([
        frame('stage', { stage: 'planning' }),
        frame('plan', { subQueries: ['a'] }).slice(0, 10),
        frame('plan', { subQueries: ['a'] }).slice(10),
        frame('stage', { stage: 'dreaming' }), // fails zod → dropped
        frame('done', { runId: 'r1', modelName: null, promptTemplateVersion: null, latencyMs: 5, costUsd: 0 }),
      ]),
    );

    const events = await collect();

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toMatch(/\/deep-research\/stream$/);
    expect((init as { method: string }).method).toBe('POST');
    expect(JSON.parse((init as { body: string }).body)).toEqual({ question: 'What is estoppel?' });
    expect((init as { headers: Record<string, string> }).headers['Authorization']).toBe('Bearer token-1');
    expect(events.map((e) => e.type)).toEqual(['stage', 'plan', 'done']);
  });

  it('never retries: one POST per run even when the server fails', async () => {
    mockFetch.mockResolvedValueOnce(refused(503, { message: 'down' }));
    const events = await collect();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      { type: 'error', data: { code: 'internal', message: 'Request failed with status 503' } },
    ]);
  });

  it('maps a 402 to subscription_required, reading code not error', async () => {
    // The global exception filter overwrites `error`; `code` survives.
    mockFetch.mockResolvedValueOnce(
      refused(402, { error: 'Payment Required', code: 'subscription_required', message: 'x' }),
    );
    const events = await collect();
    expect(events[0]).toMatchObject({ type: 'error', data: { code: 'subscription_required' } });
  });

  it('maps a 429 quota_exceeded with its reset date', async () => {
    mockFetch.mockResolvedValueOnce(
      refused(429, {
        error: 'Too Many Requests',
        code: 'quota_exceeded',
        resetAt: '2026-10-01T00:00:00.000Z',
      }),
    );
    const events = await collect();
    expect(events[0]).toEqual({
      type: 'error',
      data: { code: 'quota_exceeded', message: '', resetAt: '2026-10-01T00:00:00.000Z' },
    });
  });

  it('emits exactly one terminal event and synthesizes one if the stream just closes', async () => {
    mockFetch.mockResolvedValueOnce(streamed([frame('stage', { stage: 'planning' })]));
    const events = await collect();
    expect(events.map((e) => e.type)).toEqual(['stage', 'error']);
  });

  it('forwards an in-stream budget_exhausted error', async () => {
    mockFetch.mockResolvedValueOnce(
      streamed([frame('error', { code: 'budget_exhausted', message: 'spent' })]),
    );
    const events = await collect();
    expect(events).toEqual([{ type: 'error', data: { code: 'budget_exhausted', message: 'spent' } }]);
  });

  it('refreshes once on 401 through apiClient, then resends', async () => {
    const refresh = jest.spyOn(apiClient, 'attemptRefresh').mockResolvedValueOnce(true);
    mockFetch
      .mockResolvedValueOnce(refused(401, {}))
      .mockResolvedValueOnce(streamed([frame('done', { runId: 'r', modelName: null, promptTemplateVersion: null, latencyMs: 1, costUsd: 0 })]));
    const events = await collect();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(events.map((e) => e.type)).toEqual(['done']);
    refresh.mockRestore();
  });

  it('is silent when aborted', async () => {
    const controller = new AbortController();
    mockFetch.mockImplementationOnce(async () => {
      controller.abort();
      throw new Error('aborted natively');
    });
    const onEvent = jest.fn();
    await streamDeepResearch({ question: 'q?' }, onEvent, controller.signal);
    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe('refusalToEvent', () => {
  it('does not dress the hourly throttle 429 up as a monthly exhaustion', () => {
    expect(refusalToEvent(429, { message: 'ThrottlerException' })).toMatchObject({
      data: { code: 'internal' },
    });
  });
});
