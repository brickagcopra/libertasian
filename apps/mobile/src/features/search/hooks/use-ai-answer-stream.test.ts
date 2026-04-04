import { renderHook, act, waitFor } from '@testing-library/react-native';

jest.mock('../../../storage/auth-storage', () => ({
  authStorage: {
    getAccessToken: jest.fn().mockResolvedValue('test-token'),
  },
}));

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { apiUrl: 'http://test-api/api/v1' } },
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

describe('useAiAnswerStream (mobile)', () => {
  afterEach(() => {
    global.fetch = originalFetch;
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
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    renderHook(() => useAiAnswerStream(null, true));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not fetch when disabled', () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    renderHook(() => useAiAnswerStream('test query', false));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('starts streaming and processes chunks', async () => {
    const stream = createSSEStream([
      'data: {"type":"text","content":"Hello "}\n\n',
      'data: {"type":"text","content":"world"}\n\n',
      'data: {"type":"done","confidence":0.9,"sources":[]}\n\n',
    ]);

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useAiAnswerStream('test', true));

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });

    expect(result.current.text).toBe('Hello world');
    expect(result.current.confidence).toBe(0.9);
  });

  it('handles error chunk', async () => {
    const stream = createSSEStream([
      'data: {"type":"error","message":"Service unavailable"}\n\n',
    ]);

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useAiAnswerStream('test', true));

    await waitFor(() => {
      expect(result.current.error).toBe('Service unavailable');
    });

    expect(result.current.isStreaming).toBe(false);
  });

  it('handles abstention response', async () => {
    const stream = createSSEStream([
      'data: {"type":"done","abstained":true,"abstention_reason":"Not enough sources","confidence":0.1,"sources":[]}\n\n',
    ]);

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useAiAnswerStream('obscure', true));

    await waitFor(() => {
      expect(result.current.isDone).toBe(true);
    });

    expect(result.current.abstained).toBe(true);
    expect(result.current.abstentionReason).toBe('Not enough sources');
  });

  it('resets state with reset function', async () => {
    const stream = createSSEStream([
      'data: {"type":"text","content":"Some text"}\n\n',
      'data: {"type":"done"}\n\n',
    ]);

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    }) as unknown as typeof fetch;

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
});
