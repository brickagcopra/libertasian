import { Injectable } from '@nestjs/common';

import { PollyClient } from './polly.client';
import type { SynthesisResult, TtsClient, TtsSynthesisInput } from './tts.client';

/**
 * Adapts the existing {@link PollyClient} to the {@link TtsClient} contract.
 *
 * Kept as a thin adapter rather than changing PollyClient's own signature so
 * the Polly path — which every current rendition depends on — is not touched.
 */
@Injectable()
export class PollyTtsAdapter implements TtsClient {
  constructor(private readonly polly: PollyClient) {}

  async synthesize(
    input: TtsSynthesisInput,
    voiceId?: string,
  ): Promise<SynthesisResult> {
    return this.polly.synthesize(input.ssml, voiceId);
  }
}
