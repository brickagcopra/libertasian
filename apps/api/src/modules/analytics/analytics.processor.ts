import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import type { AnalyticsEventPayload } from './analytics.service';

/**
 * BullMQ worker for the analytics-events queue.
 * Processes events in batches of 100 for efficient DB writes.
 *
 * Per LIBERTASIAN-ANALYTICS.md:
 * - Append-only writes to analytics_events
 * - Batch processing for throughput
 * - Non-blocking — API enqueues and returns immediately
 */
@Processor('analytics-events', {
  concurrency: 5,
})
export class AnalyticsProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalyticsProcessor.name);

  /** Buffer for batch writes */
  private buffer: AnalyticsEventPayload[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private static readonly BATCH_SIZE = 100;
  private static readonly FLUSH_INTERVAL_MS = 2000;

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<AnalyticsEventPayload>): Promise<void> {
    const payload = job.data;

    this.buffer.push(payload);

    if (this.buffer.length >= AnalyticsProcessor.BATCH_SIZE) {
      await this.flushBuffer();
    } else if (!this.flushTimer) {
      // Set a timer to flush partial batches
      this.flushTimer = setTimeout(() => {
        this.flushBuffer().catch((err) => {
          this.logger.error('Flush timer error', (err as Error).message);
        });
      }, AnalyticsProcessor.FLUSH_INTERVAL_MS);
    }
  }

  private async flushBuffer(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0, AnalyticsProcessor.BATCH_SIZE);

    try {
      await this.prisma.analyticsEvent.createMany({
        data: batch.map((event) => ({
          eventName: event.eventName,
          eventCategory: event.eventCategory,
          userId: event.userId ?? null,
          organizationId: event.organizationId ?? null,
          sessionId: event.sessionId ?? null,
          deviceType: event.deviceType ?? null,
          properties: event.properties as Prisma.InputJsonValue,
          metadata: event.metadata as Prisma.InputJsonValue,
          durationMs: event.durationMs ?? null,
          createdAt: new Date(event.createdAt),
        })),
        skipDuplicates: true,
      });

      this.logger.debug(`Flushed ${batch.length} analytics events to database`);
    } catch (err) {
      this.logger.error(
        `Failed to flush ${batch.length} analytics events: ${(err as Error).message}`,
      );
      // Re-add failed events to buffer for retry on next flush
      this.buffer.unshift(...batch);
      throw err;
    }
  }
}
