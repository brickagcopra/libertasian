import { Test, TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';

import { AuditService } from '../audit/audit.service';
import { VectorBackfillProcessor } from './vector-backfill.processor';
import {
  VectorBackfillService,
  type VectorBackfillJobData,
  type VectorBackfillResult,
} from './vector-backfill.service';

describe('VectorBackfillProcessor', () => {
  let processor: VectorBackfillProcessor;
  let backfill: { runBackfill: jest.Mock; markRunFailed: jest.Mock };
  let audit: { log: jest.Mock };

  const jobData: VectorBackfillJobData = {
    runId: 'run-1',
    triggeredByUserId: 'user-1',
    organizationId: 'org-1',
  };

  const job = { id: 'job-1', data: jobData, updateProgress: jest.fn() } as unknown as Job<
    VectorBackfillJobData
  >;

  const result: VectorBackfillResult = {
    runId: 'run-1',
    status: 'completed',
    phase: 'done',
    documentsTotal: 10,
    documentsProcessed: 10,
    documentsIndexed: 8,
    documentsSkipped: 1,
    documentsFailed: 1,
    chunksTotal: 40,
    chunksIndexed: 36,
    chunksFailed: 4,
    batchesCompleted: 5,
    batchesFailed: 1,
    message: 'Run completed',
    gapByType: {
      codal: {
        documents: 10,
        documentsWithGap: 9,
        expectedChunks: 44,
        missingChunks: 40,
      },
    },
  };

  beforeEach(async () => {
    backfill = {
      runBackfill: jest.fn().mockResolvedValue(result),
      markRunFailed: jest.fn().mockResolvedValue(undefined),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VectorBackfillProcessor,
        { provide: VectorBackfillService, useValue: backfill },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    processor = module.get(VectorBackfillProcessor);
    jest.spyOn(processor['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(processor['logger'], 'error').mockImplementation(() => undefined);
  });

  it('audit-logs the outcome with the counts an operator needs', async () => {
    await processor.process(job);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'search.vector_backfill.completed',
        entityType: 'vector_backfill_run',
        entityId: 'run-1',
        actorUserId: 'user-1',
        organizationId: 'org-1',
        metadata: expect.objectContaining({
          documentsIndexed: 8,
          documentsFailed: 1,
          chunksIndexed: 36,
          chunksFailed: 4,
          batchesFailed: 1,
        }),
      }),
    );
  });

  it('records the terminal state in the audit action, not just "completed"', async () => {
    backfill.runBackfill.mockResolvedValue({ ...result, status: 'paused' });

    await processor.process(job);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'search.vector_backfill.paused' }),
    );
  });

  it('streams progress onto the job', async () => {
    backfill.runBackfill.mockImplementation(
      async (_data: VectorBackfillJobData, report: (p: unknown) => Promise<void>) => {
        await report({ phase: 'embedding', chunksIndexed: 12 });
        return result;
      },
    );

    await processor.process(job);

    expect(job.updateProgress).toHaveBeenCalledWith(
      expect.objectContaining({ chunksIndexed: 12 }),
    );
  });

  // Without this the run row sits in `running` for ever and blocks every
  // subsequent enqueue.
  it('marks the run failed and rethrows when the job blows up', async () => {
    backfill.runBackfill.mockRejectedValue(new Error('postgres is gone'));

    await expect(processor.process(job)).rejects.toThrow('postgres is gone');

    expect(backfill.markRunFailed).toHaveBeenCalledWith('run-1', 'postgres is gone');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'search.vector_backfill.failed',
        metadata: expect.objectContaining({ error: 'postgres is gone' }),
      }),
    );
  });
});
