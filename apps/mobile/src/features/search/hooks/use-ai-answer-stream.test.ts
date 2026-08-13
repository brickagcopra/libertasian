import { renderHook, act, waitFor } from '@testing-library/react-native';

jest.mock('../../../storage/auth-storage', () => ({
  authStorage: {
    getAccessToken: jest.fn().mockResolvedValue('test-token'),
  },
}));

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { apiUrl: 'http://test-api/api/v1' } },
}));

// The transport is expo/fetch, not the RN global. Stubbing `global.fetch` here
// used to make every case pass against code that could never stream on a real
// device — RN's fetch is whatwg-fetch over XHR and has no `response.body` at all.
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

import { fetch as expoFetch } from 'expo/fetch';

import { useAiAnswerStream } from './use-ai-answer-stream';

const mockFetch = expoFetch as unknown as jest.Mock;

function createSSEStream(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]!));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

function okStream(chunks: string[], status = 200) {
  return { ok: true, status, body: createSSEStream(chunks) };
}

describe('useAiAnswerStream (mobile)', () => {
  afterEach(() => {
    mockFetch.mockReset();
    jest.restoreAllMocks();
  });

  it('returns initial idle state', () => {
    const { result } = renderHook(() => useAiAnswerStream(null, false));

    expect(result.current.text).toBe('');
    expect(result.current.sources).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.isDone).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not fetch when query is null', () => {
    renderHook(() => useAiAnswerStream(null, true));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not fetch when disabled', () => {
    renderHook(() => useAiAnswerStream('test query', false));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('starts streaming and processes chunks', async () => {
    mockFetch.mockResolvedValueOnce(
      okStream([
        'data: {"type":"text","content":"Hello "}\n\n',
        'data: {"type":"text","content":"world"}\n\n',
        'data: {"type":"done","confidence":0.9,"sources":[]}\n\n',
      ]),
    );

    const { result } = renderHook(() => useAiAnswerStream('test', true));

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });

    expect(result.current.text).toBe('Hello world');
    expect(result.current.confidence).toBe(0.9);
  });

  it('handles error chunk', async () => {
    mockFetch.mockResolvedValueOnce(
      okStream(['data: {"type":"error","message":"Service unavailable"}\n\n']),
    );

    const { result } = renderHook(() => useAiAnswerStream('test', true));

    await waitFor(() => {
      expect(result.current.error).toBe('Service unavailable');
    });

    expect(result.current.isStreaming).toBe(false);
  });

  it('handles abstention response', async () => {
    mockFetch.mockResolvedValueOnce(
      okStream([
        'data: {"type":"done","abstained":true,"abstention_reason":"Not enough sources","confidence":0.1,"sources":[]}\n\n',
      ]),
    );

    const { result } = renderHook(() => useAiAnswerStream('obscure', true));

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });

    expect(result.current.abstained).toBe(true);
    expect(result.current.abstentionReason).toBe('Not enough sources');
  });

  it('resets state with reset function', async () => {
    mockFetch.mockResolvedValueOnce(
      okStream(['data: {"type":"text","content":"Some text"}\n\n', 'data: {"type":"done"}\n\n']),
    );

    const { result } = renderHook(() => useAiAnswerStream('test', true));

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.text).toBe('');
    expect(result.current.isDone).toBe(false);
  });

  it('falls back to a buffered read when the response has no stream body', async () => {
    // Some transports hand back a complete-but-unreadable response. An answer
    // that arrives all at once beats the error the user used to see.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: null,
      text: async () =>
        'data: {"type":"text","content":"Buffered answer."}\n\n' +
        'data: {"type":"done","confidence":0.8,"sources":[]}\n\n',
    });

    const { result } = renderHook(() => useAiAnswerStream('test', true));

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });

    expect(result.current.text).toBe('Buffered answer.');
    expect(result.current.confidence).toBe(0.8);
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('streams a 201 response without retrying', async () => {
    // The gateway used to emit 201 for the SSE route. The old deny-list retried
    // anything it did not recognise, so one answer cost four quota units.
    mockFetch.mockResolvedValue(
      okStream(['data: {"type":"text","content":"Created but fine."}\n\n', 'data: {"type":"done"}\n\n'], 201),
    );

    const { result } = renderHook(() => useAiAnswerStream('test', true));

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });

    expect(result.current.text).toBe('Created but fine.');
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('stays silent when the stream is aborted mid-flight', async () => {
    const encoder = new TextEncoder();
    mockFetch.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"text","content":"Partial"}\n\n'));
          // expo/fetch does not reliably raise a DOMException named 'AbortError'
          // — an aborted native stream errors with a plain native message.
          init.signal.addEventListener('abort', () => {
            controller.error(new Error('Cancelled by the native fetch module'));
          });
        },
      });
      return Promise.resolve({ ok: true, status: 200, body: stream });
    });

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useAiAnswerStream('test', enabled),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => {
      expect(result.current.text).toBe('Partial');
    });

    // Disabling runs the effect cleanup, which aborts the in-flight controller —
    // the same path as navigating away or changing the query.
    rerender({ enabled: false });

    // Long enough to clear the first retry delay (1000ms + up to 500ms jitter),
    // so a second call here would be a real retry rather than a race.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1700));
    });

    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
