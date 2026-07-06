import { NotFoundException } from '@nestjs/common';

import { DerivativesReviewService } from './derivatives-review.service';

function makeArtifact(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'artifact-1',
    derivativeType: 'case_digest',
    visibility: 'private',
    reviewStatus: 'needs_human_review',
    contentRights: 'ai_generated_derivative',
    createdByUserId: null,
    sourceDocumentId: 'doc-1',
    deletedAt: null,
    subjectAssignments: [],
    ...overrides,
  };
}

function makePrisma() {
  const prisma: any = {
    derivativeArtifact: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    derivativeReview: {
      create: jest.fn().mockImplementation(async ({ data }) => ({
        id: 'review-1',
        ...data,
      })),
    },
    documentSubjectAssignment: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    digest: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
  };
  return prisma;
}

function makeDigests() {
  return {
    batchApprove: jest.fn(async ({ digestIds }: { digestIds: string[] }) => ({
      processed: digestIds.length,
      digestIds,
    })),
  };
}

describe('DerivativesReviewService', () => {
  let service: DerivativesReviewService;
  let prisma: ReturnType<typeof makePrisma>;
  let digests: ReturnType<typeof makeDigests>;

  beforeEach(() => {
    prisma = makePrisma();
    digests = makeDigests();
    service = new DerivativesReviewService(prisma as any, digests as any);
  });

  describe('submitReview — approve', () => {
    it('promotes AI-generated unowned private artifact to public_editorial and sets publishedAt', async () => {
      prisma.derivativeArtifact.findFirst.mockResolvedValue(makeArtifact());
      prisma.derivativeArtifact.update.mockImplementation(async ({ data }: any) => ({
        id: 'artifact-1',
        reviewStatus: data.reviewStatus,
        visibility: data.visibility ?? 'private',
        publishedAt: data.publishedAt ?? null,
      }));

      const result = await service.submitReview('artifact-1', 'reviewer-1', {
        verdict: 'approve',
      });

      expect(result.newStatus).toBe('approved');
      expect(result.newVisibility).toBe('public_editorial');
      expect(prisma.derivativeArtifact.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reviewStatus: 'approved',
            visibility: 'public_editorial',
            publishedAt: expect.any(Date),
          }),
        }),
      );
      expect(prisma.derivativeReview.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            derivativeArtifactId: 'artifact-1',
            reviewerUserId: 'reviewer-1',
            verdict: 'approve',
          }),
        }),
      );
    });

    it('does NOT promote visibility when artifact has a userId owner', async () => {
      prisma.derivativeArtifact.findFirst.mockResolvedValue(
        makeArtifact({ createdByUserId: 'user-9' }),
      );
      prisma.derivativeArtifact.update.mockImplementation(async ({ data }: any) => ({
        id: 'artifact-1',
        reviewStatus: data.reviewStatus,
        visibility: data.visibility ?? 'private',
      }));

      const result = await service.submitReview('artifact-1', 'reviewer-1', {
        verdict: 'approve',
      });

      expect(result.newVisibility).toBe('private');
      expect(prisma.derivativeArtifact.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ visibility: expect.anything() }),
        }),
      );
    });

    it('inherits parent doc subject assignments when artifact has none', async () => {
      prisma.derivativeArtifact.findFirst.mockResolvedValue(makeArtifact());
      prisma.derivativeArtifact.update.mockResolvedValue({
        id: 'artifact-1',
        reviewStatus: 'approved',
        visibility: 'public_editorial',
      });
      prisma.documentSubjectAssignment.findMany.mockResolvedValue([
        { subjectId: 'subj-1', subjectTopicId: null, isPrimary: true },
        { subjectId: 'subj-2', subjectTopicId: 'topic-2', isPrimary: false },
      ]);
      prisma.documentSubjectAssignment.createMany.mockResolvedValue({ count: 2 });

      const result = await service.submitReview('artifact-1', 'reviewer-1', {
        verdict: 'approve',
      });

      expect(prisma.documentSubjectAssignment.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              derivativeArtifactId: 'artifact-1',
              subjectId: 'subj-1',
              isPrimary: true,
              classifiedBy: 'manual',
            }),
            expect.objectContaining({
              derivativeArtifactId: 'artifact-1',
              subjectId: 'subj-2',
              subjectTopicId: 'topic-2',
              isPrimary: false,
            }),
          ],
          skipDuplicates: true,
        }),
      );
      expect(result.subjectsCopiedFromParent).toBe(2);
    });

    it('does not query parent assignments if artifact already has its own', async () => {
      prisma.derivativeArtifact.findFirst.mockResolvedValue(
        makeArtifact({ subjectAssignments: [{ id: 'a1' }] }),
      );
      prisma.derivativeArtifact.update.mockResolvedValue({
        id: 'artifact-1',
        reviewStatus: 'approved',
        visibility: 'public_editorial',
      });

      await service.submitReview('artifact-1', 'reviewer-1', { verdict: 'approve' });

      expect(prisma.documentSubjectAssignment.findMany).not.toHaveBeenCalled();
      expect(prisma.documentSubjectAssignment.createMany).not.toHaveBeenCalled();
    });

    it('approves cleanly without chip when both artifact and parent have no subjects', async () => {
      prisma.derivativeArtifact.findFirst.mockResolvedValue(makeArtifact());
      prisma.derivativeArtifact.update.mockResolvedValue({
        id: 'artifact-1',
        reviewStatus: 'approved',
        visibility: 'public_editorial',
      });
      // Parent doc has not been classified yet — findMany returns [].
      prisma.documentSubjectAssignment.findMany.mockResolvedValue([]);

      const result = await service.submitReview('artifact-1', 'reviewer-1', {
        verdict: 'approve',
      });

      // Query happens (we can't know parent is empty until we ask) but
      // no insert is attempted, and the approval succeeds.
      expect(prisma.documentSubjectAssignment.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.documentSubjectAssignment.createMany).not.toHaveBeenCalled();
      expect(result.newStatus).toBe('approved');
      expect(result.subjectsCopiedFromParent).toBe(0);
    });

    it('does not attempt subject fallback when artifact has no source document', async () => {
      prisma.derivativeArtifact.findFirst.mockResolvedValue(
        makeArtifact({ sourceDocumentId: null }),
      );
      prisma.derivativeArtifact.update.mockResolvedValue({
        id: 'artifact-1',
        reviewStatus: 'approved',
        visibility: 'public_editorial',
      });

      await service.submitReview('artifact-1', 'reviewer-1', { verdict: 'approve' });

      expect(prisma.documentSubjectAssignment.findMany).not.toHaveBeenCalled();
      expect(prisma.documentSubjectAssignment.createMany).not.toHaveBeenCalled();
    });
  });

  describe('submitReview — reject', () => {
    it('marks as rejected, leaves visibility unchanged, does not copy subjects', async () => {
      prisma.derivativeArtifact.findFirst.mockResolvedValue(makeArtifact());
      prisma.derivativeArtifact.update.mockImplementation(async ({ data }: any) => ({
        id: 'artifact-1',
        reviewStatus: data.reviewStatus,
        visibility: 'private',
      }));

      const result = await service.submitReview('artifact-1', 'reviewer-1', {
        verdict: 'reject',
        notes: 'insufficient citation coverage',
      });

      expect(result.newStatus).toBe('rejected');
      expect(result.newVisibility).toBe('private');
      expect(prisma.documentSubjectAssignment.findMany).not.toHaveBeenCalled();
    });
  });

  describe('submitReview — needs_revision', () => {
    it('maps to needs_human_review and leaves visibility unchanged', async () => {
      prisma.derivativeArtifact.findFirst.mockResolvedValue(makeArtifact());
      prisma.derivativeArtifact.update.mockImplementation(async ({ data }: any) => ({
        id: 'artifact-1',
        reviewStatus: data.reviewStatus,
        visibility: 'private',
      }));

      const result = await service.submitReview('artifact-1', 'reviewer-1', {
        verdict: 'needs_revision',
      });

      expect(result.newStatus).toBe('needs_human_review');
      expect(result.newVisibility).toBe('private');
    });
  });

  describe('submitReview — not found', () => {
    it('throws 404 when artifact is missing or soft-deleted', async () => {
      prisma.derivativeArtifact.findFirst.mockResolvedValue(null);
      await expect(
        service.submitReview('missing', 'reviewer-1', { verdict: 'approve' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('submitReview — transactional behavior', () => {
    it('rolls back the artifact update when the review insert throws', async () => {
      prisma.derivativeArtifact.findFirst.mockResolvedValue(makeArtifact());
      prisma.derivativeReview.create.mockRejectedValue(new Error('insert fails'));

      await expect(
        service.submitReview('artifact-1', 'reviewer-1', { verdict: 'approve' }),
      ).rejects.toThrow('insert fails');

      // update should never be called because review.create threw first inside $transaction
      expect(prisma.derivativeArtifact.update).not.toHaveBeenCalled();
    });
  });

  describe('bulkApproveByConfidence', () => {
    it('dryRun returns counts without calling submitReview or batchApprove', async () => {
      prisma.derivativeArtifact.findMany.mockResolvedValue([
        { id: 'a1', derivativeType: 'case_digest' },
        { id: 'a2', derivativeType: 'case_digest' },
        { id: 'a3', derivativeType: 'mcq_question' },
      ]);
      prisma.digest.findMany.mockResolvedValue([{ id: 'd1' }, { id: 'd2' }]);

      const result = await service.bulkApproveByConfidence(
        { threshold: 0.7, dryRun: true },
        'reviewer-1',
      );

      expect(result.dryRun).toBe(true);
      expect(result.artifactsPromoted).toBe(3);
      expect(result.digestsPromoted).toBe(2);
      expect(result.perTypeBreakdown).toEqual(
        expect.arrayContaining([
          { derivativeType: 'case_digest', count: 2 },
          { derivativeType: 'mcq_question', count: 1 },
        ]),
      );
      expect(prisma.derivativeReview.create).not.toHaveBeenCalled();
      expect(prisma.derivativeArtifact.update).not.toHaveBeenCalled();
      expect(digests.batchApprove).not.toHaveBeenCalled();
    });

    it('real run approves every candidate and dispatches digests via batchApprove', async () => {
      prisma.derivativeArtifact.findMany.mockResolvedValue([
        { id: 'a1', derivativeType: 'case_digest' },
        { id: 'a2', derivativeType: 'mcq_question' },
      ]);
      prisma.digest.findMany.mockResolvedValue([{ id: 'd1' }]);

      // Each submitReview call will re-find the artifact + update it.
      prisma.derivativeArtifact.findFirst.mockImplementation(async ({ where }: any) =>
        makeArtifact({ id: where.id }),
      );
      prisma.derivativeArtifact.update.mockImplementation(async ({ data }: any) => ({
        id: 'stub',
        reviewStatus: data.reviewStatus,
        visibility: data.visibility ?? 'private',
      }));

      const result = await service.bulkApproveByConfidence(
        { threshold: 0.75 },
        'reviewer-1',
      );

      expect(result.dryRun).toBe(false);
      expect(result.artifactsPromoted).toBe(2);
      expect(result.digestsPromoted).toBe(1);
      expect(result.errors).toEqual([]);
      expect(prisma.derivativeReview.create).toHaveBeenCalledTimes(2);
      expect(digests.batchApprove).toHaveBeenCalledWith(
        { digestIds: ['d1'], notes: expect.stringContaining('0.75') },
        'reviewer-1',
      );
    });

    it('applies the threshold filter to the Prisma query', async () => {
      prisma.derivativeArtifact.findMany.mockResolvedValue([]);
      prisma.digest.findMany.mockResolvedValue([]);

      await service.bulkApproveByConfidence(
        { threshold: 0.9, dryRun: true },
        'reviewer-1',
      );

      expect(prisma.derivativeArtifact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            confidenceScore: { gte: 0.9 },
            visibility: 'private',
            deletedAt: null,
            reviewStatus: { in: ['draft', 'needs_human_review'] },
          }),
        }),
      );
      expect(prisma.digest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            confidenceScore: { gte: 0.9 },
            reviewStatus: { in: ['ai_generated', 'needs_human_review'] },
          }),
        }),
      );
    });

    it('sweeps ai_generated digests and excludes user-owned/user-scan digests', async () => {
      prisma.derivativeArtifact.findMany.mockResolvedValue([]);
      // Pipeline digests sit in reviewStatus='ai_generated' after confidence
      // scoring — they must be candidates for the bulk sweep.
      prisma.digest.findMany.mockResolvedValue([{ id: 'd-ai-1' }, { id: 'd-ai-2' }]);

      const result = await service.bulkApproveByConfidence(
        { threshold: 0.8, dryRun: true },
        'reviewer-1',
      );

      expect(result.digestsPromoted).toBe(2);
      // The where clause must include pipeline digests (official_pipeline,
      // ai_generated, ...) while excluding user-scan/private digests by
      // origin denylist: only rows outside the user-scan origins with no
      // owning user are eligible (user-scan digests must never be
      // auto-promoted).
      expect(prisma.digest.findMany).toHaveBeenCalledWith({
        where: {
          reviewStatus: { in: ['ai_generated', 'needs_human_review'] },
          confidenceScore: { gte: 0.8 },
          sourceOrigin: { notIn: ['user_scan', 'user_upload', 'camera_capture'] },
          userId: null,
        },
        select: { id: true },
      });
    });

    it('applies the derivativeTypes filter when supplied', async () => {
      prisma.derivativeArtifact.findMany.mockResolvedValue([]);
      prisma.digest.findMany.mockResolvedValue([]);

      await service.bulkApproveByConfidence(
        {
          threshold: 0.7,
          derivativeTypes: ['case_digest', 'doctrine_extract'],
          dryRun: true,
        },
        'reviewer-1',
      );

      expect(prisma.derivativeArtifact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            derivativeType: { in: ['case_digest', 'doctrine_extract'] },
          }),
        }),
      );
    });

    it('skips the digest sweep when includeDigests=false', async () => {
      prisma.derivativeArtifact.findMany.mockResolvedValue([]);

      const result = await service.bulkApproveByConfidence(
        { threshold: 0.7, includeDigests: false, dryRun: true },
        'reviewer-1',
      );

      expect(prisma.digest.findMany).not.toHaveBeenCalled();
      expect(result.digestsPromoted).toBe(0);
    });

    it('continues past a single-artifact failure and reports it in errors[]', async () => {
      prisma.derivativeArtifact.findMany.mockResolvedValue([
        { id: 'a1', derivativeType: 'case_digest' },
        { id: 'a2', derivativeType: 'mcq_question' },
      ]);
      prisma.digest.findMany.mockResolvedValue([]);

      let call = 0;
      prisma.derivativeArtifact.findFirst.mockImplementation(async ({ where }: any) => {
        call += 1;
        if (call === 1) return null; // simulate 404 on a1
        return makeArtifact({ id: where.id });
      });
      prisma.derivativeArtifact.update.mockImplementation(async ({ data }: any) => ({
        id: 'stub',
        reviewStatus: data.reviewStatus,
        visibility: data.visibility ?? 'private',
      }));

      const result = await service.bulkApproveByConfidence(
        { threshold: 0.7, includeDigests: false },
        'reviewer-1',
      );

      expect(result.artifactsPromoted).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        entityType: 'derivative_artifact',
        entityId: 'a1',
      });
    });
  });
});
