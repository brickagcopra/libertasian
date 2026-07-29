import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { PrismaService } from '../../prisma/prisma.service';
import { AudioRenditionService } from './audio-rendition.service';
import {
  CONTENT_PUBLISHED_EVENT,
  type ContentPublishedEvent,
} from './audio.events';

/**
 * Enqueues an audio job when content is published.
 *
 * Gated on the same flags as the reconciler, so merging this changes nothing
 * until audio generation is deliberately switched on.
 */
@Injectable()
export class AudioPublishListener {
  private readonly logger = new Logger(AudioPublishListener.name);

  constructor(
    private readonly renditions: AudioRenditionService,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent(CONTENT_PUBLISHED_EVENT, { async: true })
  async handleContentPublished(event: ContentPublishedEvent): Promise<void> {
    try {
      // One indexed lookup so codals are not held behind the decision flag.
      // Publishing a legal document is rare, so this costs nothing in practice.
      const documentType =
        event.contentType === 'legal_document'
          ? await this.resolveDocumentType(event.contentId)
          : undefined;

      if (!this.renditions.isGenerationEnabled(event.contentType, documentType)) {
        return;
      }

      await this.renditions.requestGeneration(
        event.contentType,
        event.contentId,
        event.language ?? 'en',
      );
      this.logger.log(
        `Enqueued audio for newly published ${event.contentType}:${event.contentId}`,
      );
    } catch (err) {
      // Never let an audio failure break a publish flow.
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Failed to enqueue audio for ${event.contentType}:${event.contentId}: ${message}`,
      );
    }
  }

  private async resolveDocumentType(contentId: string): Promise<string | undefined> {
    const row = await this.prisma.legalDocument.findUnique({
      where: { id: contentId },
      select: { documentType: true },
    });
    return row?.documentType;
  }
}
