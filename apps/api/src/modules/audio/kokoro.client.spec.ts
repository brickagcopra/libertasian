import { ConfigService } from '@nestjs/config';

import { KokoroClient } from './kokoro.client';
import type { TtsSynthesisInput } from './tts.client';

const INPUT: TtsSynthesisInput = {
  ssml: '<speak>ignored by this backend</speak>',
  segments: [{ id: 'seg-0', text: 'Alpha bravo.', leadSilenceMs: 0 }],
};

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
});
