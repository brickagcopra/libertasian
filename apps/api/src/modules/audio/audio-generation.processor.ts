import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { AudioRenditionService } from './audio-rendition.service';
import { AUDIO_QUEUE, type AudioGenerationJobData } from './audio.types';

/** BullMQ's own default; one in-flight job leaves a second TTS worker idle. */
const DEFAULT_CONCURRENCY = 2;

/**
 * Worker concurrency, read from the environment rather than ConfigService
 * because `@Processor` is evaluated at class-definition time — before the
 * Nest DI container (and therefore ConfigService) exists.
 *
 * The Joi schema in `app.module.ts` still validates the variable at startup and
 * carries the same default; this guard only exists so a malformed value cannot
 * hand BullMQ a NaN concurrency before that validation runs.
 */
function resolveConcurrency(): number {
  const parsed = Number(process.env['AUDIO_PROCESSOR_CONCURRENCY']);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : DEFAULT_CONCURRENCY;
}

/**
 * BullMQ worker for the `audio-generation` queue. Delegates the full
 * synthesize-and-persist flow to {@link AudioRenditionService.generate};
 * BullMQ handles retries on thrown errors.
 *
 * Concurrency defaults to 2 to match TTS_WORKERS. BullMQ's default of 1 left one
 * of the two uvicorn TTS workers permanently idle — the queue fed synthesis
 * strictly one job at a time. AUDIO_PROCESSOR_CONCURRENCY must not exceed
 * TTS_WORKERS: extra in-flight jobs add no throughput, they queue inside the TTS
 * service, and each concurrent synthesis costs ~2.9 GiB there (prod 2026-07-29).
 */
@Processor(AUDIO_QUEUE, { concurrency: resolveConcurrency() })
export class AudioGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(AudioGenerationProcessor.name);

  constructor(private readonly renditions: AudioRenditionService) {
    super();
  }

  async process(job: Job<AudioGenerationJobData>): Promise<void> {
    const { contentType, contentId } = job.data;
    this.logger.log(`Generating audio for ${contentType}:${contentId}`);
    try {
      await this.renditions.generate(job.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Audio generation failed for ${contentType}:${contentId}: ${message}`,
      );
      throw err; // let BullMQ handle retries
    }
  }
}
