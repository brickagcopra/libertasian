import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { AuditService } from '../audit/audit.service';
import { DoctrinesService } from './doctrines.service';

interface DoctrineExtractionJobData {
  legalDocumentId: string;
  strategy: string;
  batchId: string;
  triggeredByUserId: string;
}

@Processor('doctrines')
export class DoctrinesProcessor extends WorkerHost {
  private readonly logger = new Logger(DoctrinesProcessor.name);

  constructor(
    private readonly doctrinesService: DoctrinesService,
    private readonly auditService: AuditService,
  ) {
    super();
  }

  async process(job: Job<DoctrineExtractionJobData>): Promise<void> {
    const { legalDocumentId, strategy, batchId, triggeredByUserId } = job.data;

    this.logger.log(
      `Processing doctrine extraction: documentId=${legalDocumentId}, batch=${batchId}, job=${job.id}`,
    );

    try {
      const result = await this.doctrinesService.triggerExtraction({
        legalDocumentId,
        strategy,
      });

      await this.auditService.log({
        actorUserId: triggeredByUserId,
        actorType: 'admin',
        action: 'doctrine.batch_extract_item',
        entityType: 'doctrine_extract',
        entityId: result?.id ?? legalDocumentId,
        metadata: {
          batchId,
          legalDocumentId,
          strategy,
          status: result?.reviewStatus ?? 'unknown',
        },
      });

      this.logger.log(
        `Doctrine extraction completed: documentId=${legalDocumentId}, batch=${batchId}`,
      );
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Doctrine extraction failed: documentId=${legalDocumentId}, batch=${batchId}: ${errorMessage}`,
      );
      throw err;
    }
  }
}
