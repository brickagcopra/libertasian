import { PollyClient as AwsPollyClient } from '@aws-sdk/client-polly';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';

import { PollyClient } from './polly.client';

// Mock the AWS SDK so no network calls occur. The Polly constructor returns an
// object with a jest-mocked `send`, which we configure per test.
jest.mock('@aws-sdk/client-polly', () => {
  const actual =
    jest.requireActual<typeof import('@aws-sdk/client-polly')>(
      '@aws-sdk/client-polly',
    );
  return {
    __esModule: true,
    ...actual,
    PollyClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  };
});

interface CapturedInput {
  Text?: string;
  TextType?: string;
  OutputFormat?: string;
  SpeechMarkTypes?: string[];
  VoiceId?: string;
  Engine?: string;
}

type SendMock = jest.Mock<
  Promise<{ AudioStream?: Readable }>,
  [{ input: CapturedInput }]
>;

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  const get = (key: string, def?: string): string | undefined =>
    key in overrides ? overrides[key] : def;
  return { get } as unknown as ConfigService;
}

const AwsCtorMock = AwsPollyClient as unknown as jest.Mock;

function newService(config: ConfigService): {
  service: PollyClient;
  send: SendMock;
} {
  AwsCtorMock.mockClear();
  const service = new PollyClient(config);
  const result = AwsCtorMock.mock.results[0];
  if (!result || result.type !== 'return') {
    throw new Error('Polly constructor was not invoked');
  }
  const send = (result.value as { send: SendMock }).send;
  send.mockImplementation((command) => {
    const payload =
      command.input.OutputFormat === 'json' ? '{"time":0,"value":"x"}' : 'MP3BYTES';
    return Promise.resolve({ AudioStream: Readable.from(Buffer.from(payload)) });
  });
  return { service, send };
}

function inputsOf(send: SendMock): CapturedInput[] {
  return send.mock.calls.map((call) => call[0].input);
}

