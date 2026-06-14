import { NotFoundException } from '@nestjs/common';

import { PaywallException } from '../../common/exceptions/paywall.exception';
import { DerivativesService } from './derivatives.service';

function makePrisma() {
  return {
    derivativeArtifact: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    digest: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
    barExamAnswer: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
    subject: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    documentSubjectAssignment: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
}

function makeSubscriptions(planCode = 'free') {
  return {
    getPlanCode: jest.fn().mockResolvedValue(planCode),
  };
}

describe('DerivativesService', () => {
  let service: DerivativesService;
  let prisma: ReturnType<typeof makePrisma>;
  let subs: ReturnType<typeof makeSubscriptions>;

  beforeEach(() => {
    prisma = makePrisma();
    subs = makeSubscriptions();
    service = new DerivativesService(prisma as any, subs as any);
  });

  describe('list — visibility filter', () => {
    it('includes own private, org non-private, and public_editorial+approved; never drafts of others', async () => {
      prisma.derivativeArtifact.findMany.mockResolvedValue([]);
      await service.list('user-1', 'org-1', {});

      const call = prisma.derivativeArtifact.findMany.mock.calls[0][0];
      expect(call.where.deletedAt).toBeNull();
      const visibilityClauses = call.where.AND[0].OR;
      expect(visibilityClauses).toEqual(
        expect.arrayContaining([
          { createdByUserId: 'user-1' },
          { organizationId: 'org-1', visibility: { not: 'private' } },
          { visibility: 'public_editorial', reviewStatus: 'approved' },
        ]),
      );
    });

    it('filters by subjectCode via assignments.some when provided', async () => {
      prisma.derivativeArtifact.findMany.mockResolvedValue([]);
      await service.list('user-1', 'org-1', {
        subjectCode: 'political_law',
        taxonomyVersion: 'study_8',
      });

      const call = prisma.derivativeArtifact.findMany.mock.calls[0][0];
      expect(call.where.subjectAssignments).toEqual({
        some: {
          subject: { code: 'political_law', taxonomyVersion: 'study_8' },
        },
      });
    });

    it('filters by derivativeType and search (case-insensitive)', async () => {
      prisma.derivativeArtifact.findMany.mockResolvedValue([]);
      await service.list('user-1', 'org-1', {
        derivativeType: 'mcq_question',
        search: 'constitution',
      });

      const call = prisma.derivativeArtifact.findMany.mock.calls[0][0];
      expect(call.where.derivativeType).toBe('mcq_question');
      expect(call.where.title).toEqual({ contains: 'constitution', mode: 'insensitive' });
    });
  });

  describe('list — subscription gating', () => {
    const makeRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
      id: 'a1',
      title: 'Sample MCQ',
      derivativeType: 'mcq_question',
      confidenceScore: 0.9,
      createdAt: new Date('2026-04-20'),
      publishedAt: null,
      audience: 'both',
      language: 'en',
      sourceDocument: null,
      subjectAssignments: [],
      contentDisclaimer: { id: 'cd', contentClass: 'mcq', version: 1 },
      ...overrides,
    });

    it('flags gated types for free-tier users with upgradeTier=edu', async () => {
      subs.getPlanCode.mockResolvedValue('free');
      prisma.derivativeArtifact.findMany.mockResolvedValue([makeRow()]);

      const { items } = await service.list('user-1', 'org-1', {});
      const [first] = items;
      expect(first).toBeDefined();

      expect(first!.isGated).toBe(true);
      expect(first!.upgradeTier).toBe('edu');
    });

    it('does NOT gate for edu-tier and above', async () => {
      subs.getPlanCode.mockResolvedValue('edu');
      prisma.derivativeArtifact.findMany.mockResolvedValue([makeRow()]);

      const { items } = await service.list('user-1', 'org-1', {});
      const [first] = items;
      expect(first).toBeDefined();

      expect(first!.isGated).toBe(false);
      expect(first!.upgradeTier).toBeNull();
    });

    it('does NOT gate non-MCQ/essay types regardless of tier', async () => {
      subs.getPlanCode.mockResolvedValue('free');
      prisma.derivativeArtifact.findMany.mockResolvedValue([
        makeRow({ derivativeType: 'case_digest' }),
      ]);

      const { items } = await service.list('user-1', 'org-1', {});
      const [first] = items;
      expect(first).toBeDefined();

      expect(first!.isGated).toBe(false);
    });
  });

  describe('findOne', () => {
    it('throws NotFound (not Forbidden) when outside visibility — prevents cross-tenant leak', async () => {
      prisma.derivativeArtifact.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne('a1', 'user-1', 'org-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('redacts answer fields from contentJson for gated users', async () => {
      subs.getPlanCode.mockResolvedValue('free');
      prisma.derivativeArtifact.findFirst.mockResolvedValue({
        id: 'a1',
        title: 'Sample MCQ',
        derivativeType: 'mcq_question',
        confidenceScore: 0.9,
        createdAt: new Date(),
        publishedAt: null,
        audience: 'both',
        language: 'en',
        contentJson: {
          stem: 'What is the doctrine?',
          options: ['A', 'B'],
          correctAnswer: 'A',
          explanation: 'Secret rationale',
        },
        contentPlainText: 'full text',
        sourceDocument: null,
        subjectAssignments: [],
        contentDisclaimer: {
          id: 'cd',
          contentClass: 'mcq',
          version: 1,
          bodyHtml: '<p>disc</p>',
          bodyPlain: 'disc',
        },
        mcqQuestion: { id: 'm1', stem: 'Q', correctOptionId: 'opt-a' },
        essayPrompt: null,
      });

      const result = await service.findOne('a1', 'user-1', 'org-1');

      expect(result.isGated).toBe(true);
      const gatedContent = result.contentJson as Record<string, unknown>;
      expect(gatedContent['stem']).toBe('What is the doctrine?');
      expect(gatedContent['options']).toEqual(['A', 'B']);
      expect(gatedContent).not.toHaveProperty('correctAnswer');
      expect(gatedContent).not.toHaveProperty('explanation');
      expect(result.contentPlainText).toBeNull();
      expect(result.mcqQuestion).toBeNull();
    });

    it('returns full content to edu-tier users', async () => {
      subs.getPlanCode.mockResolvedValue('edu');
      prisma.derivativeArtifact.findFirst.mockResolvedValue({
        id: 'a1',
        title: 'Sample MCQ',
        derivativeType: 'mcq_question',
        confidenceScore: 0.9,
        createdAt: new Date(),
        publishedAt: null,
        audience: 'both',
        language: 'en',
        contentJson: { stem: 'Q', correctAnswer: 'A' },
        contentPlainText: 'full',
        sourceDocument: null,
        subjectAssignments: [],
        contentDisclaimer: {
          id: 'cd',
          contentClass: 'mcq',
          version: 1,
          bodyHtml: '<p>disc</p>',
          bodyPlain: 'disc',
        },
        mcqQuestion: { id: 'm1' },
        essayPrompt: null,
      });

      const result = await service.findOne('a1', 'user-1', 'org-1');

      expect(result.isGated).toBe(false);
      expect(result.contentPlainText).toBe('full');
      expect((result.contentJson as Record<string, unknown>)['correctAnswer']).toBe('A');
      expect(result.mcqQuestion).toEqual({ id: 'm1' });
    });
  });

  describe('subjectsSummary', () => {
    it('returns all subjects in taxonomy with zero counts for empty subjects', async () => {
      prisma.subject.findMany.mockResolvedValue([
        { id: 's1', code: 'political_law', name: 'Political Law', taxonomyVersion: 'study_8' },
        { id: 's2', code: 'civil_law', name: 'Civil Law', taxonomyVersion: 'study_8' },
      ]);
      prisma.documentSubjectAssignment.groupBy.mockResolvedValue([
        { subjectId: 's1', _count: { _all: 5 } },
      ]);

      const result = await service.subjectsSummary('study_8');

      expect(result).toEqual([
        {
          code: 'political_law',
          name: 'Political Law',
          taxonomyVersion: 'study_8',
          count: 5,
        },
        { code: 'civil_law', name: 'Civil Law', taxonomyVersion: 'study_8', count: 0 },
      ]);
    });
  });

  describe('subjectsSummaryByType', () => {
    const fullTaxonomy = [
      { id: 's1', code: 'political_law', name: 'Political Law', taxonomyVersion: 'study_8' },
      { id: 's2', code: 'civil_law', name: 'Civil Law', taxonomyVersion: 'study_8' },
      { id: 's3', code: 'criminal_law', name: 'Criminal Law', taxonomyVersion: 'study_8' },
      { id: 's4', code: 'labor_law', name: 'Labor Law and Social Legislation', taxonomyVersion: 'study_8' },
      { id: 's5', code: 'mercantile_law', name: 'Mercantile (Commercial) Law', taxonomyVersion: 'study_8' },
      { id: 's6', code: 'taxation', name: 'Taxation', taxonomyVersion: 'study_8' },
      { id: 's7', code: 'remedial_law', name: 'Remedial Law', taxonomyVersion: 'study_8' },
      { id: 's8', code: 'legal_ethics', name: 'Legal and Judicial Ethics', taxonomyVersion: 'study_8' },
    ];

    it('returns all 8 taxonomy subjects even when counts are zero', async () => {
      prisma.subject.findMany.mockResolvedValue(fullTaxonomy);
      prisma.documentSubjectAssignment.groupBy.mockResolvedValue([]);

      const result = await service.subjectsSummaryByType(
        'mcq_question',
        'user-1',
        'org-1',
        'study_8',
      );

      expect(result).toHaveLength(8);
      expect(result.map((r) => r.subjectCode)).toEqual([
        'political_law',
        'civil_law',
        'criminal_law',
        'labor_law',
        'mercantile_law',
        'taxation',
        'remedial_law',
        'legal_ethics',
      ]);
      expect(result.every((r) => r.totalCount === 0 && r.approvedCount === 0)).toBe(true);
    });

    it('includes zero-count subjects alongside populated ones', async () => {
      prisma.subject.findMany.mockResolvedValue(fullTaxonomy);
      prisma.documentSubjectAssignment.groupBy
        .mockResolvedValueOnce([{ subjectId: 's3', _count: { _all: 5 } }])
        .mockResolvedValueOnce([{ subjectId: 's3', _count: { _all: 3 } }]);

      const result = await service.subjectsSummaryByType(
        'mcq_question',
        'user-1',
        'org-1',
        'study_8',
      );

      const criminal = result.find((r) => r.subjectCode === 'criminal_law');
      expect(criminal).toEqual({
        subjectCode: 'criminal_law',
        subjectName: 'Criminal Law',
        taxonomyVersion: 'study_8',
        totalCount: 5,
        approvedCount: 3,
      });

      const civil = result.find((r) => r.subjectCode === 'civil_law');
      expect(civil?.totalCount).toBe(0);
      expect(civil?.approvedCount).toBe(0);
    });

    it('applies tenant-visibility OR (own / org non-private / public_editorial+approved) to totalCount', async () => {
      prisma.subject.findMany.mockResolvedValue(fullTaxonomy);
      prisma.documentSubjectAssignment.groupBy.mockResolvedValue([]);

      await service.subjectsSummaryByType('mcq_question', 'user-1', 'org-1', 'study_8');

      const totalCall = prisma.documentSubjectAssignment.groupBy.mock.calls[0][0];
      const where = totalCall.where;
      expect(where.derivativeArtifact.deletedAt).toBeNull();
      expect(where.derivativeArtifact.derivativeType).toBe('mcq_question');
      expect(where.derivativeArtifact.OR).toEqual(
        expect.arrayContaining([
          { createdByUserId: 'user-1' },
          { organizationId: 'org-1', visibility: { not: 'private' } },
          { visibility: 'public_editorial', reviewStatus: 'approved' },
        ]),
      );
    });

    it('restricts approvedCount to public_editorial + approved regardless of tenancy', async () => {
      prisma.subject.findMany.mockResolvedValue(fullTaxonomy);
      prisma.documentSubjectAssignment.groupBy.mockResolvedValue([]);

      await service.subjectsSummaryByType('mcq_question', 'user-1', 'org-1', 'study_8');

      const approvedCall = prisma.documentSubjectAssignment.groupBy.mock.calls[1][0];
      const where = approvedCall.where;
      expect(where.derivativeArtifact.visibility).toBe('public_editorial');
      expect(where.derivativeArtifact.reviewStatus).toBe('approved');
      expect(where.derivativeArtifact.OR).toBeUndefined();
    });

    describe('case_digest special case (legacy digests table)', () => {
      it('returns non-zero counts from digests grouped by subject when visible', async () => {
        prisma.subject.findMany.mockResolvedValue(fullTaxonomy);
        // 8 subjects → 8 parallel digest.count calls
        prisma.digest.count
          .mockResolvedValueOnce(12) // political_law
          .mockResolvedValueOnce(0) // civil_law
          .mockResolvedValueOnce(7) // criminal_law
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(3) // remedial_law
          .mockResolvedValueOnce(0);

        const result = await service.subjectsSummaryByType(
          'case_digest',
          'user-1',
          'org-1',
          'study_8',
        );

        const political = result.find((r) => r.subjectCode === 'political_law');
        expect(political).toEqual({
          subjectCode: 'political_law',
          subjectName: 'Political Law',
          taxonomyVersion: 'study_8',
          totalCount: 12,
          approvedCount: 12,
        });

        // total === approved for case_digest (single visibility-filter count
        // serves both — auto-promote sweep keeps review_status='ai_generated').
        for (const row of result) {
          expect(row.totalCount).toBe(row.approvedCount);
        }

        // Sanity: artifact groupBy path NOT used for case_digest
        expect(prisma.documentSubjectAssignment.groupBy).not.toHaveBeenCalled();
      });

      it('counts both approved and ai_generated review statuses (single visibility query)', async () => {
        prisma.subject.findMany.mockResolvedValue(fullTaxonomy);
        prisma.digest.count.mockResolvedValue(0);

        await service.subjectsSummaryByType('case_digest', 'user-1', 'org-1', 'study_8');

        // All 8 count calls must filter to public_editorial + approved|ai_generated
        for (const call of prisma.digest.count.mock.calls) {
          const where = call[0].where;
          expect(where.visibility).toBe('public_editorial');
          expect(where.reviewStatus).toEqual({ in: ['approved', 'ai_generated'] });
        }
      });

      it('excludes private and needs_human_review digests via the visibility filter', async () => {
        prisma.subject.findMany.mockResolvedValue(fullTaxonomy);
        prisma.digest.count.mockResolvedValue(0);

        await service.subjectsSummaryByType('case_digest', 'user-1', 'org-1', 'study_8');

        for (const call of prisma.digest.count.mock.calls) {
          const where = call[0].where;
          // visibility filter is strict equality to public_editorial — excludes 'private'
          expect(where.visibility).toBe('public_editorial');
          // reviewStatus 'in' set must NOT include 'needs_human_review' or 'draft'
          expect(where.reviewStatus.in).not.toContain('needs_human_review');
          expect(where.reviewStatus.in).not.toContain('draft');
          expect(where.reviewStatus.in).not.toContain('rejected');
        }
      });

      it('joins via legalDocument.subjectAssignments (not derivativeArtifact)', async () => {
        prisma.subject.findMany.mockResolvedValue(fullTaxonomy);
        prisma.digest.count.mockResolvedValue(0);

        await service.subjectsSummaryByType('case_digest', 'user-1', 'org-1', 'study_8');

        const firstCall = prisma.digest.count.mock.calls[0][0];
        expect(firstCall.where.legalDocument).toEqual({
          subjectAssignments: { some: { subjectId: 's1' } },
        });
      });
    });
  });

  describe('list — case_digest special case', () => {
    const makeDigestRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
      id: 'd1',
      title: 'People v. Doe — Search & Seizure',
      confidenceScore: 0.85,
      createdAt: new Date('2026-05-01'),
      summary: 'Sum',
      facts: 'F',
      petitionerArguments: 'P args',
      respondentArguments: 'R args',
      issues: 'WON the search was valid',
      ruling: 'Affirmed',
      doctrine: 'Plain view',
      dispositive: 'Petition denied',
      legalDocument: {
        id: 'doc-1',
        title: 'People v. Doe',
        shortTitle: 'Doe',
        citationText: 'G.R. No. 12345',
        court: 'SC',
        decisionDate: new Date('2024-06-15'),
        subjectAssignments: [
          {
            isPrimary: true,
            subject: {
              code: 'criminal_law',
              name: 'Criminal Law',
              taxonomyVersion: 'study_8',
            },
          },
        ],
      },
      contentDisclaimer: { id: 'cd', contentClass: 'digest', version: 1 },
      ...overrides,
    });

    it('queries the digests table (not derivative_artifacts) when derivativeType=case_digest', async () => {
      prisma.digest.findMany.mockResolvedValue([makeDigestRow()]);

      const { items } = await service.list('user-1', 'org-1', {
        derivativeType: 'case_digest',
      });

      expect(prisma.digest.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.derivativeArtifact.findMany).not.toHaveBeenCalled();
      expect(items).toHaveLength(1);
    });

    it('applies the public_editorial + (approved|ai_generated) visibility filter', async () => {
      prisma.digest.findMany.mockResolvedValue([]);

      await service.list('user-1', 'org-1', { derivativeType: 'case_digest' });

      const call = prisma.digest.findMany.mock.calls[0][0];
      expect(call.where.visibility).toBe('public_editorial');
      expect(call.where.reviewStatus).toEqual({ in: ['approved', 'ai_generated'] });
    });

    it('filters by subjectCode via legalDocument.subjectAssignments.some', async () => {
      prisma.digest.findMany.mockResolvedValue([]);

      await service.list('user-1', 'org-1', {
        derivativeType: 'case_digest',
        subjectCode: 'criminal_law',
        taxonomyVersion: 'study_8',
      });

      const call = prisma.digest.findMany.mock.calls[0][0];
      expect(call.where.legalDocument).toEqual({
        subjectAssignments: {
          some: { subject: { code: 'criminal_law', taxonomyVersion: 'study_8' } },
        },
      });
    });

    it('maps digest rows to the DerivativeListItem shape (derivativeType=case_digest, never gated)', async () => {
      prisma.digest.findMany.mockResolvedValue([makeDigestRow()]);

      const { items } = await service.list('user-1', 'org-1', {
        derivativeType: 'case_digest',
      });

      const [first] = items;
      expect(first).toBeDefined();
      expect(first!.id).toBe('d1');
      expect(first!.title).toBe('People v. Doe — Search & Seizure');
      expect(first!.derivativeType).toBe('case_digest');
      expect(first!.isGated).toBe(false);
      expect(first!.upgradeTier).toBeNull();
      expect(first!.sourceDocument).toEqual({
        id: 'doc-1',
        title: 'People v. Doe',
        shortTitle: 'Doe',
        citationText: 'G.R. No. 12345',
        court: 'SC',
        decisionDate: new Date('2024-06-15'),
      });
      expect(first!.subjects).toEqual([
        {
          code: 'criminal_law',
          name: 'Criminal Law',
          taxonomyVersion: 'study_8',
          isPrimary: true,
        },
      ]);
      expect(first!.disclaimer).toEqual({ id: 'cd', contentClass: 'digest', version: 1 });
    });

    it('handles pagination with take=limit+1 and nextCursor', async () => {
      // limit=2, return 3 rows → hasNext=true
      prisma.digest.findMany.mockResolvedValue([
        makeDigestRow({ id: 'd1' }),
        makeDigestRow({ id: 'd2' }),
        makeDigestRow({ id: 'd3' }),
      ]);

      const result = await service.list('user-1', 'org-1', {
        derivativeType: 'case_digest',
        limit: 2,
      });

      expect(result.items).toHaveLength(2);
      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.nextCursor).toBe('d2');
    });
  });

  describe('findOne — case_digest fallback', () => {
    const makeDigestRow = () => ({
      id: 'd1',
      title: 'People v. Doe',
      confidenceScore: 0.85,
      createdAt: new Date('2026-05-01'),
      summary: 'Sum',
      facts: 'Facts text',
      petitionerArguments: null,
      respondentArguments: null,
      issues: 'Issues',
      ruling: 'Ruling',
      doctrine: 'Doctrine',
      dispositive: 'Dispositive',
      legalDocument: {
        id: 'doc-1',
        title: 'People v. Doe',
        shortTitle: null,
        citationText: 'G.R. No. 12345',
        court: 'SC',
        decisionDate: new Date('2024-06-15'),
        subjectAssignments: [],
      },
      contentDisclaimer: {
        id: 'cd',
        contentClass: 'digest',
        version: 1,
        bodyHtml: '<p>disc</p>',
        bodyPlain: 'disc',
      },
    });

    it('falls back to digests when no derivative_artifact matches', async () => {
      prisma.derivativeArtifact.findFirst.mockResolvedValue(null);
      prisma.digest.findFirst.mockResolvedValue(makeDigestRow());

      const result = await service.findOne('d1', 'user-1', 'org-1');

      expect(result.id).toBe('d1');
      expect(result.derivativeType).toBe('case_digest');
      const content = result.contentJson as Record<string, unknown>;
      expect(content['facts']).toBe('Facts text');
      expect(content['doctrine']).toBe('Doctrine');
      expect(content['dispositive']).toBe('Dispositive');
      expect(result.disclaimerBody).toEqual({ bodyHtml: '<p>disc</p>', bodyPlain: 'disc' });
      expect(result.isGated).toBe(false);
    });

    it('applies the case-digest visibility filter on the fallback lookup', async () => {
      prisma.derivativeArtifact.findFirst.mockResolvedValue(null);
      prisma.digest.findFirst.mockResolvedValue(null);

      await expect(service.findOne('d1', 'user-1', 'org-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      const call = prisma.digest.findFirst.mock.calls[0][0];
      expect(call.where.id).toBe('d1');
      expect(call.where.visibility).toBe('public_editorial');
      expect(call.where.reviewStatus).toEqual({ in: ['approved', 'ai_generated'] });
    });

    it('throws NotFound when neither table matches', async () => {
      prisma.derivativeArtifact.findFirst.mockResolvedValue(null);
      prisma.digest.findFirst.mockResolvedValue(null);

      await expect(service.findOne('d1', 'user-1', 'org-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('free-plan preview cap (previewOnly)', () => {
    const makeArtifactRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
      id: 'a1',
      title: 'Sample MCQ',
      derivativeType: 'mcq_question',
      confidenceScore: 0.9,
      createdAt: new Date('2026-04-20'),
      publishedAt: null,
      audience: 'both',
      language: 'en',
      sourceDocument: null,
      subjectAssignments: [],
      contentDisclaimer: { id: 'cd', contentClass: 'mcq', version: 1 },
      ...overrides,
    });

    describe('list', () => {
      it('returns ≤1 per derivativeType + meta.previewMode when previewOnly=true', async () => {
        prisma.$queryRaw.mockResolvedValue([
          { id: 'preview-mcq' },
          { id: 'preview-essay' },
        ]);
        prisma.derivativeArtifact.count.mockResolvedValue(123);
        prisma.derivativeArtifact.findMany.mockResolvedValue([
          makeArtifactRow({ id: 'preview-mcq', derivativeType: 'mcq_question' }),
          makeArtifactRow({ id: 'preview-essay', derivativeType: 'essay_model_answer' }),
        ]);
        subs.getPlanCode.mockResolvedValue('free');

        const result = await service.list('user-1', 'org-1', {}, true);

        expect(result.items).toHaveLength(2);
        expect(result.items.map((i) => i.id)).toEqual([
          'preview-mcq',
          'preview-essay',
        ]);
        expect(result.meta).toMatchObject({
          previewMode: true,
          lockedCount: 123,
          upgradeRequired: true,
          hasNext: false,
        });
      });

      it('preview items KEEP their original isGated flag (additive to GATED_DERIVATIVE_TYPES)', async () => {
        prisma.$queryRaw.mockResolvedValue([{ id: 'preview-mcq' }]);
        prisma.derivativeArtifact.count.mockResolvedValue(50);
        prisma.derivativeArtifact.findMany.mockResolvedValue([
          makeArtifactRow({ id: 'preview-mcq', derivativeType: 'mcq_question' }),
        ]);
        subs.getPlanCode.mockResolvedValue('free');

        const { items } = await service.list('user-1', 'org-1', {}, true);
        const [item] = items;
        expect(item!.isGated).toBe(true);
        expect(item!.upgradeTier).toBe('edu');
      });

      it('returns empty items when no preview ids exist', async () => {
        prisma.$queryRaw.mockResolvedValue([]);

        const result = await service.list('user-1', 'org-1', {}, true);

        expect(result.items).toEqual([]);
        expect(result.meta.previewMode).toBe(true);
        expect(result.meta.lockedCount).toBe(0);
      });

      it('behaves unchanged when previewOnly=false (default)', async () => {
        prisma.derivativeArtifact.findMany.mockResolvedValue([]);

        const result = await service.list('user-1', 'org-1', {});

        expect(result.meta).not.toHaveProperty('previewMode');
        // No DISTINCT ON raw query when not in preview mode
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
      });
    });

    describe('findOne', () => {
      it('throws PaywallException BEFORE tenant lookup when previewOnly=true and id is NOT preview', async () => {
        prisma.$queryRaw.mockResolvedValue([{ id: 'preview-mcq' }]);

        await expect(
          service.findOne('not-in-preview', 'user-1', 'org-1', true),
        ).rejects.toBeInstanceOf(PaywallException);

        // Tenant lookup must NOT run — preserves no-existence-leak invariant
        expect(prisma.derivativeArtifact.findFirst).not.toHaveBeenCalled();
      });

      it('returns the artifact when previewOnly=true and id IS in preview set', async () => {
        prisma.$queryRaw.mockResolvedValue([{ id: 'preview-mcq' }]);
        prisma.derivativeArtifact.findFirst.mockResolvedValue({
          id: 'preview-mcq',
          title: 'Preview MCQ',
          derivativeType: 'mcq_question',
          confidenceScore: 0.9,
          createdAt: new Date(),
          publishedAt: null,
          audience: 'both',
          language: 'en',
          contentJson: { stem: 'Q' },
          contentPlainText: 'plain',
          sourceDocument: null,
          subjectAssignments: [],
          contentDisclaimer: {
            id: 'cd',
            contentClass: 'mcq',
            version: 1,
            bodyHtml: '<p>disc</p>',
            bodyPlain: 'disc',
          },
          mcqQuestion: null,
          essayPrompt: null,
        });
        subs.getPlanCode.mockResolvedValue('free');

        const result = await service.findOne('preview-mcq', 'user-1', 'org-1', true);

        expect(result.id).toBe('preview-mcq');
        // Existing gating still applies on top
        expect(result.isGated).toBe(true);
      });

      it('behaves unchanged when previewOnly=false (default)', async () => {
        prisma.derivativeArtifact.findFirst.mockResolvedValue(null);
        prisma.digest.findFirst.mockResolvedValue(null);

        await expect(
          service.findOne('any-id', 'user-1', 'org-1'),
        ).rejects.toBeInstanceOf(NotFoundException);

        expect(prisma.$queryRaw).not.toHaveBeenCalled();
      });
    });

    describe('getFreePreviewIds', () => {
      it('returns ids from the DISTINCT ON query', async () => {
        prisma.$queryRaw.mockResolvedValue([
          { id: 'preview-mcq' },
          { id: 'preview-essay' },
        ]);

        const ids = await service.getFreePreviewIds();
        expect(Array.from(ids)).toEqual(['preview-mcq', 'preview-essay']);
      });
    });
  });

  describe('suggested_bar_answer bridge (foreign bar_exam_answers table)', () => {
    const fullTaxonomy = [
      { id: 's1', code: 'political_law', name: 'Political Law', taxonomyVersion: 'study_8' },
      { id: 's2', code: 'civil_law', name: 'Civil Law', taxonomyVersion: 'study_8' },
      { id: 's3', code: 'criminal_law', name: 'Criminal Law', taxonomyVersion: 'study_8' },
      { id: 's4', code: 'labor_law', name: 'Labor Law and Social Legislation', taxonomyVersion: 'study_8' },
      { id: 's5', code: 'mercantile_law', name: 'Mercantile (Commercial) Law', taxonomyVersion: 'study_8' },
      { id: 's6', code: 'taxation', name: 'Taxation', taxonomyVersion: 'study_8' },
      { id: 's7', code: 'remedial_law', name: 'Remedial Law', taxonomyVersion: 'study_8' },
      { id: 's8', code: 'legal_ethics', name: 'Legal and Judicial Ethics', taxonomyVersion: 'study_8' },
    ];

    const makeAnswerRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
      id: 'ba1',
      answerText: 'The search was unreasonable because no warrant issued...',
      structuredAnswerJson: null,
      confidence: 0.91,
      createdAt: new Date('2026-05-11'),
      question: {
        questionNumber: 4,
        questionText: 'Discuss the validity of the warrantless search.',
        barExamSitting: {
          year: 2019,
          subjectStudyCode: 'criminal_law',
          taxonomyVersion: 'study_8',
        },
      },
      ...overrides,
    });

    describe('subjectsSummaryByType', () => {
      it('returns non-zero approvedCount for the 8 subjects from bar_exam_answers', async () => {
        prisma.subject.findMany.mockResolvedValue(fullTaxonomy);
        // 8 subjects → 8 parallel barExamAnswer.count calls
        prisma.barExamAnswer.count
          .mockResolvedValueOnce(9) // political_law
          .mockResolvedValueOnce(6) // civil_law
          .mockResolvedValueOnce(8) // criminal_law
          .mockResolvedValueOnce(5) // labor_law
          .mockResolvedValueOnce(7) // mercantile_law
          .mockResolvedValueOnce(4) // taxation
          .mockResolvedValueOnce(10) // remedial_law
          .mockResolvedValueOnce(4); // legal_ethics — sums to 53

        const result = await service.subjectsSummaryByType(
          'suggested_bar_answer',
          'user-1',
          'org-1',
          'study_8',
        );

        expect(result).toHaveLength(8);
        expect(result.reduce((sum, r) => sum + r.approvedCount, 0)).toBe(53);

        const criminal = result.find((r) => r.subjectCode === 'criminal_law');
        expect(criminal).toEqual({
          subjectCode: 'criminal_law',
          subjectName: 'Criminal Law',
          taxonomyVersion: 'study_8',
          totalCount: 8,
          approvedCount: 8,
        });

        // total === approved for the bridge (single visibility-filter count).
        for (const row of result) {
          expect(row.totalCount).toBe(row.approvedCount);
          expect(row.approvedCount).toBeGreaterThan(0);
        }

        // Sanity: artifact groupBy path NOT used for suggested_bar_answer
        expect(prisma.documentSubjectAssignment.groupBy).not.toHaveBeenCalled();
      });

      it('counts only approved + public_editorial, joined via question→sitting→subjectStudyCode', async () => {
        prisma.subject.findMany.mockResolvedValue(fullTaxonomy);
        prisma.barExamAnswer.count.mockResolvedValue(0);

        await service.subjectsSummaryByType(
          'suggested_bar_answer',
          'user-1',
          'org-1',
          'study_8',
        );

        for (const call of prisma.barExamAnswer.count.mock.calls) {
          const where = call[0].where;
          expect(where.reviewStatus).toBe('approved');
          expect(where.visibility).toBe('public_editorial');
        }

        const firstCall = prisma.barExamAnswer.count.mock.calls[0][0];
        expect(firstCall.where.question).toEqual({
          barExamSitting: {
            subjectStudyCode: 'political_law',
            taxonomyVersion: 'study_8',
          },
        });
      });
    });

    describe('list', () => {
      it('queries bar_exam_answers (not derivative_artifacts) when derivativeType=suggested_bar_answer', async () => {
        prisma.barExamAnswer.findMany.mockResolvedValue([makeAnswerRow()]);
        prisma.subject.findMany.mockResolvedValue(fullTaxonomy);

        const { items } = await service.list('user-1', 'org-1', {
          derivativeType: 'suggested_bar_answer',
        });

        expect(prisma.barExamAnswer.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.derivativeArtifact.findMany).not.toHaveBeenCalled();
        expect(items).toHaveLength(1);
      });

      it('applies the approved + public_editorial visibility filter', async () => {
        prisma.barExamAnswer.findMany.mockResolvedValue([]);
        prisma.subject.findMany.mockResolvedValue(fullTaxonomy);

        await service.list('user-1', 'org-1', {
          derivativeType: 'suggested_bar_answer',
        });

        const call = prisma.barExamAnswer.findMany.mock.calls[0][0];
        expect(call.where.reviewStatus).toBe('approved');
        expect(call.where.visibility).toBe('public_editorial');
      });

      it('filters by subjectCode via question.barExamSitting.subjectStudyCode + taxonomyVersion', async () => {
        prisma.barExamAnswer.findMany.mockResolvedValue([]);
        prisma.subject.findMany.mockResolvedValue(fullTaxonomy);

        await service.list('user-1', 'org-1', {
          derivativeType: 'suggested_bar_answer',
          subjectCode: 'criminal_law',
          taxonomyVersion: 'study_8',
        });

        const call = prisma.barExamAnswer.findMany.mock.calls[0][0];
        expect(call.where.question).toEqual({
          barExamSitting: {
            subjectStudyCode: 'criminal_law',
            taxonomyVersion: 'study_8',
          },
        });
      });

      it('maps answer rows to DerivativeListItem (synthesized title, ungated for edu tier)', async () => {
        prisma.barExamAnswer.findMany.mockResolvedValue([makeAnswerRow()]);
        prisma.subject.findMany.mockResolvedValue(fullTaxonomy);
        subs.getPlanCode.mockResolvedValue('edu');

        const { items } = await service.list('user-1', 'org-1', {
          derivativeType: 'suggested_bar_answer',
        });

        const [first] = items;
        expect(first).toBeDefined();
        expect(first!.id).toBe('ba1');
        expect(first!.derivativeType).toBe('suggested_bar_answer');
        expect(first!.title).toBe('Criminal Law — Bar 2019 Q4');
        expect(first!.isGated).toBe(false);
        expect(first!.upgradeTier).toBeNull();
        expect(first!.sourceDocument).toBeNull();
        expect(first!.subjects).toEqual([
          {
            code: 'criminal_law',
            name: 'Criminal Law',
            taxonomyVersion: 'study_8',
            isPrimary: true,
          },
        ]);
      });

      it('gates list items for free-tier users with upgradeTier=edu', async () => {
        prisma.barExamAnswer.findMany.mockResolvedValue([makeAnswerRow()]);
        prisma.subject.findMany.mockResolvedValue(fullTaxonomy);
        subs.getPlanCode.mockResolvedValue('free');

        const { items } = await service.list('user-1', 'org-1', {
          derivativeType: 'suggested_bar_answer',
        });

        const [first] = items;
        expect(first).toBeDefined();
        expect(first!.isGated).toBe(true);
        expect(first!.upgradeTier).toBe('edu');
        // Plan looked up once per call, not once per row.
        expect(subs.getPlanCode).toHaveBeenCalledTimes(1);
      });

      it('handles pagination with take=limit+1 and nextCursor', async () => {
        prisma.barExamAnswer.findMany.mockResolvedValue([
          makeAnswerRow({ id: 'ba1' }),
          makeAnswerRow({ id: 'ba2' }),
          makeAnswerRow({ id: 'ba3' }),
        ]);
        prisma.subject.findMany.mockResolvedValue(fullTaxonomy);

        const result = await service.list('user-1', 'org-1', {
          derivativeType: 'suggested_bar_answer',
          limit: 2,
        });

        expect(result.items).toHaveLength(2);
        expect(result.meta.hasNext).toBe(true);
        expect(result.meta.nextCursor).toBe('ba2');
      });
    });

    describe('findOne — suggested_bar_answer fallback', () => {
      it('returns full renderer-shaped contentJson to edu-tier users (ungated)', async () => {
        prisma.derivativeArtifact.findFirst.mockResolvedValue(null);
        prisma.digest.findFirst.mockResolvedValue(null);
        prisma.barExamAnswer.findFirst.mockResolvedValue(
          makeAnswerRow({
            structuredAnswerJson: {
              annotations: [{ quote: 'Sec. 2, Art. III', commentary: 'Bill of Rights' }],
              sourceAttribution: 'LawPhil 2019 Bar',
            },
          }),
        );
        prisma.subject.findMany.mockResolvedValue(fullTaxonomy);
        subs.getPlanCode.mockResolvedValue('edu');

        const result = await service.findOne('ba1', 'user-1', 'org-1');

        expect(result.id).toBe('ba1');
        expect(result.derivativeType).toBe('suggested_bar_answer');
        expect(result.isGated).toBe(false);

        const content = result.contentJson as Record<string, unknown>;
        expect(content['barYear']).toBe(2019);
        expect(content['examSubject']).toBe('Criminal Law');
        expect(content['questionText']).toBe(
          'Discuss the validity of the warrantless search.',
        );
        expect(content['suggestedAnswer']).toBe(
          'The search was unreasonable because no warrant issued...',
        );
        expect(content['annotations']).toEqual([
          { quote: 'Sec. 2, Art. III', commentary: 'Bill of Rights' },
        ]);
        expect(content['sourceAttribution']).toBe('LawPhil 2019 Bar');
      });

      it('gates the detail for free-tier users and redacts suggestedAnswer + annotations (keeps questionText)', async () => {
        prisma.derivativeArtifact.findFirst.mockResolvedValue(null);
        prisma.digest.findFirst.mockResolvedValue(null);
        prisma.barExamAnswer.findFirst.mockResolvedValue(
          makeAnswerRow({
            structuredAnswerJson: {
              annotations: [{ quote: 'Sec. 2, Art. III', commentary: 'Bill of Rights' }],
              sourceAttribution: 'LawPhil 2019 Bar',
            },
          }),
        );
        prisma.subject.findMany.mockResolvedValue(fullTaxonomy);
        subs.getPlanCode.mockResolvedValue('free');

        const result = await service.findOne('ba1', 'user-1', 'org-1');

        expect(result.isGated).toBe(true);
        expect(result.upgradeTier).toBe('edu');

        const content = result.contentJson as Record<string, unknown>;
        // Answer-side content is stripped server-side — never reaches the client.
        expect(content).not.toHaveProperty('suggestedAnswer');
        expect(content).not.toHaveProperty('annotations');
        // Preview metadata stays visible.
        expect(content['questionText']).toBe(
          'Discuss the validity of the warrantless search.',
        );
        expect(content['barYear']).toBe(2019);
        expect(content['examSubject']).toBe('Criminal Law');
      });

      it('omits annotations/sourceAttribution when structured_answer_json is absent', async () => {
        prisma.derivativeArtifact.findFirst.mockResolvedValue(null);
        prisma.digest.findFirst.mockResolvedValue(null);
        prisma.barExamAnswer.findFirst.mockResolvedValue(makeAnswerRow());
        prisma.subject.findMany.mockResolvedValue(fullTaxonomy);
        subs.getPlanCode.mockResolvedValue('edu');

        const result = await service.findOne('ba1', 'user-1', 'org-1');

        const content = result.contentJson as Record<string, unknown>;
        expect(content).not.toHaveProperty('annotations');
        expect(content).not.toHaveProperty('sourceAttribution');
        expect(content['questionText']).toBe(
          'Discuss the validity of the warrantless search.',
        );
      });

      it('applies the approved + public_editorial filter on the fallback lookup', async () => {
        prisma.derivativeArtifact.findFirst.mockResolvedValue(null);
        prisma.digest.findFirst.mockResolvedValue(null);
        prisma.barExamAnswer.findFirst.mockResolvedValue(null);

        await expect(service.findOne('ba1', 'user-1', 'org-1')).rejects.toBeInstanceOf(
          NotFoundException,
        );

        const call = prisma.barExamAnswer.findFirst.mock.calls[0][0];
        expect(call.where.id).toBe('ba1');
        expect(call.where.reviewStatus).toBe('approved');
        expect(call.where.visibility).toBe('public_editorial');
      });

      it('throws NotFound when no artifact, digest, or bar answer matches', async () => {
        prisma.derivativeArtifact.findFirst.mockResolvedValue(null);
        prisma.digest.findFirst.mockResolvedValue(null);
        prisma.barExamAnswer.findFirst.mockResolvedValue(null);

        await expect(service.findOne('ba1', 'user-1', 'org-1')).rejects.toBeInstanceOf(
          NotFoundException,
        );
      });
    });
  });

  describe('essay_model_answer bridge (projection of essay_prompt artifacts)', () => {
    const fullTaxonomy = [
      { id: 's1', code: 'political_law', name: 'Political Law', taxonomyVersion: 'study_8' },
      { id: 's2', code: 'civil_law', name: 'Civil Law', taxonomyVersion: 'study_8' },
      { id: 's3', code: 'criminal_law', name: 'Criminal Law', taxonomyVersion: 'study_8' },
      { id: 's4', code: 'labor_law', name: 'Labor Law and Social Legislation', taxonomyVersion: 'study_8' },
      { id: 's5', code: 'mercantile_law', name: 'Mercantile (Commercial) Law', taxonomyVersion: 'study_8' },
      { id: 's6', code: 'taxation', name: 'Taxation', taxonomyVersion: 'study_8' },
      { id: 's7', code: 'remedial_law', name: 'Remedial Law', taxonomyVersion: 'study_8' },
      { id: 's8', code: 'legal_ethics', name: 'Legal and Judicial Ethics', taxonomyVersion: 'study_8' },
    ];

    const makeEssayRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
      id: 'essay-1',
      title: 'Warrantless search — practice essay',
      derivativeType: 'essay_prompt',
      confidenceScore: 0.88,
      createdAt: new Date('2026-05-12'),
      publishedAt: null,
      audience: 'both',
      language: 'en',
      contentJson: {
        promptText: 'Discuss the validity of the warrantless search.',
        modelAnswer: {
          outlineSections: [
            {
              heading: 'Answer',
              paragraphs: ['The search was invalid.'],
              citedSectionIds: ['sec-1'],
            },
            {
              heading: 'Law',
              paragraphs: ['Art. III, Sec. 2 of the Constitution.'],
              citedSectionIds: ['sec-2'],
            },
          ],
        },
      },
      contentPlainText: 'full essay text',
      sourceDocument: null,
      subjectAssignments: [
        {
          isPrimary: true,
          subject: {
            code: 'criminal_law',
            name: 'Criminal Law',
            taxonomyVersion: 'study_8',
          },
        },
      ],
      contentDisclaimer: {
        id: 'cd',
        contentClass: 'essay',
        version: 1,
        bodyHtml: '<p>disc</p>',
        bodyPlain: 'disc',
      },
      mcqQuestion: null,
      essayPrompt: null,
      ...overrides,
    });

    describe('subjectsSummaryByType', () => {
      it('returns per-subject approved counts (total === approved) from essay_prompt artifacts', async () => {
        prisma.subject.findMany.mockResolvedValue(fullTaxonomy);
        prisma.documentSubjectAssignment.groupBy.mockResolvedValue([
          { subjectId: 's3', _count: { _all: 7 } },
          { subjectId: 's1', _count: { _all: 4 } },
        ]);

        const result = await service.subjectsSummaryByType(
          'essay_model_answer',
          'user-1',
          'org-1',
          'study_8',
        );

        expect(result).toHaveLength(8);

        const criminal = result.find((r) => r.subjectCode === 'criminal_law');
        expect(criminal).toEqual({
          subjectCode: 'criminal_law',
          subjectName: 'Criminal Law',
          taxonomyVersion: 'study_8',
          totalCount: 7,
          approvedCount: 7,
        });

        const civil = result.find((r) => r.subjectCode === 'civil_law');
        expect(civil?.totalCount).toBe(0);
        expect(civil?.approvedCount).toBe(0);

        // total === approved for the projection (single approved-visibility count).
        for (const row of result) {
          expect(row.totalCount).toBe(row.approvedCount);
        }
      });

      it('counts under derivativeType=essay_prompt + public_editorial + approved (single groupBy)', async () => {
        prisma.subject.findMany.mockResolvedValue(fullTaxonomy);
        prisma.documentSubjectAssignment.groupBy.mockResolvedValue([]);

        await service.subjectsSummaryByType(
          'essay_model_answer',
          'user-1',
          'org-1',
          'study_8',
        );

        expect(prisma.documentSubjectAssignment.groupBy).toHaveBeenCalledTimes(1);
        const call = prisma.documentSubjectAssignment.groupBy.mock.calls[0][0];
        expect(call.where.derivativeArtifact.deletedAt).toBeNull();
        expect(call.where.derivativeArtifact.derivativeType).toBe('essay_prompt');
        expect(call.where.derivativeArtifact.visibility).toBe('public_editorial');
        expect(call.where.derivativeArtifact.reviewStatus).toBe('approved');
      });
    });

    describe('list', () => {
      it('queries essay_prompt artifacts and maps them to essay_model_answer items', async () => {
        prisma.derivativeArtifact.findMany.mockResolvedValue([makeEssayRow()]);
        subs.getPlanCode.mockResolvedValue('edu');

        const { items } = await service.list('user-1', 'org-1', {
          derivativeType: 'essay_model_answer',
        });

        const call = prisma.derivativeArtifact.findMany.mock.calls[0][0];
        expect(call.where.derivativeType).toBe('essay_prompt');
        expect(call.where.AND[0].OR).toEqual(
          expect.arrayContaining([
            { createdByUserId: 'user-1' },
            { organizationId: 'org-1', visibility: { not: 'private' } },
            { visibility: 'public_editorial', reviewStatus: 'approved' },
          ]),
        );

        const [first] = items;
        expect(first).toBeDefined();
        expect(first!.id).toBe('essay-1');
        expect(first!.derivativeType).toBe('essay_model_answer');
        expect(first!.title).toBe('Model Answer — Warrantless search — practice essay');
        // List items never carry contentJson.
        expect(first as unknown as Record<string, unknown>).not.toHaveProperty(
          'contentJson',
        );
      });

      it('gates list items for free-tier users with upgradeTier=edu', async () => {
        prisma.derivativeArtifact.findMany.mockResolvedValue([makeEssayRow()]);
        subs.getPlanCode.mockResolvedValue('free');

        const { items } = await service.list('user-1', 'org-1', {
          derivativeType: 'essay_model_answer',
        });

        const [first] = items;
        expect(first!.isGated).toBe(true);
        expect(first!.upgradeTier).toBe('edu');
        // Plan looked up once per call, not once per row.
        expect(subs.getPlanCode).toHaveBeenCalledTimes(1);
      });

      it('does NOT gate list items for edu-tier users', async () => {
        prisma.derivativeArtifact.findMany.mockResolvedValue([makeEssayRow()]);
        subs.getPlanCode.mockResolvedValue('edu');

        const { items } = await service.list('user-1', 'org-1', {
          derivativeType: 'essay_model_answer',
        });

        const [first] = items;
        expect(first!.isGated).toBe(false);
        expect(first!.upgradeTier).toBeNull();
      });

      it('filters by subjectCode via subjectAssignments.some', async () => {
        prisma.derivativeArtifact.findMany.mockResolvedValue([]);

        await service.list('user-1', 'org-1', {
          derivativeType: 'essay_model_answer',
          subjectCode: 'criminal_law',
          taxonomyVersion: 'study_8',
        });

        const call = prisma.derivativeArtifact.findMany.mock.calls[0][0];
        expect(call.where.subjectAssignments).toEqual({
          some: { subject: { code: 'criminal_law', taxonomyVersion: 'study_8' } },
        });
      });
    });

    describe('findOne — as=essay_model_answer projection', () => {
      it('projects modelAnswer.outlineSections + promptRef for edu-tier users (ungated)', async () => {
        prisma.derivativeArtifact.findFirst.mockResolvedValue(makeEssayRow());
        subs.getPlanCode.mockResolvedValue('edu');

        const result = await service.findOne(
          'essay-1',
          'user-1',
          'org-1',
          false,
          'essay_model_answer',
        );

        expect(result.id).toBe('essay-1');
        expect(result.derivativeType).toBe('essay_model_answer');
        expect(result.isGated).toBe(false);
        expect(result.upgradeTier).toBeNull();
        expect(result.title).toBe('Model Answer — Warrantless search — practice essay');

        const content = result.contentJson as Record<string, unknown>;
        expect(content['promptRef']).toBe('Discuss the validity of the warrantless search.');
        expect(content['format']).toBe('alac');
        const answer = content['answer'] as { outlineSections: unknown[] };
        expect(answer.outlineSections).toHaveLength(2);
        expect(answer.outlineSections[0]).toEqual({
          heading: 'Answer',
          paragraphs: ['The search was invalid.'],
          citedSectionIds: ['sec-1'],
        });
        // contentPlainText / essayPrompt are never leaked through the projection.
        expect(result.contentPlainText).toBeNull();
        expect(result.essayPrompt).toBeNull();
        expect(result.disclaimerBody).toEqual({ bodyHtml: '<p>disc</p>', bodyPlain: 'disc' });
      });

      it('redacts answer/modelAnswer but keeps promptRef for free-tier users', async () => {
        prisma.derivativeArtifact.findFirst.mockResolvedValue(makeEssayRow());
        subs.getPlanCode.mockResolvedValue('free');

        const result = await service.findOne(
          'essay-1',
          'user-1',
          'org-1',
          false,
          'essay_model_answer',
        );

        expect(result.isGated).toBe(true);
        expect(result.upgradeTier).toBe('edu');

        const content = result.contentJson as Record<string, unknown>;
        // Answer-side content stripped server-side — never reaches the client.
        expect(content).not.toHaveProperty('answer');
        expect(content).not.toHaveProperty('modelAnswer');
        // Prompt reference stays visible for the preview.
        expect(content['promptRef']).toBe('Discuss the validity of the warrantless search.');
        expect(content['format']).toBe('alac');
      });

      it('returns the normal essay_prompt detail when as is omitted (no projection)', async () => {
        prisma.derivativeArtifact.findFirst.mockResolvedValue(makeEssayRow());
        subs.getPlanCode.mockResolvedValue('edu');

        const result = await service.findOne('essay-1', 'user-1', 'org-1');

        // Without ?as=, the row is returned as its real type, not projected.
        expect(result.derivativeType).toBe('essay_prompt');
        expect(result.title).toBe('Warrantless search — practice essay');
      });
    });
  });
});
