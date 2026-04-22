import { NotFoundException } from '@nestjs/common';

import { DerivativesService } from './derivatives.service';

function makePrisma() {
  return {
    derivativeArtifact: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
    },
    subject: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    documentSubjectAssignment: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
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
  });
});