describe('PollyClient', () => {
  it('issues exactly two SynthesizeSpeech calls (audio + marks)', async () => {
    const { service, send } = newService(makeConfig());
    await service.synthesize('<speak>hello</speak>');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('requests MP3 audio and JSON speech marks from the same SSML', async () => {
    const { service, send } = newService(makeConfig({ POLLY_NEWSCASTER: 'false' }));
    await service.synthesize('<speak>hi</speak>');

    const inputs = inputsOf(send);
    const audio = inputs.find((i) => i.OutputFormat === 'mp3');
    const marks = inputs.find((i) => i.OutputFormat === 'json');

    expect(audio).toBeDefined();
    expect(audio?.TextType).toBe('ssml');
    expect(audio?.Text).toBe('<speak>hi</speak>');
    expect(audio?.SpeechMarkTypes).toBeUndefined();

    expect(marks).toBeDefined();
    expect(marks?.TextType).toBe('ssml');
    expect(marks?.Text).toBe('<speak>hi</speak>');
    expect(marks?.SpeechMarkTypes).toEqual(['word', 'sentence']);
  });

  it('returns the audio and marks bytes as Buffers', async () => {
    const { service } = newService(makeConfig());
    const { audio, marks } = await service.synthesize('<speak>hi</speak>');

    expect(Buffer.isBuffer(audio)).toBe(true);
    expect(audio.toString()).toBe('MP3BYTES');
    expect(marks.toString()).toBe('{"time":0,"value":"x"}');
  });

  it('defaults the voice to Matthew when POLLY_VOICE_ID is unset', async () => {
    const { service, send } = newService(makeConfig());
    await service.synthesize('<speak>hi</speak>');
    for (const input of inputsOf(send)) {
      expect(input.VoiceId).toBe('Matthew');
    }
  });

  it('defaults the engine to neural on both calls when POLLY_ENGINE is unset', async () => {
    const { service, send } = newService(makeConfig());
    await service.synthesize('<speak>hi</speak>');
    expect(send).toHaveBeenCalledTimes(2);
    for (const input of inputsOf(send)) {
      expect(input.Engine).toBe('neural');
    }
  });

  it('passes the configured POLLY_ENGINE on both calls', async () => {
    const { service, send } = newService(makeConfig({ POLLY_ENGINE: 'generative' }));
    await service.synthesize('<speak>hi</speak>');
    for (const input of inputsOf(send)) {
      expect(input.Engine).toBe('generative');
    }
  });

  it('flows a long-form voice + engine config through to both calls', async () => {
    const { service, send } = newService(
      makeConfig({ POLLY_ENGINE: 'long-form', POLLY_VOICE_ID: 'Gregory' }),
    );
    await service.synthesize('<speak>hi</speak>');
    expect(send).toHaveBeenCalledTimes(2);
    for (const input of inputsOf(send)) {
      expect(input.Engine).toBe('long-form');
      expect(input.VoiceId).toBe('Gregory');
    }
  });

  it('honors POLLY_VOICE_ID from config', async () => {
    const { service, send } = newService(makeConfig({ POLLY_VOICE_ID: 'Joanna' }));
    await service.synthesize('<speak>hi</speak>');
    expect(inputsOf(send)[0]?.VoiceId).toBe('Joanna');
  });

  it('lets an explicit voiceId argument override the default', async () => {
    const { service, send } = newService(makeConfig());
    await service.synthesize('<speak>hi</speak>', 'Matthew');
    for (const input of inputsOf(send)) {
      expect(input.VoiceId).toBe('Matthew');
    }
  });

  it('returns an empty Buffer when Polly yields no audio stream', async () => {
    const { service, send } = newService(makeConfig());
    send.mockResolvedValue({});
    const { audio, marks } = await service.synthesize('<speak>hi</speak>');
    expect(audio.length).toBe(0);
    expect(marks.length).toBe(0);
  });

  describe('newscaster domain wrapper', () => {
    const NEWSCASTER = '<speak><amazon:domain name="news">hi</amazon:domain></speak>';

    it('wraps neural SSML in <amazon:domain name="news"> by default', async () => {
      const { service, send } = newService(makeConfig());
      await service.synthesize('<speak>hi</speak>');
      for (const input of inputsOf(send)) {
        expect(input.Text).toBe(NEWSCASTER);
      }
    });

    it('omits the wrapper when POLLY_NEWSCASTER=false', async () => {
      const { service, send } = newService(makeConfig({ POLLY_NEWSCASTER: 'false' }));
      await service.synthesize('<speak>hi</speak>');
      for (const input of inputsOf(send)) {
        expect(input.Text).toBe('<speak>hi</speak>');
      }
    });

    it('never applies the wrapper on the generative engine', async () => {
      const { service, send } = newService(
        makeConfig({ POLLY_ENGINE: 'generative' }),
      );
      await service.synthesize('<speak>hi</speak>');
      for (const input of inputsOf(send)) {
        expect(input.Text).toBe('<speak>hi</speak>');
      }
    });

    it('never applies the wrapper on the long-form engine', async () => {
      const { service, send } = newService(
        makeConfig({ POLLY_ENGINE: 'long-form', POLLY_VOICE_ID: 'Gregory' }),
      );
      await service.synthesize('<speak>hi</speak>');
      for (const input of inputsOf(send)) {
        expect(input.Text).toBe('<speak>hi</speak>');
      }
    });

    it('retries once without the wrapper on an SSML validation error', async () => {
      const { service, send } = newService(makeConfig());
      const warnSpy = jest
        .spyOn((service as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
        .mockImplementation(() => undefined);

      send.mockImplementation((command) => {
        if (command.input.Text?.includes('amazon:domain')) {
          const err = new Error('Invalid SSML request');
          err.name = 'InvalidSsmlException';
          return Promise.reject(err);
        }
        const payload =
          command.input.OutputFormat === 'json' ? '{"time":0}' : 'MP3';
        return Promise.resolve({ AudioStream: Readable.from(Buffer.from(payload)) });
      });

      const { audio } = await service.synthesize('<speak>hi</speak>');

      // First (wrapped) attempt rejected both calls; retry used the raw SSML.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(audio.toString()).toBe('MP3');
      const retried = inputsOf(send).filter(
        (i) => i.Text === '<speak>hi</speak>',
      );
      expect(retried.length).toBe(2);
    });

    it('does not retry on a non-SSML error', async () => {
      const { service, send } = newService(makeConfig());
      const err = new Error('network down');
      err.name = 'TimeoutError';
      send.mockRejectedValue(err);

      await expect(service.synthesize('<speak>hi</speak>')).rejects.toThrow(
        'network down',
      );
      // Only the first (wrapped) attempt — no retry.
      expect(send).toHaveBeenCalledTimes(2);
    });
  });
});
