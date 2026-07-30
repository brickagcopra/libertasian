import { ConfigService } from '@nestjs/config';

import { KokoroClient, kokoroTimeoutBudgetMs } from './kokoro.client';
import { TtsSynthesisError, type TtsSynthesisInput } from './tts.client';

const INPUT: TtsSynthesisInput = {
  ssml: '<speak>ignored by this backend</speak>',
  segments: [{ id: 'seg-0', text: 'Alpha bravo.', leadSilenceMs: 0 }],
};

/** A request whose spoken text is exactly `chars` characters long. */
const inputOfChars = (chars: number): TtsSynthesisInput => ({
  ssml: '<speak/>',
  segments: [{ id: 'seg-0', text: 'a'.repeat(chars), leadSilenceMs: 0 }],
});

const configFor = (values: Record<string, string>): ConfigService =>
  ({
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  }) as unknown as ConfigService;

describe('KokoroClient', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    fetchMock.mockReset();
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Drive the retry backoff timers without awaiting them first — the caller
   * attaches its handler to the returned promise synchronously, so a rejection
   * is never left unhandled while the timers drain.
   */
  const settle = <T>(promise: Promise<T>): Promise<T> => {
    void jest.runAllTimersAsync();
    return promise;
  };

  /** A fetch that never resolves and rejects with AbortError when aborted. */
  const mockNeverResolves = (): void => {
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
  };

  it('posts the segments and decodes the base64 audio', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        audio: Buffer.from('ID3-audio').toString('base64'),
        marks: '{"time":0,"type":"ssml","value":"seg-0"}',
      }),
    });

    const client = new KokoroClient(configFor({ TTS_SERVICE_URL: 'http://tts:8003' }));
    const result = await settle(client.synthesize(INPUT));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('http://tts:8003/synthesize');
    expect(JSON.parse(init.body)).toMatchObject({
      voice: 'af_heart',
      format: 'mp3',
      segments: [{ id: 'seg-0', leadSilenceMs: 0 }],
    });
    expect(result.audio.toString()).toBe('ID3-audio');
    expect(result.marks.toString()).toContain('seg-0');
  });

  it('uses the explicit voiceId over the configured default', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ audio: '', marks: '' }),
    });

    const client = new KokoroClient(configFor({}));
    await settle(client.synthesize(INPUT, 'am_michael'));

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body).voice).toBe('am_michael');
  });

  it('retries a failed attempt and succeeds on a later one', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue({ ok: true, json: async () => ({ audio: '', marks: '' }) });

    const client = new KokoroClient(configFor({}));
    await expect(settle(client.synthesize(INPUT))).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting every attempt', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    const client = new KokoroClient(configFor({}));
    await expect(settle(client.synthesize(INPUT))).rejects.toThrow(
      /failed after 3 attempts/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects a malformed payload', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ nope: true }) });

    const client = new KokoroClient(configFor({}));
    await expect(settle(client.synthesize(INPUT))).rejects.toThrow(/malformed/);
  });

  describe('timeout budget', () => {
    // Every expectation below is arithmetic on the MEASURED 13.5 chars per
    // second of audio and the default 2.5x realtime factor — no host CPU or
    // disk is involved, so these hold identically in CI.
    it('scales with text length above the floor', () => {
      // 2,238 chars: the digest that failed permanently under the old flat
      // 300_000ms budget (0a8d731f-8b21-4332-b001-93779ebdf054).
      expect(kokoroTimeoutBudgetMs(2238)).toBe(414_445);
      expect(kokoroTimeoutBudgetMs(2238)).toBeGreaterThan(300_000);

      // 4,877 chars: the other real failure.
      expect(kokoroTimeoutBudgetMs(4877)).toBe(903_149);

      // 1,793 chars: the successfully measured item (131.0s of audio).
      expect(kokoroTimeoutBudgetMs(1793)).toBe(332_038);

      // 2,032 chars: the corpus average digest.
      expect(kokoroTimeoutBudgetMs(2032)).toBe(376_297);
    });

    it('never budgets below the 60s floor for short text', () => {
      expect(kokoroTimeoutBudgetMs(0)).toBe(60_000);
      expect(kokoroTimeoutBudgetMs(100)).toBe(60_000);
      // 324 chars is the break-even point: below it the floor dominates.
      expect(kokoroTimeoutBudgetMs(324)).toBe(60_000);
      expect(kokoroTimeoutBudgetMs(400)).toBe(74_075);
    });

    it('scales down with a faster realtime factor (GPU host)', () => {
      // A GPU host at 0.25 needs a tenth of the CPU budget for the same text.
      expect(kokoroTimeoutBudgetMs(4877, 0.25)).toBe(90_315);
      expect(kokoroTimeoutBudgetMs(25_600, 0.25)).toBe(474_075);
    });

    it('applies the computed budget to the request, not a flat 300s', async () => {
      mockNeverResolves();
      const budget = kokoroTimeoutBudgetMs(2238);
      const client = new KokoroClient(configFor({}));
      const promise = client.synthesize(inputOfChars(2238)).catch((err) => err);

      // The old flat timeout would have aborted here.
      await jest.advanceTimersByTimeAsync(300_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(budget - 300_000 - 1);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // One tick past the budget the request aborts and the single enlarged
      // retry goes out.
      await jest.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await jest.runAllTimersAsync();
      const err = (await promise) as TtsSynthesisError;
      expect(err).toBeInstanceOf(TtsSynthesisError);
      expect(err.reason).toBe('timeout');
    });

    it('retries a timeout exactly ONCE, with a larger budget', async () => {
      mockNeverResolves();
      const client = new KokoroClient(configFor({}));
      const err = (await settle(
        client.synthesize(inputOfChars(2238)).catch((e) => e),
      )) as TtsSynthesisError;

      // Two attempts, NOT three: identical retries of a compute-bound timeout
      // burn CPU without changing the outcome.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(err.reason).toBe('timeout');
      expect(err.detail).toContain('after one enlarged retry');
      expect(err.detail).toContain('2238 chars');
    });

    it('refuses text no allowed budget can cover, before calling out', async () => {
      const client = new KokoroClient(configFor({}));
      // ~25,600 chars is the average DECISION; at the CPU factor its budget is
      // ~4,740s, well past the 1,800s ceiling.
      const err = (await settle(
        client.synthesize(inputOfChars(25_600)).catch((e) => e),
      )) as TtsSynthesisError;

      expect(err).toBeInstanceOf(TtsSynthesisError);
      expect(err.reason).toBe('text_too_long');
      expect(err.detail).toMatch(/25600 chars/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('honours KOKORO_REALTIME_FACTOR and the ceiling override', async () => {
      mockNeverResolves();
      // At 0.25 the same 25,600 chars fits comfortably, so the call goes out.
      const client = new KokoroClient(configFor({ KOKORO_REALTIME_FACTOR: '0.25' }));
      const promise = client.synthesize(inputOfChars(25_600)).catch((e) => e);

      await jest.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await jest.runAllTimersAsync();
      await promise;
    });

    it('does not retry when the first budget is already at the ceiling', async () => {
      mockNeverResolves();
      // Ceiling pinned to the floor: the enlarged retry cannot be larger, so
      // there is nothing left to try.
      const client = new KokoroClient(
        configFor({ KOKORO_TIMEOUT_CEILING_MS: '60000' }),
      );
      const err = (await settle(
        client.synthesize(inputOfChars(10)).catch((e) => e),
      )) as TtsSynthesisError;

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(err.reason).toBe('timeout');
      expect(err.detail).not.toContain('enlarged retry');
    });
  });

  describe('failure classification', () => {
    it('does not retry a 401 — the token will be just as wrong next time', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401 });

      const client = new KokoroClient(configFor({}));
      const err = (await settle(
        client.synthesize(INPUT).catch((e) => e),
      )) as TtsSynthesisError;

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(err.reason).toBe('permanent');
      expect(err.detail).toContain('401');
    });

    it('retries 429 and 5xx, which are the server saying "later"', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 429 })
        .mockResolvedValueOnce({ ok: false, status: 502 })
        .mockResolvedValue({ ok: true, json: async () => ({ audio: '', marks: '' }) });

      const client = new KokoroClient(configFor({}));
      await expect(settle(client.synthesize(INPUT))).resolves.toBeDefined();
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('treats a connect failure as transient', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      const client = new KokoroClient(configFor({}));
      const err = (await settle(
        client.synthesize(INPUT).catch((e) => e),
      )) as TtsSynthesisError;

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(err.reason).toBe('transient');
    });

    it('reports a malformed payload as permanent', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ nope: true }) });

      const client = new KokoroClient(configFor({}));
      const err = (await settle(
        client.synthesize(INPUT).catch((e) => e),
      )) as TtsSynthesisError;

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(err.reason).toBe('permanent');
    });
  });

  describe('TTS_AUTH_TOKEN', () => {
    const headersOf = (call: unknown): Record<string, string> =>
      (call as [string, { headers: Record<string, string> }])[1].headers;

    it('sends a bearer header when the token is configured', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ audio: '', marks: '' }),
      });

      const client = new KokoroClient(configFor({ TTS_AUTH_TOKEN: 's3cret' }));
      await settle(client.synthesize(INPUT));

      expect(headersOf(fetchMock.mock.calls[0])).toEqual({
        'content-type': 'application/json',
        authorization: 'Bearer s3cret',
      });
    });

    it('sends NO authorization header when the token is unset', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ audio: '', marks: '' }),
      });

      const client = new KokoroClient(configFor({}));
      await settle(client.synthesize(INPUT));

      const headers = headersOf(fetchMock.mock.calls[0]);
      expect(headers).toEqual({ 'content-type': 'application/json' });
      expect('authorization' in headers).toBe(false);
    });

    it('sends no header for a whitespace-only token', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ audio: '', marks: '' }),
      });

      const client = new KokoroClient(configFor({ TTS_AUTH_TOKEN: '   ' }));
      await settle(client.synthesize(INPUT));

      expect('authorization' in headersOf(fetchMock.mock.calls[0])).toBe(false);
    });
  });
});
