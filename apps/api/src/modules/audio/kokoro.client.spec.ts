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

/**
 * A document of `totalChars` split into equal segments of `segmentChars` —
 * the shape of a published codal, whose sections are the segments.
 */
const documentOfSegments = (
  totalChars: number,
  segmentChars: number,
): TtsSynthesisInput => ({
  ssml: '<speak/>',
  segments: Array.from({ length: totalChars / segmentChars }, (_, i) => ({
    id: `seg-${i}`,
    text: 'a'.repeat(segmentChars),
    leadSilenceMs: 0,
  })),
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

    it('refuses a SINGLE segment no allowed budget can cover, before calling out', async () => {
      const client = new KokoroClient(configFor({}));
      // One indivisible 25,600-char segment: at the CPU factor its budget is
      // ~4,740s, well past the 1,800s ceiling, and no grouping can help it.
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

  describe('chunking a document past the ceiling', () => {
    /**
     * Every batch answers with its own audio marker and three marks, so the
     * merged result can be checked for BOTH completeness (all batches present,
     * in order) and correct mark offsetting across the seams.
     */
    const mockPerBatchResponses = (): void => {
      fetchMock.mockImplementation((_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as {
          segments: Array<{ id: string }>;
        };
        const first = body.segments[0]?.id ?? '';
        const last = body.segments[body.segments.length - 1]?.id ?? '';
        return Promise.resolve({
          ok: true,
          json: async () => ({
            audio: Buffer.from(`[${first}..${last}]`).toString('base64'),
            marks: [
              `{"time":0,"type":"ssml","value":"${first}"}`,
              `{"time":1500,"type":"word","value":"end"}`,
              `{"time":1600,"type":"ssml","value":"${last}"}`,
            ].join('\n'),
          }),
        });
      });
    };

    const postedBatches = (): Array<Array<{ id: string; text: string }>> =>
      fetchMock.mock.calls.map(
        (call) =>
          (JSON.parse((call as [string, { body: string }])[1].body) as {
            segments: Array<{ id: string; text: string }>;
          }).segments,
      );

    // The GPU factor prod runs at. 400,000 chars sits inside the 105,130-810,815
    // char range of the 13 published codals that could never be synthesized.
    const GPU = { KOKORO_REALTIME_FACTOR: '0.25' };

    it('splits a 400k-char document into batches instead of refusing it', async () => {
      mockPerBatchResponses();
      const client = new KokoroClient(configFor(GPU));

      await settle(client.synthesize(documentOfSegments(400_000, 2_000)));

      // 80% of the 1,800s ceiling at 0.25x realtime is 77,760 chars, i.e. 38
      // of these 2,000-char segments; 200 segments therefore need 6 batches.
      const batches = postedBatches();
      expect(batches).toHaveLength(6);
      expect(batches.map((b) => b.length)).toEqual([38, 38, 38, 38, 38, 10]);

      // Consecutive, complete, and never split mid-segment.
      const posted = batches.flat();
      expect(posted.map((s) => s.id)).toEqual(
        Array.from({ length: 200 }, (_, i) => `seg-${i}`),
      );
      expect(posted.every((s) => s.text.length === 2_000)).toBe(true);
      // No batch may plan past the per-batch budget.
      expect(
        batches.every(
          (b) => b.reduce((n, s) => n + s.text.length, 0) <= 77_760,
        ),
      ).toBe(true);
    });

    it('returns ONE concatenated audio buffer carrying every batch in order', async () => {
      mockPerBatchResponses();
      const client = new KokoroClient(configFor(GPU));

      const result = await settle(
        client.synthesize(documentOfSegments(400_000, 2_000)),
      );

      expect(result.audio.toString()).toBe(
        '[seg-0..seg-37]' +
          '[seg-38..seg-75]' +
          '[seg-76..seg-113]' +
          '[seg-114..seg-151]' +
          '[seg-152..seg-189]' +
          '[seg-190..seg-199]',
      );
    });

    it('offsets each batch of marks so times increase across the boundary', async () => {
      mockPerBatchResponses();
      const client = new KokoroClient(configFor(GPU));

      const result = await settle(
        client.synthesize(documentOfSegments(400_000, 2_000)),
      );

      const marks = result.marks
        .toString('utf-8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as { time: number; value: string });

      // Three marks per batch, none dropped by the merge.
      expect(marks).toHaveLength(18);
      const times = marks.map((m) => m.time);
      expect([...times].sort((a, b) => a - b)).toEqual(times);

      // The first batch is unshifted; every later one starts strictly after the
      // audio that precedes it, so read-along never rewinds at a seam.
      expect(times.slice(0, 3)).toEqual([0, 1500, 1600]);
      expect(times[3]).toBeGreaterThan(times[2] ?? 0);
      // 76,000 chars at the measured 13.5 chars/s of audio.
      expect(times[3]).toBe(5_629_630);
      expect(marks[3]?.value).toBe('seg-38');
    });

    it('keeps the per-batch timeout retry behaviour', async () => {
      // First batch 503s once, then every call succeeds: the transient retry is
      // per batch, not per document.
      let calls = 0;
      fetchMock.mockImplementation(() => {
        calls += 1;
        if (calls === 1) return Promise.resolve({ ok: false, status: 503 });
        return Promise.resolve({
          ok: true,
          json: async () => ({ audio: '', marks: '' }),
        });
      });

      const client = new KokoroClient(configFor(GPU));
      await expect(
        settle(client.synthesize(documentOfSegments(400_000, 2_000))),
      ).resolves.toBeDefined();

      // 6 batches + the one retried batch.
      expect(fetchMock).toHaveBeenCalledTimes(7);
    });

    it('refuses only the oversized segment, not the whole document', async () => {
      mockPerBatchResponses();
      const client = new KokoroClient(configFor({}));
      // Small segments the CPU factor can batch, plus one that alone needs
      // ~7,400s — no grouping can make that fit.
      const doc: TtsSynthesisInput = {
        ssml: '<speak/>',
        segments: [
          { id: 'seg-0', text: 'a'.repeat(2_000), leadSilenceMs: 0 },
          { id: 'seg-1', text: 'a'.repeat(40_000), leadSilenceMs: 0 },
          { id: 'seg-2', text: 'a'.repeat(2_000), leadSilenceMs: 0 },
        ],
      };

      const err = (await settle(
        client.synthesize(doc).catch((e) => e),
      )) as TtsSynthesisError;

      expect(err).toBeInstanceOf(TtsSynthesisError);
      expect(err.reason).toBe('text_too_long');
      expect(err.detail).toContain('seg-1');
      // Planning happens before any HTTP call, so nothing is half-synthesized.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not chunk a document that already fits', async () => {
      mockPerBatchResponses();
      const client = new KokoroClient(configFor({}));

      await settle(client.synthesize(documentOfSegments(4_000, 1_000)));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(postedBatches()[0]).toHaveLength(4);
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
