import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { AuditService } from '../audit/audit.service';
import { VECTOR_BACKFILL_QUEUE } from './vector-backfill.constants';
import {
  VectorBackfillService,
  type VectorBackfillJobData,
  type VectorBackfillResult,
} from './vector-backfill.service';

/**
 * Runs the vector backfill.
 *
 * `concurrency: 1` is a hard requirement, not a tuning choice. Measured
 * throughput is 4.8 texts/s on CPU and the embedding box is shared with TTS;
 * two concurrent runs would halve TTS throughput and enumerate overlapping gaps
 * that each believe they own.
 */
@Processor(VECTOR_BACKFILL_QUEUE, { concurrency: 1 })
export class VectorBackfillProcessor extends WorkerHost {
  private readonly logger = new Logger(VectorBackfillProcessor.name);

  constructor(
    private readonly backfill: VectorBackfillService,
    private readonly auditService: AuditService,
  ) {
    super();
  }

  async process(job: Job<VectorBackfillJobData>): Promise<VectorBackfillResult> {
    const { runId } = job.data;
    this.logger.log(`Starting vector backfill run ${runId} (job ${job.id})`);

    try {
      const result = await this.backfill.runBackfill(job.data, async (progress) => {
        await job.updateProgress(progress as unknown as Record<string, unknown>);
      });

      await this.auditService.log({
        organizationId: job.data.organizationId,
        actorUserId: job.data.triggeredByUserId,
        actorType: 'admin',
        action: `search.vector_backfill.${result.status}`,
        entityType: 'vector_backfill_run',
        entityId: runId,
        metadata: {
          jobId: job.id,
          status: result.status,
          documentsTotal: result.documentsTotal,
          documentsIndexed: result.documentsIndexed,
          documentsSkipped: result.documentsSkipped,
          documentsFailed: result.documentsFailed,
          chunksTotal: result.chunksTotal,
          chunksIndexed: result.chunksIndexed,
          chunksFailed: result.chunksFailed,
          batchesCompleted: result.batchesCompleted,
          batchesFailed: result.batchesFailed,
          gapByType: result.gapByType,
        },
      });

      this.logger.log(`Vector backfill run ${runId} finished: ${result.message}`);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Vector backfill run ${runId} failed: ${message}`);

      await this.backfill.markRunFailed(runId, message);

      await this.auditService.log({
        organizationId: job.data.organizationId,
        actorUserId: job.data.triggeredByUserId,
        actorType: 'admin',
        action: 'search.vector_backfill.failed',
        entityType: 'vector_backfill_run',
        entityId: runId,
        metadata: { jobId: job.id, error: message },
      });

      throw err;
    }
  }
}
