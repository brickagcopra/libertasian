import { renderHook, act, waitFor } from '@testing-library/react-native';

jest.mock('../../../storage/auth-storage', () => ({
  authStorage: { getAccessToken: jest.fn().mockResolvedValue('token-123') },
}));

const mockUseQuotaUsage = jest.fn();
jest.mock('../../billing/hooks/use-quotas', () => ({
  useQuotaUsage: () => mockUseQuotaUsage(),
}));

import { useDocumentChat } from './use-document-chat';

const DOC_ID = 'doc-42';

function sseStream(chunks: string[]) {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

function okStream(chunks: string[]) {
  return { ok: true, status: 200, body: sseStream(chunks) };
}

function lastBody() {
  const call = (global.fetch as jest.Mock).mock.calls.at(-1);
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

describe('useDocumentChat', () => {
  const originalFetch = global.fetch;

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
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('starts with an empty transcript and does not call the API on mount', () => {
    global.fetch = jest.fn() as unknown as typeof fetch;

    const { result } = renderHook(() => useDocumentChat(DOC_ID));

    expect(result.current.turns).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
    // Each turn costs a quota unit, so nothing may fire without explicit intent.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('scopes the request to the document', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        okStream(['data: {"type":"text","content":"Yes."}\n\n', 'data: {"type":"done"}\n\n']),
      ) as unknown as typeof fetch;

    const { result } = renderHook(() => useDocumentChat(DOC_ID));
    await act(async () => {
      await result.current.send('Does this cover bail?');
    });

    expect(lastBody().documentId).toBe(DOC_ID);
    expect(lastBody().query).toBe('Does this cover bail?');
  });

  it('accumulates a streamed answer into an assistant turn', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(
      okStream([
        'data: {"type":"text","content":"Bail is "}\n\n',
        'data: {"type":"text","content":"a right."}\n\n',
        'data: {"type":"done"}\n\n',
      ]),
    ) as unknown as typeof fetch;

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
    global.fetch = jest.fn().mockResolvedValueOnce(
      okStream([
        `data: {"type":"metadata","sources":${JSON.stringify(sources)}}\n\n`,
        'data: {"type":"text","content":"Yes."}\n\n',
        'data: {"type":"done"}\n\n',
      ]),
    ) as unknown as typeof fetch;

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
    global.fetch = jest.fn().mockResolvedValueOnce(
      okStream([
        'data: {"type":"metadata","abstained":true,"abstention_reason":"insufficient_passages"}\n\n',
        'data: {"type":"text","content":"I cannot answer."}\n\n',
        'data: {"type":"done"}\n\n',
      ]),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useDocumentChat(DOC_ID));
    await act(async () => {
      await result.current.send('Does this cover maritime salvage?');
    });

    await waitFor(() => {
      expect(result.current.turns[1]?.abstained).toBe(true);
    });
  });

  it('sends prior completed turns as history on the second question', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        okStream(['data: {"type":"text","content":"It is a right."}\n\n', 'data: {"type":"done"}\n\n']),
      )
      .mockResolvedValueOnce(
        okStream(['data: {"type":"text","content":"Except capital offences."}\n\n', 'data: {"type":"done"}\n\n']),
      ) as unknown as typeof fetch;

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
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(okStream(['data: {"type":"done"}\n\n'])) as unknown as typeof fetch;

    const { result } = renderHook(() => useDocumentChat(DOC_ID));
    await act(async () => {
      await result.current.send('Explain bail.');
    });

    expect(lastBody()).not.toHaveProperty('history');
  });

  it('does not replay an abstained turn as history', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        okStream([
          'data: {"type":"metadata","abstained":true}\n\n',
          'data: {"type":"text","content":"No grounding."}\n\n',
          'data: {"type":"done"}\n\n',
        ]),
      )
      .mockResolvedValueOnce(okStream(['data: {"type":"done"}\n\n'])) as unknown as typeof fetch;

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
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        message: 'Upgrade to the Pro plan for more AI answers',
        quota: { used: 100, limit: 100 },
      }),
    }) as unknown as typeof fetch;

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
    global.fetch = jest.fn() as unknown as typeof fetch;

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
    global.fetch = jest.fn() as unknown as typeof fetch;

    const { result } = renderHook(() => useDocumentChat(DOC_ID));

    expect(result.current.quota?.unlimited).toBe(true);
    expect(result.current.atLimit).toBe(false);
  });

  it('ignores a send while a turn is already streaming', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(okStream(['data: {"type":"done"}\n\n'])) as unknown as typeof fetch;

    const { result } = renderHook(() => useDocumentChat(DOC_ID));
    // Both calls come from the SAME render snapshot, so a state-based guard
    // would let the second through — this pins the ref-based one.
    await act(async () => {
      const first = result.current.send('one');
      const second = result.current.send('two');
      await Promise.all([first, second]);
    });

    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
    expect(result.current.turns.filter((t) => t.role === 'user')).toHaveLength(1);
  });

  it('ignores an empty or whitespace-only question', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;

    const { result } = renderHook(() => useDocumentChat(DOC_ID));
    await act(async () => {
      await result.current.send('   ');
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.turns).toEqual([]);
  });
});
