import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { AuditService } from '../audit/audit.service';
import {
  INDEX_REBUILD_QUEUE,
  IndexRebuildService,
  type IndexRebuildJobData,
  type IndexRebuildResult,
} from './index-rebuild.service';

@Processor(INDEX_REBUILD_QUEUE)
export class IndexRebuildProcessor extends WorkerHost {
  private readonly logger = new Logger(IndexRebuildProcessor.name);

  constructor(
    private readonly rebuildService: IndexRebuildService,
    private readonly auditService: AuditService,
  ) {
    super();
  }

  async process(job: Job<IndexRebuildJobData>): Promise<IndexRebuildResult> {
    this.logger.log(`Starting search index rebuild (job ${job.id}, dryRun=${job.data.dryRun})`);

    try {
      const result = await this.rebuildService.runRebuild(job.data, async (progress) => {
        await job.updateProgress(progress as unknown as Record<string, unknown>);
      });

      await this.auditService.log({
        organizationId: job.data.organizationId,
        actorUserId: job.data.triggeredByUserId,
        actorType: 'admin',
        action: 'search.index.rebuild_completed',
        entityType: 'search_index',
        entityId: result.keywordTarget,
        metadata: {
          jobId: job.id,
          keywordTarget: result.keywordTarget,
          vectorTarget: result.vectorTarget,
          uploadsTarget: result.uploadsTarget,
          verifiedCount: result.verifiedCount,
          aliasSwapped: result.aliasSwapped,
          dryRun: job.data.dryRun,
        },
      });

      this.logger.log(`Search index rebuild finished (job ${job.id}): ${result.message}`);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Search index rebuild failed (job ${job.id}): ${message}`);

      await this.auditService.log({
        organizationId: job.data.organizationId,
        actorUserId: job.data.triggeredByUserId,
        actorType: 'admin',
        action: 'search.index.rebuild_failed',
        entityType: 'search_index',
        metadata: { jobId: job.id, error: message, dryRun: job.data.dryRun },
      });

      throw err;
    }
  }
}
