import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DerivativesAdminService } from './derivatives-admin.service';

// ─── Mock factories ────────────────────────────────────────

function makePrisma() {
  return {
    derivativeArtifact: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    derivativeGenerationJob: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'job-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    budgetLedger: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
    legalDocument: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function makeAiSettings() {
  return {
    getSetting: jest.fn().mockResolvedValue(null),
    updateSetting: jest.fn().mockResolvedValue(undefined),
  };
}

function makeAudit() {
  return {
    log: jest.fn().mockResolvedValue(undefined),
  };
}

// ─── Tests ─────────���───────────────────────────────��───────

describe('DerivativesAdminService', () => {
  let service: DerivativesAdminService;
  let prisma: ReturnType<typeof makePrisma>;
  let aiSettings: ReturnType<typeof makeAiSettings>;
  let audit: ReturnType<typeof makeAudit>;

  beforeEach(() => {
    prisma = makePrisma();
    aiSettings = makeAiSettings();
    audit = makeAudit();
    service = new DerivativesAdminService(
      prisma as any,
      aiSettings as any,
      audit as any,
    );
  });

  // ─── getStats ──────────────────────────────────────────

  describe('getStats', () => {
    it('returns per-type artifact counts', async () => {
      prisma.derivativeArtifact.groupBy.mockResolvedValue([
        { derivativeType: 'case_digest', _count: { id: 10 } },
        { derivativeType: 'mcq_question', _count: { id: 5 } },
      ]);

      const result = await service.getStats();

      expect(result.byType).toHaveLength(6);
      const digest = result.byType.find((t) => t.derivativeType === 'case_digest');
      expect(digest?.totalArtifacts).toBe(10);
      const mcq = result.byType.find((t) => t.derivativeType === 'mcq_question');
      expect(mcq?.totalArtifacts).toBe(5);
      // Types with no artifacts should show 0
      const essay = result.byType.find((t) => t.derivativeType === 'essay_prompt');
      expect(essay?.totalArtifacts).toBe(0);
    });

    it('includes spend from budget ledger', async () => {
      prisma.budgetLedger.groupBy.mockResolvedValue([
        {
          scope: 'derivative_type:case_digest',
          _sum: { amountUsd: new Prisma.Decimal('1.50') },
        },
      ]);

      const result = await service.getStats();

      const digest = result.byType.find((t) => t.derivativeType === 'case_digest');
      expect(digest?.spendThisMonth).toBe(1.5);
    });

    it('reads enabled settings', async () => {
      aiSettings.getSetting
        .mockResolvedValueOnce({ key: 'derivative_generation.enabled', value: { enabled: true }, description: null })
        .mockResolvedValueOnce({ key: 'derivative_generation.types_enabled', value: { case_digest: true, mcq_question: false }, description: null });

      const result = await service.getStats();

      expect(result.globalEnabled).toBe(true);
      expect(result.typesEnabled['mcq_question']).toBe(false);
    });
  });

  // ─── getJobs ──────────────────────────────────────────

  describe('getJobs', () => {
    it('returns paginated results', async () => {
      const mockJobs = [{ id: 'job-1' }, { id: 'job-2' }];
      prisma.derivativeGenerationJob.findMany.mockResolvedValue(mockJobs);
      prisma.derivativeGenerationJob.count.mockResolvedValue(2);

      const result = await service.getJobs({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(prisma.derivativeGenerationJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 10,
        }),
      );
    });

    it('filters by derivativeType', async () => {
      await service.getJobs({ derivativeType: 'mcq_question' });

      expect(prisma.derivativeGenerationJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            derivativeType: 'mcq_question',
          }),
        }),
      );
    });

    it('filters by status', async () => {
      await service.getJobs({ status: 'failed' });

      expect(prisma.derivativeGenerationJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'failed',
          }),
        }),
      );
    });
  });

  // ─── getJob ───────────────────────────────────────────

  describe('getJob', () => {
    it('returns job with includes', async () => {
      prisma.derivativeGenerationJob.findUnique.mockResolvedValue({
        id: 'job-1',
        derivativeType: 'case_digest',
        sourceDocument: { id: 'doc-1', title: 'Test' },
        derivativeArtifacts: [],
      });

      const result = await service.getJob('job-1');

      expect(result).toBeDefined();
      expect(prisma.derivativeGenerationJob.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-1' },
          include: expect.any(Object),
        }),
      );
    });

    it('throws NotFoundException for missing job', async () => {
      prisma.derivativeGenerationJob.findUnique.mockResolvedValue(null);

      await expect(service.getJob('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── enqueueGeneration ─────────────────────────────────

  describe('enqueueGeneration', () => {
    beforeEach(() => {
      // Default: generation enabled, all types enabled
      aiSettings.getSetting
        .mockResolvedValueOnce({ key: 'derivative_generation.enabled', value: { enabled: true }, description: null })
        .mockResolvedValueOnce({
          key: 'derivative_generation.types_enabled',
          value: {
            case_digest: true,
            doctrine_extract: true,
            mcq_question: true,
            essay_prompt: true,
            flashcard: true,
            subject_outline: true,
          },
          description: null,
        });
    });

    it('creates pending jobs for matching documents', async () => {
      prisma.legalDocument.findMany.mockResolvedValue([
        { id: 'doc-1' },
        { id: 'doc-2' },
      ]);
      prisma.derivativeGenerationJob.create
        .mockResolvedValueOnce({ id: 'job-1' })
        .mockResolvedValueOnce({ id: 'job-2' });

      const result = await service.enqueueGeneration(
        { derivativeType: 'case_digest' },
        'user-1',
      );

      expect(result.enqueuedCount).toBe(2);
      expect(result.jobIds).toEqual(['job-1', 'job-2']);
      expect(result.estimatedCostUsd).toBeCloseTo(0.16); // 2 * 0.08
      expect(prisma.derivativeGenerationJob.create).toHaveBeenCalledTimes(2);
    });

    it('excludes documents with existing artifacts when regenerateExisting=false', async () => {
      prisma.derivativeArtifact.findMany.mockResolvedValue([
        { sourceDocumentId: 'doc-1' },
      ]);
      prisma.legalDocument.findMany.mockResolvedValue([{ id: 'doc-2' }]);
      prisma.derivativeGenerationJob.create.mockResolvedValue({ id: 'job-1' });

      await service.enqueueGeneration(
        { derivativeType: 'case_digest', regenerateExisting: false },
        'user-1',
      );

      // Should query artifacts to find exclusions
      expect(prisma.derivativeArtifact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            derivativeType: 'case_digest',
            deletedAt: null,
          }),
        }),
      );
    });

    it('respects maxCount limit', async () => {
      prisma.legalDocument.findMany.mockResolvedValue([{ id: 'doc-1' }]);
      prisma.derivativeGenerationJob.create.mockResolvedValue({ id: 'job-1' });

      await service.enqueueGeneration(
        { derivativeType: 'case_digest', maxCount: 5 },
        'user-1',
      );

      expect(prisma.legalDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 5,
        }),
      );
    });

    it('rejects if generation is globally disabled', async () => {
      // Override the default mock
      aiSettings.getSetting.mockReset();
      aiSettings.getSetting
        .mockResolvedValueOnce({ key: 'derivative_generation.enabled', value: { enabled: false }, description: null })
        .mockResolvedValueOnce({ key: 'derivative_generation.types_enabled', value: {}, description: null });

      await expect(
        service.enqueueGeneration(
          { derivativeType: 'case_digest' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if derivative type is disabled', async () => {
      aiSettings.getSetting.mockReset();
      aiSettings.getSetting
        .mockResolvedValueOnce({ key: 'derivative_generation.enabled', value: { enabled: true }, description: null })
        .mockResolvedValueOnce({ key: 'derivative_generation.types_enabled', value: { case_digest: false }, description: null });

      await expect(
        service.enqueueGeneration(
          { derivativeType: 'case_digest' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── retryJob ─────────────────────────────────────────

  describe('retryJob', () => {
    it('resets failed job to pending', async () => {
      prisma.derivativeGenerationJob.findUnique.mockResolvedValue({
        id: 'job-1',
        status: 'failed',
      });

      await service.retryJob('job-1', 'user-1');

      expect(prisma.derivativeGenerationJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'pending',
          errorJson: Prisma.JsonNull,
        }),
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'derivatives_admin.retry_job',
        }),
      );
    });

    it('rejects if job is not failed', async () => {
      prisma.derivativeGenerationJob.findUnique.mockResolvedValue({
        id: 'job-1',
        status: 'completed',
      });

      await expect(service.retryJob('job-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException for missing job', async () => {
      prisma.derivativeGenerationJob.findUnique.mockResolvedValue(null);

      await expect(service.retryJob('nonexistent', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── regenerateArtifact ────────────────────────────────

  describe('regenerateArtifact', () => {
    it('soft-deletes artifact and creates new job', async () => {
      prisma.derivativeArtifact.findUnique.mockResolvedValue({
        id: 'art-1',
        derivativeType: 'case_digest',
        sourceDocumentId: 'doc-1',
        deletedAt: null,
      });
      prisma.derivativeGenerationJob.create.mockResolvedValue({ id: 'job-new' });

      const result = await service.regenerateArtifact('art-1', 'user-1');

      expect(result.jobId).toBe('job-new');
      expect(prisma.derivativeArtifact.update).toHaveBeenCalledWith({
        where: { id: 'art-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.derivativeGenerationJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          derivativeType: 'case_digest',
          sourceDocumentId: 'doc-1',
          status: 'pending',
        }),
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'derivatives_admin.regenerate_artifact',
          entityId: 'art-1',
        }),
      );
    });

    it('throws NotFoundException for missing artifact', async () => {
      prisma.derivativeArtifact.findUnique.mockResolvedValue(null);

      await expect(
        service.regenerateArtifact('nonexistent', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects if artifact is already soft-deleted', async () => {
      prisma.derivativeArtifact.findUnique.mockResolvedValue({
        id: 'art-1',
        derivativeType: 'case_digest',
        sourceDocumentId: 'doc-1',
        deletedAt: new Date(),
      });

      await expect(
        service.regenerateArtifact('art-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getJobEssay ──────────────────────────────────────

  describe('getJobEssay', () => {
    it('returns essay with essayPrompt and contentDisclaimer', async () => {
      prisma.derivativeGenerationJob.findUnique.mockResolvedValue({
        id: 'job-1',
        derivativeType: 'essay_prompt',
        status: 'completed',
      });
      prisma.derivativeArtifact.findFirst.mockResolvedValue({
        id: 'art-1',
        derivativeType: 'essay_prompt',
        title: 'Essay on Command Responsibility',
        confidenceScore: 0.85,
        reviewStatus: 'draft',
        validatorVerdict: 'publish',
        visibility: 'private',
        publishedAt: null,
        createdAt: '2026-04-17T00:00:00Z',
        contentPlainText: null,
        essayPrompt: {
          promptText: 'Discuss the doctrine of command responsibility.',
          suggestedTimeMinutes: 30,
          modelAnswerJson: { outlineSections: [] },
          rubricJson: { totalPoints: 100, criteria: [] },
          subjectTopicId: null,
          barExamSittingId: null,
        },
        contentDisclaimer: { id: 'disc-1', bodyPlain: 'AI-generated content.' },
      });

      const result = await service.getJobEssay('job-1');

      expect(result.jobStatus).toBe('completed');
      expect(result.essay).toBeDefined();
      expect((result.essay as Record<string, unknown>)['essayPrompt']).toBeDefined();
      expect((result.essay as Record<string, unknown>)['contentDisclaimer']).toBeDefined();
    });

    it('returns null essay when job completed but no artifact exists', async () => {
      prisma.derivativeGenerationJob.findUnique.mockResolvedValue({
        id: 'job-1',
        derivativeType: 'essay_prompt',
        status: 'completed',
      });
      prisma.derivativeArtifact.findFirst.mockResolvedValue(null);

      const result = await service.getJobEssay('job-1');

      expect(result.jobStatus).toBe('completed');
      expect(result.essay).toBeNull();
    });

    it('throws NotFoundException for unknown jobId', async () => {
      prisma.derivativeGenerationJob.findUnique.mockResolvedValue(null);

      await expect(service.getJobEssay('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException for wrong derivative type', async () => {
      prisma.derivativeGenerationJob.findUnique.mockResolvedValue({
        id: 'job-1',
        derivativeType: 'case_digest',
        status: 'completed',
      });

      await expect(service.getJobEssay('job-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── softDeleteArtifact ────────────────────────────────

  describe('softDeleteArtifact', () => {
    it('sets deletedAt on artifact', async () => {
      prisma.derivativeArtifact.findUnique.mockResolvedValue({
        id: 'art-1',
        derivativeType: 'mcq_question',
        deletedAt: null,
      });

      await service.softDeleteArtifact('art-1', 'user-1');

      expect(prisma.derivativeArtifact.update).toHaveBeenCalledWith({
        where: { id: 'art-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'derivatives_admin.soft_delete_artifact',
        }),
      );
    });

    it('throws NotFoundException for missing artifact', async () => {
      prisma.derivativeArtifact.findUnique.mockResolvedValue(null);

      await expect(
        service.softDeleteArtifact('nonexistent', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── updateDerivativeSettings ──────────────────────────

  describe('updateDerivativeSettings', () => {
    it('updates ai_settings keys', async () => {
      await service.updateDerivativeSettings(
        { enabled: true, typesEnabled: { case_digest: false } },
        'user-1',
      );

      expect(aiSettings.updateSetting).toHaveBeenCalledWith(
        'derivative_generation.enabled',
        { enabled: true },
        'user-1',
      );
      expect(aiSettings.updateSetting).toHaveBeenCalledWith(
        'derivative_generation.types_enabled',
        { case_digest: false },
        'user-1',
      );
    });

    it('audit logs the change', async () => {
      await service.updateDerivativeSettings(
        { enabled: false },
        'user-1',
      );

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'derivatives_admin.update_settings',
          entityType: 'ai_settings',
          metadata: expect.objectContaining({
            enabled: false,
          }),
        }),
      );
    });
  });
});
