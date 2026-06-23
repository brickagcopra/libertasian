import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { AudioRenditionService } from './audio-rendition.service';
import { AUDIO_QUEUE, type AudioGenerationJobData } from './audio.types';

/**
 * BullMQ worker for the `audio-generation` queue. Delegates the full
 * synthesize-and-persist flow to {@link AudioRenditionService.generate};
 * BullMQ handles retries on thrown errors.
 */
@Processor(AUDIO_QUEUE)
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
