import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { AutoPromoteService } from './auto-promote.service';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000002';

describe('AutoPromoteService', () => {
  let service: AutoPromoteService;
  let prisma: {
    $transaction: jest.Mock;
    derivativeArtifact: {
      findMany: jest.Mock;
    };
  };
  let txMocks: {
    derivativeArtifact: { updateMany: jest.Mock };
    derivativeReview: { create: jest.Mock };
    auditLog: { create: jest.Mock };
  };
  let configValues: Record<string, unknown>;

  async function makeService(
    overrides: Record<string, unknown> = {},
  ): Promise<void> {
    configValues = {
      AUTO_PROMOTE_CONFIDENCE_THRESHOLD: 0.7,
      AUTO_PROMOTE_EXCLUDED_TYPES: 'mcq_question',
      ...overrides,
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutoPromoteService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: <T>(key: string, fallback: T): T =>
              (configValues[key] as T | undefined) ?? fallback,
          },
        },
      ],
    }).compile();
    service = module.get(AutoPromoteService);
  }

  beforeEach(() => {
    txMocks = {
      derivativeArtifact: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      derivativeReview: {
        create: jest.fn().mockResolvedValue({ id: 'review-1' }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };
    prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(
          async (fn: (tx: typeof txMocks) => Promise<unknown>) => fn(txMocks),
        ),
      derivativeArtifact: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
  });

  // ── shouldAutoPromote / initialVisibilityAndStatus ────────────────

  describe('decision helpers', () => {
    beforeEach(() => makeService());

    it('returns promoted=true at threshold', () => {
      const d = service.initialVisibilityAndStatus(
        'doctrine_extract',
        0.7,
        undefined,
        undefined,
      );
      expect(d).toEqual({
        visibility: 'public_editorial',
        reviewStatus: 'approved',
        promoted: true,
      });
    });

    it('returns dto defaults below threshold', () => {
      const d = service.initialVisibilityAndStatus(
        'doctrine_extract',
        0.69,
        undefined,
        undefined,
      );
      expect(d).toEqual({
        visibility: 'private',
        reviewStatus: 'draft',
        promoted: false,
      });
    });

    it('mcq_question is excluded even at confidence 0.99', () => {
      const d = service.initialVisibilityAndStatus(
        'mcq_question',
        0.99,
        undefined,
        undefined,
      );
      expect(d.promoted).toBe(false);
      expect(d.visibility).toBe('private');
    });

    it('null confidence is never promoted', () => {
      expect(service.shouldAutoPromote('doctrine_extract', null)).toBe(false);
      expect(service.shouldAutoPromote('doctrine_extract', undefined)).toBe(
        false,
      );
    });

    it('honours custom excluded-types config', async () => {
      await makeService({
        AUTO_PROMOTE_EXCLUDED_TYPES: 'flashcard, essay_prompt',
      });
      expect(service.shouldAutoPromote('mcq_question', 0.9)).toBe(true);
      expect(service.shouldAutoPromote('flashcard', 0.9)).toBe(false);
      expect(service.shouldAutoPromote('essay_prompt', 0.9)).toBe(false);
    });

    it('honours custom threshold config', async () => {
      await makeService({ AUTO_PROMOTE_CONFIDENCE_THRESHOLD: 0.9 });
      expect(service.shouldAutoPromote('doctrine_extract', 0.85)).toBe(false);
      expect(service.shouldAutoPromote('doctrine_extract', 0.9)).toBe(true);
    });
  });

  // ── recordAutoPromotion ─────────────────────────────────────────────

  describe('recordAutoPromotion', () => {
    beforeEach(() => makeService());

    it('writes derivativeReview + auditLog atomically inside the supplied tx', async () => {
      await service.recordAutoPromotion(
        txMocks as never,
        'artifact-42',
        'doctrine_extract',
        0.85,
      );

      expect(txMocks.derivativeReview.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          derivativeArtifactId: 'artifact-42',
          reviewerUserId: SYSTEM_USER_ID,
          verdict: 'approve',
          notes: expect.stringContaining('auto-promoted'),
        }),
      });
      expect(txMocks.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: SYSTEM_USER_ID,
          actorType: 'system',
          action: 'derivative_auto_promoted',
          entityType: 'derivative_artifact',
          entityId: 'artifact-42',
          metadataJson: expect.objectContaining({
            threshold: 0.7,
            confidence_score: 0.85,
            derivative_type: 'doctrine_extract',
          }),
        }),
      });
    });
  });

  // ── sweepBacklog ────────────────────────────────────────────────────

  describe('sweepBacklog', () => {
    beforeEach(() => makeService());

    it('skips already-public artifacts (filtered by query)', async () => {
      prisma.derivativeArtifact.findMany.mockResolvedValueOnce([]);

      const result = await service.sweepBacklog();

      expect(result).toEqual({ promoted: 0, scanned: 0 });
      const where = prisma.derivativeArtifact.findMany.mock.calls[0]![0]!.where;
      expect(where.visibility).toBe('private');
      expect(where.reviewStatus).toEqual({
        in: ['draft', 'needs_human_review'],
      });
      expect(where.derivativeType).toEqual({ notIn: ['mcq_question'] });
      expect(where.confidenceScore).toEqual({ gte: 0.7 });
    });

    it('promotes 3 of 5 fixture rows; mcq + sub-threshold untouched', async () => {
      // findMany already filters mcq + sub-threshold via the WHERE clause.
      // Simulate the DB doing its job: only the 3 promotable rows come back.
      prisma.derivativeArtifact.findMany.mockResolvedValueOnce([
        { id: 'a-1', derivativeType: 'doctrine_extract', confidenceScore: 0.82 },
        { id: 'a-2', derivativeType: 'essay_prompt', confidenceScore: 0.91 },
        { id: 'a-3', derivativeType: 'flashcard', confidenceScore: 0.71 },
      ]);

      const result = await service.sweepBacklog();

      expect(result).toEqual({ promoted: 3, scanned: 3 });
      expect(txMocks.derivativeArtifact.updateMany).toHaveBeenCalledTimes(3);
      expect(txMocks.derivativeReview.create).toHaveBeenCalledTimes(3);
      expect(txMocks.auditLog.create).toHaveBeenCalledTimes(3);

      // Each updateMany guards on visibility=private + reviewStatus IN
      // (...) so a concurrent flip doesn't double-count.
      for (const call of txMocks.derivativeArtifact.updateMany.mock.calls) {
        const args = call[0];
        expect(args.where.visibility).toBe('private');
        expect(args.where.reviewStatus).toEqual({
          in: ['draft', 'needs_human_review'],
        });
        expect(args.data).toEqual({
          visibility: 'public_editorial',
          reviewStatus: 'approved',
        });
      }
    });

    it('skips audit/review write when concurrent flip absorbs the row (count=0)', async () => {
      prisma.derivativeArtifact.findMany.mockResolvedValueOnce([
        { id: 'a-1', derivativeType: 'doctrine_extract', confidenceScore: 0.82 },
      ]);
      txMocks.derivativeArtifact.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await service.sweepBacklog();

      expect(result).toEqual({ promoted: 0, scanned: 1 });
      expect(txMocks.derivativeReview.create).not.toHaveBeenCalled();
      expect(txMocks.auditLog.create).not.toHaveBeenCalled();
    });

    it('caps each tick at SWEEP_BATCH_SIZE (100)', async () => {
      const rows = Array.from({ length: 100 }, (_, i) => ({
        id: `a-${i}`,
        derivativeType: 'doctrine_extract',
        confidenceScore: 0.8,
      }));
      prisma.derivativeArtifact.findMany.mockResolvedValueOnce(rows);

      await service.sweepBacklog();

      expect(prisma.derivativeArtifact.findMany.mock.calls[0]![0]!.take).toBe(
        100,
      );
      expect(txMocks.derivativeReview.create).toHaveBeenCalledTimes(100);
    });

    it('one row failure does not block the rest of the page', async () => {
      prisma.derivativeArtifact.findMany.mockResolvedValueOnce([
        { id: 'a-1', derivativeType: 'doctrine_extract', confidenceScore: 0.8 },
        { id: 'a-2', derivativeType: 'essay_prompt', confidenceScore: 0.85 },
      ]);
      // Fail the first row's tx; second should still run.
      prisma.$transaction
        .mockImplementationOnce(async () => {
          throw new Error('row 1 boom');
        })
        .mockImplementationOnce(
          async (fn: (tx: typeof txMocks) => Promise<unknown>) => fn(txMocks),
        );

      const result = await service.sweepBacklog();
      expect(result.promoted).toBe(1);
      expect(result.scanned).toBe(2);
    });
  });
});
