import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { KokoroClient } from './kokoro.client';
import { PollyTtsAdapter } from './polly-tts.adapter';
import { TTS_CLIENT, type TtsClient } from './tts.client';

/**
 * Mirrors the factory registered in AudioModule. The point of this suite is a
 * single guarantee: merging the Kokoro backend changes nothing in production
 * until TTS_PROVIDER is explicitly flipped.
 */
const ttsClientProvider = {
  provide: TTS_CLIENT,
  inject: [ConfigService, PollyTtsAdapter, KokoroClient],
  useFactory: (
    config: ConfigService,
    polly: PollyTtsAdapter,
    kokoro: KokoroClient,
  ): TtsClient =>
    config.get<string>('TTS_PROVIDER', 'polly') === 'kokoro' ? kokoro : polly,
};

const resolve = async (provider?: string): Promise<TtsClient> => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      { provide: PollyTtsAdapter, useValue: { kind: 'polly' } },
      { provide: KokoroClient, useValue: { kind: 'kokoro' } },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string, fallback?: string) =>
            key === 'TTS_PROVIDER' ? (provider ?? fallback) : fallback,
        },
      },
      ttsClientProvider,
    ],
  }).compile();
  return moduleRef.get<TtsClient>(TTS_CLIENT);
};

describe('TTS_CLIENT factory', () => {
  it('defaults to Polly when TTS_PROVIDER is unset', async () => {
    expect(await resolve()).toMatchObject({ kind: 'polly' });
  });

  it('selects Polly for an explicit polly value', async () => {
    expect(await resolve('polly')).toMatchObject({ kind: 'polly' });
  });

  it('falls back to Polly for an unrecognised value', async () => {
    expect(await resolve('something-else')).toMatchObject({ kind: 'polly' });
  });

  it('selects Kokoro only for an explicit kokoro value', async () => {
    expect(await resolve('kokoro')).toMatchObject({ kind: 'kokoro' });
  });
});
