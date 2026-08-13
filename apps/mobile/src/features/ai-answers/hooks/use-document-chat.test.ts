import { renderHook, act, waitFor } from '@testing-library/react-native';

jest.mock('../../../storage/auth-storage', () => ({
  authStorage: { getAccessToken: jest.fn().mockResolvedValue('token-123') },
}));

const mockUseQuotaUsage = jest.fn();
jest.mock('../../billing/hooks/use-quotas', () => ({
  useQuotaUsage: () => mockUseQuotaUsage(),
}));

// The transport is expo/fetch, not the RN global. Stubbing `global.fetch` here
// used to make every case pass against code that could never stream on a real
// device — RN's fetch is whatwg-fetch over XHR and has no `response.body` at all.
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

import { fetch as expoFetch } from 'expo/fetch';

import { useDocumentChat } from './use-document-chat';

const mockFetch = expoFetch as unknown as jest.Mock;

const DOC_ID = 'doc-42';

function sseStream(chunks: string[]) {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]!));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

function okStream(chunks: string[], status = 200) {
  return { ok: true, status, body: sseStream(chunks) };
}

function lastBody() {
  const call = mockFetch.mock.calls.at(-1);
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

describe('useDocumentChat', () => {
  beforeEach(() => {
    mockUseQuotaUsage.mockReturnValue({
      data: {
        quotas: {
          ai_answers_per_month: {
            allowed: true,
            used: 3,
            limit: 100,
            remaining: 97,
            resetsAt: '2026-09-01T00:00:00.000Z',
          },
        },
      },
      refetch: jest.fn(),
    });
  });

  afterEach(() => {
    mockFetch.mockReset();
    jest.restoreAllMocks();
  });

  it('starts with an empty transcript and does not call the API on mount', () => {
    const { result } = renderHook(() => useDocumentChat(DOC_ID));

    expect(result.current.turns).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
    // Each turn costs a quota unit, so nothing may fire without explicit intent.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('scopes the request to the document', async () => {
    mockFetch.mockResolvedValueOnce(
      okStream(['data: {"type":"text","content":"Yes."}\n\n', 'data: {"type":"done"}\n\n']),
    );

    const { result } = renderHook(() => useDocumentChat(DOC_ID));
    await act(async () => {
      await result.current.send('Does this cover bail?');
    });

    expect(lastBody().documentId).toBe(DOC_ID);
    expect(lastBody().query).toBe('Does this cover bail?');
  });

  it('accumulates a streamed answer into an assistant turn', async () => {
    mockFetch.mockResolvedValueOnce(
      okStream([
        'data: {"type":"text","content":"Bail is "}\n\n',
        'data: {"type":"text","content":"a right."}\n\n',
        'data: {"type":"done"}\n\n',
      ]),
    );

    const { result } = renderHook(() => useDocumentChat(DOC_ID));
    await act(async () => {
      await result.current.send('Explain bail.');
    });

    await waitFor(() => {
      expect(result.current.turns).toHaveLength(2);
    });
    expect(result.current.turns[0]).toMatchObject({ role: 'user', text: 'Explain bail.' });
    expect(result.current.turns[1]).toMatchObject({
      role: 'assistant',
      text: 'Bail is a right.',
      status: 'complete',
    });
  });

  it('attaches per-turn source cards from the metadata frame', async () => {
    const sources = [{ document_id: DOC_ID, title: 'Art. III', relevance_score: 0.9 }];
    mockFetch.mockResolvedValueOnce(
      okStream([
        `data: {"type":"metadata","content":"","metadata":{"intent":"doc_scoped","passages_used":4,"passages_available":4,"sources":${JSON.stringify(sources)}}}\n\n`,
        'data: {"type":"text","content":"Yes."}\n\n',
        'data: {"type":"done"}\n\n',
      ]),
    );

    const { result } = renderHook(() => useDocumentChat(DOC_ID));
    await act(async () => {
      await result.current.send('q');
    });

    await waitFor(() => {
      expect(result.current.turns[1]?.sources).toHaveLength(1);
    });
    expect(result.current.turns[1]?.sources[0]?.title).toBe('Art. III');
  });

  it('surfaces abstention as its own state', async () => {
    mockFetch.mockResolvedValueOnce(
      okStream([
        'data: {"type":"metadata","content":"","metadata":{"intent":"doc_scoped","abstained":true,"abstention_reason":"insufficient_passages"}}\n\n',
        'data: {"type":"text","content":"I cannot answer."}\n\n',
        'data: {"type":"done"}\n\n',
      ]),
    );

    const { result } = renderHook(() => useDocumentChat(DOC_ID));
    await act(async () => {
      await result.current.send('Does this cover maritime salvage?');
    });

    await waitFor(() => {
      expect(result.current.turns[1]?.abstained).toBe(true);
    });
  });

  it('sends prior completed turns as history on the second question', async () => {
    mockFetch
      .mockResolvedValueOnce(
        okStream(['data: {"type":"text","content":"It is a right."}\n\n', 'data: {"type":"done"}\n\n']),
      )
      .mockResolvedValueOnce(
        okStream(['data: {"type":"text","content":"Except capital offences."}\n\n', 'data: {"type":"done"}\n\n']),
      );

    const { result } = renderHook(() => useDocumentChat(DOC_ID));
    await act(async () => {
      await result.current.send('Explain bail.');
    });
    await waitFor(() => expect(result.current.turns[1]?.status).toBe('complete'));

    await act(async () => {
      await result.current.send('And the exceptions?');
    });

    expect(lastBody().history).toEqual([
      { role: 'user', content: 'Explain bail.' },
      { role: 'assistant', content: 'It is a right.' },
    ]);
  });

  it('omits history on the first question', async () => {
    mockFetch.mockResolvedValueOnce(okStream(['data: {"type":"done"}\n\n']));

    const { result } = renderHook(() => useDocumentChat(DOC_ID));
    await act(async () => {
      await result.current.send('Explain bail.');
    });

    expect(lastBody()).not.toHaveProperty('history');
  });

  it('does not replay an abstained turn as history', async () => {
    mockFetch
      .mockResolvedValueOnce(
        okStream([
          'data: {"type":"metadata","content":"","metadata":{"abstained":true,"abstention_reason":"insufficient_passages"}}\n\n',
          'data: {"type":"text","content":"No grounding."}\n\n',
          'data: {"type":"done"}\n\n',
        ]),
      )
      .mockResolvedValueOnce(okStream(['data: {"type":"done"}\n\n']));

    const { result } = renderHook(() => useDocumentChat(DOC_ID));
    await act(async () => {
      await result.current.send('Off-topic question.');
    });
    await waitFor(() => expect(result.current.turns[1]?.abstained).toBe(true));

    await act(async () => {
      await result.current.send('Follow up.');
    });

    // The abstained answer carries nothing worth continuing from, so only the
    // question survives — never the model's own non-answer as context.
    expect(lastBody().history).toEqual([{ role: 'user', content: 'Off-topic question.' }]);
  });

  it('marks the turn at-limit on a 403 without surfacing the server message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        message: 'Upgrade to the Pro plan for more AI answers',
        quota: { used: 100, limit: 100 },
      }),
    });

    const { result } = renderHook(() => useDocumentChat(DOC_ID));
    await act(async () => {
      await result.current.send('q');
    });

    await waitFor(() => expect(result.current.atLimit).toBe(true));
    expect(result.current.turns[1]).toMatchObject({ status: 'error', errorKind: 'quota' });
    // Apple 3.1.1: the server's plan-naming copy must not reach the transcript.
    expect(JSON.stringify(result.current.turns)).not.toContain('Upgrade');
    expect(JSON.stringify(result.current.turns)).not.toContain('Pro plan');
  });

  it('reports at-limit proactively when the quota is already exhausted', () => {
    mockUseQuotaUsage.mockReturnValue({
      data: {
        quotas: {
          ai_answers_per_month: { allowed: false, used: 15, limit: 15, remaining: 0 },
        },
      },
      refetch: jest.fn(),
    });

    const { result } = renderHook(() => useDocumentChat(DOC_ID));

    expect(result.current.atLimit).toBe(true);
  });

  it('reports an unlimited plan as not at-limit', () => {
    mockUseQuotaUsage.mockReturnValue({
      data: {
        quotas: {
          ai_answers_per_month: { allowed: true, used: 900, limit: -1, remaining: -1 },
        },
      },
      refetch: jest.fn(),
    });

    const { result } = renderHook(() => useDocumentChat(DOC_ID));

    expect(result.current.quota?.unlimited).toBe(true);
    expect(result.current.atLimit).toBe(false);
  });

  it('ignores a send while a turn is already streaming', async () => {
    mockFetch.mockResolvedValueOnce(okStream(['data: {"type":"done"}\n\n']));

    const { result } = renderHook(() => useDocumentChat(DOC_ID));
    // Both calls come from the SAME render snapshot, so a state-based guard
    // would let the second through — this pins the ref-based one.
    await act(async () => {
      const first = result.current.send('one');
      const second = result.current.send('two');
      await Promise.all([first, second]);
    });

    expect(mockFetch.mock.calls).toHaveLength(1);
    expect(result.current.turns.filter((t) => t.role === 'user')).toHaveLength(1);
  });

  it('ignores an empty or whitespace-only question', async () => {
    const { result } = renderHook(() => useDocumentChat(DOC_ID));
    await act(async () => {
      await result.current.send('   ');
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.turns).toEqual([]);
  });

  it('reads sources and confidence from a nested metadata frame', async () => {
    // The real wire shape, dumped from prod: the rag-service nests every frame
    // payload under `metadata` and the gateway pipes it through verbatim.
    const sources = [
      { document_id: DOC_ID, title: 'Art. III, Sec. 13', relevance_score: 0.94, passage_text: '…' },
    ];

    mockFetch.mockResolvedValueOnce(
      okStream([
        `data: {"type":"metadata","content":"","metadata":{"intent":"doc_scoped","passages_used":6,"passages_available":6,"sources":${JSON.stringify(sources)}}}\n\n`,
        'data: {"type":"text","content":"Bail is a right."}\n\n',
        'data: {"type":"done","content":"","metadata":{"confidence":0.81,"confidence_level":"high","valid_citations":2,"total_citations":2}}\n\n',
      ]),
    );

    const { result } = renderHook(() => useDocumentChat(DOC_ID));
    await act(async () => {
      await result.current.send('Explain bail.');
    });

    await waitFor(() => expect(result.current.turns[1]?.status).toBe('complete'));
    expect(result.current.turns[1]?.sources).toHaveLength(1);
    expect(result.current.turns[1]?.sources[0]?.title).toBe('Art. III, Sec. 13');
    expect(result.current.turns[1]?.text).toBe('Bail is a right.');
  });

  it('replaces the streamed text when the terminal frame abstains', async () => {
    // Post-generation abstention (PR #372): a scoped answer with no valid
    // citation. The text already streamed is unsupported, so the server's
    // replacement copy takes its place — and the turn is marked abstained, which
    // is what keeps it out of the next request's history.
    mockFetch
      .mockResolvedValueOnce(
        okStream([
          'data: {"type":"text","content":"The document plainly says yes."}\n\n',
          'data: {"type":"done","content":"","metadata":{"abstained":true,"abstention_reason":"validation_failed","abstention_text":"This document does not address that question.","confidence":0.0,"valid_citations":0,"total_citations":4}}\n\n',
        ]),
      )
      .mockResolvedValueOnce(okStream(['data: {"type":"done","content":"","metadata":{}}\n\n']));

    const { result } = renderHook(() => useDocumentChat(DOC_ID));
    await act(async () => {
      await result.current.send('Does this cover maritime salvage?');
    });

    await waitFor(() => expect(result.current.turns[1]?.abstained).toBe(true));
    expect(result.current.turns[1]?.text).toBe('This document does not address that question.');
    expect(result.current.turns[1]?.text).not.toContain('plainly says yes');

    await act(async () => {
      await result.current.send('Follow up.');
    });

    // The discarded answer must not come back as context on the next turn.
    expect(lastBody().history).toEqual([
      { role: 'user', content: 'Does this cover maritime salvage?' },
    ]);
  });

  it('still parses a legacy flat frame through the fallback', async () => {
    // The non-streaming POST /ai-answers shape. Kept working so old fixtures and
    // any unmigrated producer still populate the turn.
    mockFetch.mockResolvedValueOnce(
      okStream([
        'data: {"type":"metadata","sources":[{"document_id":"doc-9","title":"Art. III","relevance_score":0.5,"passage_text":"..."}]}\n\n',
        'data: {"type":"text","content":"Flat still works."}\n\n',
        'data: {"type":"done","confidence":0.42,"abstained":false}\n\n',
      ]),
    );

    const { result } = renderHook(() => useDocumentChat(DOC_ID));
    await act(async () => {
      await result.current.send('q');
    });

    await waitFor(() => expect(result.current.turns[1]?.status).toBe('complete'));
    expect(result.current.turns[1]?.sources[0]?.title).toBe('Art. III');
    expect(result.current.turns[1]?.text).toBe('Flat still works.');
    expect(result.current.turns[1]?.abstained).toBe(false);
  });

  it('falls back to a buffered read when the response has no stream body', async () => {
    // A complete-but-unreadable response still carries a whole answer. Rendering
    // it non-progressively beats the error the user used to get.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: null,
      text: async () =>
        'data: {"type":"text","content":"Bail is a right."}\n\n' + 'data: {"type":"done"}\n\n',
    });

    const { result } = renderHook(() => useDocumentChat(DOC_ID));
    await act(async () => {
      await result.current.send('Explain bail.');
    });

    await waitFor(() => expect(result.current.turns[1]?.status).toBe('complete'));
    expect(result.current.turns[1]?.text).toBe('Bail is a right.');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('streams a 201 response without retrying', async () => {
    // The gateway used to emit 201 for the SSE route. Under the old deny-list an
    // unrecognised status retried 3×, and every call charges a quota unit.
    mockFetch.mockResolvedValue(
      okStream(
        ['data: {"type":"text","content":"Created but fine."}\n\n', 'data: {"type":"done"}\n\n'],
        201,
      ),
    );

    const { result } = renderHook(() => useDocumentChat(DOC_ID));
    await act(async () => {
      await result.current.send('Explain bail.');
    });

    await waitFor(() => expect(result.current.turns[1]?.status).toBe('complete'));
    expect(result.current.turns[1]?.text).toBe('Created but fine.');
    expect(result.current.turns[1]?.errorKind).toBeUndefined();
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

    const { result, unmount } = renderHook(() => useDocumentChat(DOC_ID));

    let pending: Promise<void>;
    act(() => {
      pending = result.current.send('Explain bail.');
    });

    await waitFor(() => expect(result.current.turns[1]?.text).toBe('Partial'));

    // Unmounting (navigating out of the reader) aborts the in-flight controller.
    unmount();

    // Long enough to clear the first retry delay (1000ms + up to 500ms jitter),
    // so a second call here would be a real retry rather than a race.
    await act(async () => {
      await pending!;
      await new Promise((resolve) => setTimeout(resolve, 1700));
    });

    expect(result.current.turns[1]?.status).toBe('streaming');
    expect(result.current.turns[1]?.errorKind).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
