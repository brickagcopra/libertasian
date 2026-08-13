import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ accessToken: 'test-token' })),
  },
}));

import { useAiAnswerStream } from './use-ai-answer-stream';

const originalFetch = global.fetch;

function createSSEStream(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

describe('useAiAnswerStream', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns initial idle state', () => {
    const { result } = renderHook(() => useAiAnswerStream(null, false));

    expect(result.current.text).toBe('');
    expect(result.current.sources).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.isDone).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.confidence).toBeNull();
    expect(result.current.abstained).toBe(false);
    expect(result.current.abstentionReason).toBeNull();
  });

  it('does not fetch when query is null', () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    renderHook(() => useAiAnswerStream(null, true));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not fetch when enabled is false', () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    renderHook(() => useAiAnswerStream('test query', false));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('starts streaming when query and enabled are set', async () => {
    const stream = createSSEStream([
      'data: {"type":"text","content":"Hello "}\n\n',
      'data: {"type":"text","content":"world"}\n\n',
      'data: {"type":"done","content":"","metadata":{"confidence":0.9,"confidence_level":"high","valid_citations":2,"total_citations":2}}\n\n',
    ]);

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { result } = renderHook(() => useAiAnswerStream('test', true));

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });

    expect(result.current.text).toBe('Hello world');
    expect(result.current.confidence).toBe(0.9);
    expect(result.current.isStreaming).toBe(false);
  });

  it('handles metadata chunks', async () => {
    const sources = [
      {
        document_id: 'doc-1',
        title: 'Test Case',
        relevance_score: 0.9,
        passage_text: 'Relevant passage',
      },
    ];

    const stream = createSSEStream([
      'data: {"type":"text","content":"Answer text"}\n\n',
      `data: {"type":"metadata","content":"","metadata":{"intent":"case_lookup","passages_used":8,"passages_available":8,"sources":${JSON.stringify(sources)},"confidence":0.85}}\n\n`,
      'data: {"type":"done"}\n\n',
    ]);

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { result } = renderHook(() => useAiAnswerStream('test', true));

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });

    expect(result.current.sources).toEqual(sources);
    expect(result.current.confidence).toBe(0.85);
  });

  it('handles abstention response', async () => {
    const stream = createSSEStream([
      'data: {"type":"done","content":"","metadata":{"abstained":true,"abstention_reason":"Insufficient sources","confidence":0.15,"sources":[]}}\n\n',
    ]);

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { result } = renderHook(() => useAiAnswerStream('obscure topic', true));

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });

    expect(result.current.abstained).toBe(true);
    expect(result.current.abstentionReason).toBe('Insufficient sources');
    expect(result.current.confidence).toBe(0.15);
  });

  it('reads sources and confidence from a nested metadata frame', async () => {
    // The real wire shape, dumped from prod: the rag-service nests every frame
    // payload under `metadata` and the NestJS gateway pipes it through verbatim.
    const sources = [
      {
        document_id: 'doc-1',
        title: 'People v. Dela Cruz',
        relevance_score: 0.91,
        passage_text: 'Bail is a matter of right...',
      },
    ];

    const stream = createSSEStream([
      `data: {"type":"metadata","content":"","metadata":{"intent":"case_lookup","passages_used":8,"passages_available":8,"sources":${JSON.stringify(sources)}}}\n\n`,
      'data: {"type":"text","content":"Bail is a right."}\n\n',
      'data: {"type":"done","content":"","metadata":{"confidence":0.77,"confidence_level":"medium","valid_citations":1,"total_citations":1}}\n\n',
    ]);

    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, body: stream });

    const { result } = renderHook(() => useAiAnswerStream('bail', true));

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });

    expect(result.current.sources).toEqual(sources);
    expect(result.current.confidence).toBe(0.77);
    expect(result.current.text).toBe('Bail is a right.');
  });

  it('replaces the streamed text when the terminal frame abstains', async () => {
    // Post-generation abstention (PR #372): the scoped answer produced no valid
    // citation, so the text already streamed is unsupported and the server's
    // replacement copy takes its place rather than being appended to it.
    const stream = createSSEStream([
      'data: {"type":"text","content":"The Code plainly allows this."}\n\n',
      'data: {"type":"done","content":"","metadata":{"abstained":true,"abstention_reason":"validation_failed","abstention_text":"This document does not address that question.","confidence":0.0,"confidence_level":"low","valid_citations":0,"total_citations":3}}\n\n',
    ]);

    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, body: stream });

    const { result } = renderHook(() => useAiAnswerStream('salvage', true));

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });

    expect(result.current.abstained).toBe(true);
    expect(result.current.abstentionReason).toBe('validation_failed');
    expect(result.current.text).toBe('This document does not address that question.');
    // The ungrounded answer must not survive anywhere in the rendered state.
    expect(result.current.text).not.toContain('plainly allows');
  });

  it('still parses a legacy flat frame through the fallback', async () => {
    // The non-streaming POST /ai-answers shape. Kept working so old fixtures and
    // any unmigrated producer still populate the panel.
    const stream = createSSEStream([
      'data: {"type":"metadata","sources":[{"document_id":"doc-9","title":"Art. III","relevance_score":0.5,"passage_text":"..."}]}\n\n',
      'data: {"type":"done","confidence":0.42,"abstained":false}\n\n',
    ]);

    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, body: stream });

    const { result } = renderHook(() => useAiAnswerStream('flat', true));

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });

    expect(result.current.sources[0]?.title).toBe('Art. III');
    expect(result.current.confidence).toBe(0.42);
  });

  it('handles error chunk from server', async () => {
    const stream = createSSEStream([
      'data: {"type":"error","message":"RAG service error"}\n\n',
    ]);

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { result } = renderHook(() => useAiAnswerStream('test', true));

    await waitFor(() => {
      expect(result.current.error).toBe('RAG service error');
    });

    expect(result.current.isStreaming).toBe(false);
  });

  it('handles 401 unauthorized', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      body: null,
    });

    const { result } = renderHook(() => useAiAnswerStream('test', true));

    await waitFor(() => {
      expect(result.current.error).toBe('Session expired. Please log in again.');
    });

    expect(result.current.isStreaming).toBe(false);
  });

  it('handles 403 quota exceeded', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: vi.fn().mockResolvedValue({ message: 'AI answer quota exceeded' }),
      body: null,
    });

    const { result } = renderHook(() => useAiAnswerStream('test', true));

    await waitFor(() => {
      expect(result.current.error).toBe('AI answer quota exceeded');
    });
  });

  it('handles non-retryable error response without body', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 422,
      body: null,
    });

    const { result } = renderHook(() => useAiAnswerStream('test', true));

    await waitFor(() => {
      expect(result.current.error).toBe('Request failed with status 422');
    });
  });

  it('sends Authorization header with token', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: createSSEStream(['data: {"type":"done"}\n\n']),
    });
    global.fetch = fetchSpy;

    renderHook(() => useAiAnswerStream('test', true));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/ai-answers/stream'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ query: 'test' }),
        }),
      );
    });
  });

  it('resets state via reset function', async () => {
    const stream = createSSEStream([
      'data: {"type":"text","content":"Some text"}\n\n',
      'data: {"type":"done","content":"","metadata":{"confidence":0.8}}\n\n',
    ]);

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { result } = renderHook(() => useAiAnswerStream('test', true));

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });

    expect(result.current.text).toBe('Some text');

    act(() => {
      result.current.reset();
    });

    expect(result.current.text).toBe('');
    expect(result.current.isDone).toBe(false);
    expect(result.current.confidence).toBeNull();
  });

  it('skips unparseable SSE chunks', async () => {
    const stream = createSSEStream([
      'data: invalid json\n\n',
      'data: {"type":"text","content":"Valid text"}\n\n',
      'data: {"type":"done"}\n\n',
    ]);

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { result } = renderHook(() => useAiAnswerStream('test', true));

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });

    expect(result.current.text).toBe('Valid text');
    expect(result.current.error).toBeNull();
  });

  it('marks as done when stream ends without done chunk', async () => {
    const stream = createSSEStream([
      'data: {"type":"text","content":"Partial text"}\n\n',
    ]);

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { result } = renderHook(() => useAiAnswerStream('test', true));

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });

    expect(result.current.text).toBe('Partial text');
  });

  it('retries on network error and succeeds', async () => {
    const stream = createSSEStream([
      'data: {"type":"text","content":"Recovered"}\n\n',
      'data: {"type":"done","content":"","metadata":{"confidence":0.9}}\n\n',
    ]);

    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: stream,
      });
    global.fetch = fetchSpy;

    const { result } = renderHook(() => useAiAnswerStream('retry-test', true));

    await waitFor(
      () => {
        expect(result.current.isDone).toBe(true);
      },
      { timeout: 10000 },
    );

    expect(result.current.text).toBe('Recovered');
    expect(result.current.confidence).toBe(0.9);
    expect(result.current.error).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries on 500 server error and succeeds', async () => {
    const stream = createSSEStream([
      'data: {"type":"text","content":"OK"}\n\n',
      'data: {"type":"done"}\n\n',
    ]);

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, body: null })
      .mockResolvedValueOnce({ ok: true, status: 200, body: stream });
    global.fetch = fetchSpy;

    const { result } = renderHook(() => useAiAnswerStream('server-error-test', true));

    await waitFor(
      () => {
        expect(result.current.isDone).toBe(true);
      },
      { timeout: 10000 },
    );

    expect(result.current.text).toBe('OK');
    expect(result.current.error).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('gives up after max retries on persistent network error', async () => {
    vi.useRealTimers(); // Use real timers for this test — delays are small with mocked Math.random

    const originalRandom = Math.random;
    Math.random = () => 0; // Remove jitter for predictable timing

    const fetchSpy = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'));
    global.fetch = fetchSpy;

    const { result } = renderHook(() => useAiAnswerStream('persistent-fail', true));

    await waitFor(
      () => {
        expect(result.current.error).toBeTruthy();
      },
      { timeout: 20000 },
    );

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBe('Failed to fetch');
    // 1 initial + 3 retries = 4
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    Math.random = originalRandom;
  }, 25000);

  it('does not retry 401 or 403 errors', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      body: null,
    });
    global.fetch = fetchSpy;

    const { result } = renderHook(() => useAiAnswerStream('no-retry-auth', true));

    await waitFor(() => {
      expect(result.current.error).toBe('Session expired. Please log in again.');
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('exposes retryCount in state', async () => {
    const stream = createSSEStream([
      'data: {"type":"done"}\n\n',
    ]);

    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: true, status: 200, body: stream });
    global.fetch = fetchSpy;

    const { result } = renderHook(() => useAiAnswerStream('retry-count-test', true));

    await waitFor(
      () => {
        expect(result.current.isDone).toBe(true);
      },
      { timeout: 10000 },
    );

    expect(result.current.retryCount).toBe(1);
  });
});
