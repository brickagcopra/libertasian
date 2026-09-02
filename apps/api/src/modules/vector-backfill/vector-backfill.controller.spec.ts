import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { JwtPayload } from '@libertasian/types';

import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { AuditService } from '../audit/audit.service';
import { VectorBackfillController } from './vector-backfill.controller';
import { VectorBackfillService } from './vector-backfill.service';

const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

const RUN_ID = '11111111-1111-1111-1111-111111111111';
const USER: JwtPayload = {
  sub: '00000000-0000-0000-0000-0000000000aa',
  organizationId: '00000000-0000-0000-0000-0000000000bb',
} as JwtPayload;

describe('VectorBackfillController', () => {
  let controller: VectorBackfillController;
  let backfill: {
    enumerateGap: jest.Mock;
    enqueueRun: jest.Mock;
    listRuns: jest.Mock;
    getRun: jest.Mock;
    listRunDocuments: jest.Mock;
    signal: jest.Mock;
    resume: jest.Mock;
  };
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    backfill = {
      enumerateGap: jest.fn().mockResolvedValue({ missingChunks: 73_826, byType: {} }),
      enqueueRun: jest
        .fn()
        .mockResolvedValue({ id: RUN_ID, jobId: 'job-1', dryRun: false, batchSize: 64 }),
      listRuns: jest.fn().mockResolvedValue([]),
      getRun: jest.fn().mockResolvedValue({ id: RUN_ID, status: 'running' }),
      listRunDocuments: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      signal: jest.fn().mockResolvedValue({ id: RUN_ID, jobId: 'job-1' }),
      resume: jest.fn().mockResolvedValue({ id: 'run-2', jobId: 'job-2' }),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VectorBackfillController],
      providers: [
        { provide: VectorBackfillService, useValue: backfill },
        { provide: AuditService, useValue: audit },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(MfaGuard)
      .useValue(mockGuard)
      .overrideGuard(TenantGuard)
      .useValue(mockGuard)
      .overrideGuard(PermissionsGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get(VectorBackfillController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('auth gate', () => {
    // This endpoint can start a ~4.3-hour job on the shared embedding box and
    // its read side is a map of which parts of the corpus kNN cannot reach.
    it('declares the same guard stack as the other admin search endpoints', () => {
      const guards = (Reflect.getMetadata(GUARDS_METADATA, VectorBackfillController) ??
        []) as unknown[];
      expect(guards).toEqual([JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard]);
    });

    it('requires admin:ingestion', () => {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, VectorBackfillController)).toEqual({
        permissions: ['admin:ingestion'],
        mode: 'all',
      });
    });
  });

  describe('gap', () => {
    it('reports the gap without starting anything', async () => {
      const result = await controller.getGap({ documentTypes: ['codal'] });

      expect(backfill.enumerateGap).toHaveBeenCalledWith({
        documentTypes: ['codal'],
        maxDocuments: undefined,
      });
      expect(backfill.enqueueRun).not.toHaveBeenCalled();
      expect(result.data).toMatchObject({ missingChunks: 73_826 });
    });
  });

  describe('startRun', () => {
    it('passes the actor through and audit-logs the request', async () => {
      await controller.startRun({ dryRun: true, batchSize: 32 }, USER);

      expect(backfill.enqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({
          dryRun: true,
          batchSize: 32,
          triggeredByUserId: USER.sub,
          organizationId: USER.organizationId,
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'search.vector_backfill.requested',
          entityType: 'vector_backfill_run',
          entityId: RUN_ID,
          actorUserId: USER.sub,
        }),
      );
    });
  });

  describe('control endpoints', () => {
    it('pause signals and audit-logs', async () => {
      await controller.pauseRun(RUN_ID, USER);
      expect(backfill.signal).toHaveBeenCalledWith(RUN_ID, 'pause');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'search.vector_backfill.pause_requested' }),
      );
    });

    it('cancel signals and audit-logs', async () => {
      await controller.cancelRun(RUN_ID, USER);
      expect(backfill.signal).toHaveBeenCalledWith(RUN_ID, 'cancel');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'search.vector_backfill.cancel_requested' }),
      );
    });

    it('resume audit-logs the run it came from', async () => {
      await controller.resumeRun(RUN_ID, USER);
      expect(backfill.resume).toHaveBeenCalledWith(RUN_ID, {
        userId: USER.sub,
        organizationId: USER.organizationId,
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'search.vector_backfill.resumed',
          entityId: 'run-2',
          metadata: expect.objectContaining({ resumedFrom: RUN_ID }),
        }),
      );
    });
  });

  describe('status endpoints', () => {
    it('returns a run', async () => {
      const result = await controller.getRun(RUN_ID);
      expect(result.data).toMatchObject({ id: RUN_ID, status: 'running' });
    });

    it('passes the status filter and cursor through to the service', async () => {
      await controller.listRunDocuments(RUN_ID, { status: 'failed', limit: 25 });
      expect(backfill.listRunDocuments).toHaveBeenCalledWith(RUN_ID, {
        status: 'failed',
        cursor: undefined,
        limit: 25,
      });
    });

    // Reads must not write an audit row — the audit log is append-only and
    // 2-year retained; polling a progress bar should not fill it.
    it('does not audit-log reads', async () => {
      await controller.getGap({});
      await controller.getRun(RUN_ID);
      await controller.listRuns({});
      await controller.listRunDocuments(RUN_ID, {});
      expect(audit.log).not.toHaveBeenCalled();
    });
  });
});
