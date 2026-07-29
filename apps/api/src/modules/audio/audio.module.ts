import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DigestsModule } from '../digests/digests.module';
import { UploadsModule } from '../uploads/uploads.module';
import { AudioController } from './audio.controller';
import { AudioGenerationProcessor } from './audio-generation.processor';
import { AudioPublishListener } from './audio-publish.listener';
import { AudioReconcilerService } from './audio-reconciler.service';
import { AudioRenditionService } from './audio-rendition.service';
import { AudioStorageService } from './audio-storage.service';
import { AUDIO_QUEUE } from './audio.types';
import { KokoroClient } from './kokoro.client';
import { toSsml } from './legal-ssml.util';
import { PollyClient } from './polly.client';
import { PollyTtsAdapter } from './polly-tts.adapter';
import { TTS_CLIENT, type TtsClient } from './tts.client';

/**
 * Injection token for the pure legal SSML normalizer ({@link toSsml}).
 * Exposed via DI so providers can inject it and so it can be swapped in tests
 * without importing the module file directly.
 */
export const LEGAL_SSML_NORMALIZER = Symbol('LEGAL_SSML_NORMALIZER');

/**
 * Audio Corpus module — text-to-speech rendition of short legal content.
 *
 * Phase 1: Polly client + legal SSML normalizer (the building blocks).
 * Phase 2: the `audio-generation` BullMQ queue + processor, the synthesis
 * service, and the read/force-render controller.
 *
 * AudioStorageService stores the mp3 + speech-mark objects — it delegates to
 * S3Service (via UploadsModule) unless AUDIO_S3_ENDPOINT routes audio to its own
 * bucket. DigestsService enforces digest access rules at read time.
 * PrismaService, AuditService, and EntitlementService come from their @Global
 * modules.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: AUDIO_QUEUE }),
    UploadsModule,
    DigestsModule,
  ],
  controllers: [AudioController],
  providers: [
    PollyClient,
    PollyTtsAdapter,
    KokoroClient,
    AudioStorageService,
    AudioRenditionService,
    AudioGenerationProcessor,
    AudioPublishListener,
    AudioReconcilerService,
    { provide: LEGAL_SSML_NORMALIZER, useValue: toSsml },
    {
      // Polly is the default and stays the default. Only an explicit
      // TTS_PROVIDER=kokoro selects the self-hosted backend, which makes the
      // whole feature reversible by environment variable alone.
      provide: TTS_CLIENT,
      inject: [ConfigService, PollyTtsAdapter, KokoroClient],
      useFactory: (
        config: ConfigService,
        polly: PollyTtsAdapter,
        kokoro: KokoroClient,
      ): TtsClient =>
        config.get<string>('TTS_PROVIDER', 'polly') === 'kokoro' ? kokoro : polly,
    },
  ],
  exports: [
    PollyClient,
    AudioRenditionService,
    LEGAL_SSML_NORMALIZER,
    TTS_CLIENT,
  ],
})
export class AudioModule {}
