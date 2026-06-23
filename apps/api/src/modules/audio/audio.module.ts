import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { DigestsModule } from '../digests/digests.module';
import { UploadsModule } from '../uploads/uploads.module';
import { AudioController } from './audio.controller';
import { AudioGenerationProcessor } from './audio-generation.processor';
import { AudioRenditionService } from './audio-rendition.service';
import { AUDIO_QUEUE } from './audio.types';
import { toSsml } from './legal-ssml.util';
import { PollyClient } from './polly.client';

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
 * S3Service (via UploadsModule) stores the mp3 + speech-mark objects;
 * DigestsService enforces digest access rules at read time. PrismaService,
 * AuditService, and EntitlementService come from their @Global modules.
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
    AudioRenditionService,
    AudioGenerationProcessor,
    { provide: LEGAL_SSML_NORMALIZER, useValue: toSsml },
  ],
  exports: [PollyClient, AudioRenditionService, LEGAL_SSML_NORMALIZER],
})
export class AudioModule {}
