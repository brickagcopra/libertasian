import { Module } from '@nestjs/common';

import { toSsml } from './legal-ssml.util';
import { PollyClient } from './polly.client';

/**
 * Injection token for the pure legal SSML normalizer ({@link toSsml}).
 * Exposed via DI so future providers (the synthesis processor) can inject it
 * and so it can be swapped in tests without importing the module file directly.
 */
export const LEGAL_SSML_NORMALIZER = Symbol('LEGAL_SSML_NORMALIZER');

/**
 * Audio Corpus — Phase 1 foundation module.
 *
 * Provides the building blocks for text-to-speech rendition of short legal
 * content: the Amazon Polly client and the legal SSML normalizer. The BullMQ
 * processor and controller are intentionally NOT wired here yet.
 */
@Module({
  providers: [
    PollyClient,
    { provide: LEGAL_SSML_NORMALIZER, useValue: toSsml },
  ],
  exports: [PollyClient, LEGAL_SSML_NORMALIZER],
})
export class AudioModule {}
