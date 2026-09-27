import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { JwtPayload } from '@libertasian/types';

import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PLATFORM_PERMISSIONS_KEY } from '../../common/decorators/platform-permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PlatformPermissionsGuard } from '../../common/guards/platform-permissions.guard';
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
/** Platform staff belong to no organization: their JWT carries none. */
const PLATFORM_ADMIN = {
  sub: '00000000-0000-0000-0000-0000000000cc',
  email: 'staff@example.com',
} as JwtPayload;
const DOC_ID = '22222222-2222-4222-8222-222222222222';

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
      .overrideGuard(PlatformPermissionsGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get(VectorBackfillController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('auth gate', () => {
    // This endpoint can start a ~4.3-hour job on the shared embedding box and
    // its read side is a map of which parts of the corpus kNN cannot reach.
    //
    // A PLATFORM route, like /platform/staff and /admin/digests: platform
    // admins belong to no organization, and TenantGuard 403'd them on
    // "No organization context" before any permission check ran.
    it('declares the platform guard stack, with no TenantGuard', () => {
      const guards = (Reflect.getMetadata(GUARDS_METADATA, VectorBackfillController) ??
        []) as unknown[];
      expect(guards).toEqual([JwtAuthGuard, MfaGuard, PlatformPermissionsGuard]);
      expect(guards).not.toContain(TenantGuard);
      expect(guards).not.toContain(PermissionsGuard);
    });

    it('requires PLATFORM admin:ingestion and carries no tenant permission metadata', () => {
      expect(
        Reflect.getMetadata(PLATFORM_PERMISSIONS_KEY, VectorBackfillController),
      ).toEqual({ permissions: ['admin:ingestion'], mode: 'all' });
      expect(Reflect.getMetadata(PERMISSIONS_KEY, VectorBackfillController)).toBeUndefined();
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

    it('starts a run for a platform admin with no organization, auditing the actor', async () => {
      await controller.startRun({ dryRun: true }, PLATFORM_ADMIN);

      expect(backfill.enqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({
          triggeredByUserId: PLATFORM_ADMIN.sub,
          organizationId: undefined,
        }),
      );
      const entry = audit.log.mock.calls[0]![0] as Record<string, unknown>;
      expect(entry['actorUserId']).toBe(PLATFORM_ADMIN.sub);
      expect(entry['organizationId']).toBeUndefined();
    });

    it('treats an empty-string organization as none, never as an id', async () => {
      await controller.startRun({}, { ...PLATFORM_ADMIN, organizationId: '' });
      expect(backfill.enqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: undefined }),
      );
    });

    it('passes documentIds and force through and records them in the audit row', async () => {
      await controller.startRun({ documentIds: [DOC_ID], force: true }, PLATFORM_ADMIN);

      expect(backfill.enqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({ documentIds: [DOC_ID], force: true }),
      );
    });

    it('rejects force without documentIds with 400 before enqueueing anything', async () => {
      await expect(controller.startRun({ force: true }, PLATFORM_ADMIN)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        controller.startRun({ force: true, documentIds: [] }, PLATFORM_ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(backfill.enqueueRun).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('defaults force to false', async () => {
      await controller.startRun({ documentIds: [DOC_ID] }, USER);
      expect(backfill.enqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({ documentIds: [DOC_ID], force: false }),
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
