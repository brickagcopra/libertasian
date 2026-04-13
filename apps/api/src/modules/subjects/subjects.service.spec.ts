import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { SubjectsService } from './subjects.service';

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

const makeSubject = (code: string, taxonomyVersion: string, overrides: Record<string, unknown> = {}) => ({
  id: `id-${code}-${taxonomyVersion}`,
  code,
  name: `Name of ${code}`,
  taxonomyVersion,
  weightPercent: 10.0,
  effectiveFrom: null,
  effectiveTo: null,
  displayOrder: 1,
  description: null,
  createdAt: new Date(),
  ...overrides,
});

const STUDY_8_SUBJECTS = [
  makeSubject('political_law', 'study_8', { displayOrder: 1 }),
  makeSubject('labor_law', 'study_8', { displayOrder: 2 }),
  makeSubject('civil_law', 'study_8', { displayOrder: 3 }),
  makeSubject('taxation', 'study_8', { displayOrder: 4 }),
  makeSubject('mercantile_law', 'study_8', { displayOrder: 5 }),
  makeSubject('criminal_law', 'study_8', { displayOrder: 6 }),
  makeSubject('remedial_law', 'study_8', { displayOrder: 7 }),
  makeSubject('legal_ethics', 'study_8', { displayOrder: 8 }),
];

const BAR_ADMIN_6_SUBJECTS = [
  makeSubject('political_pil', 'bar_admin_6', { displayOrder: 1 }),
  makeSubject('commercial_taxation', 'bar_admin_6', { displayOrder: 2 }),
  makeSubject('civil_land_titles', 'bar_admin_6', { displayOrder: 3 }),
  makeSubject('labor_social', 'bar_admin_6', { displayOrder: 4 }),
  makeSubject('criminal', 'bar_admin_6', { displayOrder: 5 }),
  makeSubject('remedial_ethics_practical', 'bar_admin_6', { displayOrder: 6 }),
];

const ALL_SUBJECTS = [...STUDY_8_SUBJECTS, ...BAR_ADMIN_6_SUBJECTS];

const makeTopic = (code: string, subjectId: string, displayOrder: number) => ({
  id: `topic-${code}`,
  subjectId,
  parentId: null,
  code,
  name: `Topic ${code}`,
  description: null,
  displayOrder,
});

const SAMPLE_TOPICS = [
  makeTopic('political_law.constitutional_doctrines', 'id-political_law-study_8', 1),
  makeTopic('political_law.government_powers', 'id-political_law-study_8', 2),
  makeTopic('political_law.bill_of_rights', 'id-political_law-study_8', 3),
];

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('SubjectsService', () => {
  let service: SubjectsService;
  let prisma: {
    subject: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
    subjectTopic: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
    subjectEquivalence: {
      findMany: jest.Mock;
    };
    documentSubjectAssignment: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    legalDocument: {
      count: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      subject: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      subjectTopic: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      subjectEquivalence: {
        findMany: jest.fn(),
      },
      documentSubjectAssignment: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      legalDocument: {
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubjectsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(SubjectsService);
  });

  // -------------------------------------------------------------------------
  // findAllSubjects
  // -------------------------------------------------------------------------

  describe('findAllSubjects', () => {
    it('returns all subjects when no filter', async () => {
      prisma.subject.findMany.mockResolvedValue(ALL_SUBJECTS);

      const result = await service.findAllSubjects();

      expect(result).toHaveLength(14);
      expect(prisma.subject.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { displayOrder: 'asc' },
      });
    });

    it('returns only study_8 subjects when filtered', async () => {
      prisma.subject.findMany.mockResolvedValue(STUDY_8_SUBJECTS);

      const result = await service.findAllSubjects('study_8');

      expect(result).toHaveLength(8);
      expect(prisma.subject.findMany).toHaveBeenCalledWith({
        where: { taxonomyVersion: 'study_8' },
        orderBy: { displayOrder: 'asc' },
      });
    });

    it('returns only bar_admin_6 subjects when filtered', async () => {
      prisma.subject.findMany.mockResolvedValue(BAR_ADMIN_6_SUBJECTS);

      const result = await service.findAllSubjects('bar_admin_6');

      expect(result).toHaveLength(6);
      expect(prisma.subject.findMany).toHaveBeenCalledWith({
        where: { taxonomyVersion: 'bar_admin_6' },
        orderBy: { displayOrder: 'asc' },
      });
    });
  });

  // -------------------------------------------------------------------------
  // findSubjectByCode
  // -------------------------------------------------------------------------

  describe('findSubjectByCode', () => {
    it('returns subject for valid code + taxonomy', async () => {
      const subject = makeSubject('political_law', 'study_8');
      prisma.subject.findUnique.mockResolvedValue(subject);

      const result = await service.findSubjectByCode('political_law', 'study_8');

      expect(result).toEqual(subject);
      expect(prisma.subject.findUnique).toHaveBeenCalledWith({
        where: {
          code_taxonomyVersion: { code: 'political_law', taxonomyVersion: 'study_8' },
        },
      });
    });

    it('returns null for invalid code', async () => {
      prisma.subject.findUnique.mockResolvedValue(null);

      const result = await service.findSubjectByCode('nonexistent', 'study_8');

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // findTopicsBySubject
  // -------------------------------------------------------------------------

  describe('findTopicsBySubject', () => {
    it('returns topics for a subject', async () => {
      prisma.subjectTopic.findMany.mockResolvedValue(SAMPLE_TOPICS);

      const result = await service.findTopicsBySubject('id-political_law-study_8');

      expect(result).toHaveLength(3);
      expect(prisma.subjectTopic.findMany).toHaveBeenCalledWith({
        where: { subjectId: 'id-political_law-study_8' },
        orderBy: { displayOrder: 'asc' },
      });
    });
  });

  // -------------------------------------------------------------------------
  // resolveBarAdminSubjects
  // -------------------------------------------------------------------------

  describe('resolveBarAdminSubjects', () => {
    it('returns mercantile_law + taxation for commercial_taxation', async () => {
      const barAdminSubject = makeSubject('commercial_taxation', 'bar_admin_6');
      prisma.subject.findUnique.mockResolvedValue(barAdminSubject);
      prisma.subjectEquivalence.findMany.mockResolvedValue([
        { studySubjectId: 'id-mercantile_law-study_8' },
        { studySubjectId: 'id-taxation-study_8' },
      ]);

      const result = await service.resolveBarAdminSubjects('commercial_taxation');

      expect(result).toEqual(['id-mercantile_law-study_8', 'id-taxation-study_8']);
    });

    it('returns just political_law for political_pil', async () => {
      const barAdminSubject = makeSubject('political_pil', 'bar_admin_6');
      prisma.subject.findUnique.mockResolvedValue(barAdminSubject);
      prisma.subjectEquivalence.findMany.mockResolvedValue([
        { studySubjectId: 'id-political_law-study_8' },
      ]);

      const result = await service.resolveBarAdminSubjects('political_pil');

      expect(result).toEqual(['id-political_law-study_8']);
    });

    it('returns remedial_law + legal_ethics for remedial_ethics_practical', async () => {
      const barAdminSubject = makeSubject('remedial_ethics_practical', 'bar_admin_6');
      prisma.subject.findUnique.mockResolvedValue(barAdminSubject);
      prisma.subjectEquivalence.findMany.mockResolvedValue([
        { studySubjectId: 'id-remedial_law-study_8' },
        { studySubjectId: 'id-legal_ethics-study_8' },
      ]);

      const result = await service.resolveBarAdminSubjects('remedial_ethics_practical');

      expect(result).toEqual(['id-remedial_law-study_8', 'id-legal_ethics-study_8']);
    });

    it('returns empty array for unknown code', async () => {
      prisma.subject.findUnique.mockResolvedValue(null);

      const result = await service.resolveBarAdminSubjects('nonexistent');

      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // classifyDocument
  // -------------------------------------------------------------------------

  describe('classifyDocument', () => {
    const validSubject = makeSubject('political_law', 'study_8');
    const validTopic = makeTopic(
      'political_law.constitutional_doctrines',
      'id-political_law-study_8',
      1,
    );

    it('creates assignment on happy path', async () => {
      prisma.subject.findUnique.mockResolvedValue(validSubject);
      const createdAssignment = {
        id: 'assignment-1',
        legalDocumentId: 'doc-1',
        derivativeArtifactId: null,
        subjectId: validSubject.id,
        subjectTopicId: null,
        isPrimary: true,
        confidence: 0.95,
        classifiedBy: 'ai',
        classifierModelRunId: null,
        manualOverride: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.documentSubjectAssignment.create.mockResolvedValue(createdAssignment);

      const result = await service.classifyDocument({
        legalDocumentId: 'doc-1',
        subjectId: validSubject.id,
        isPrimary: true,
        confidence: 0.95,
      });

      expect(result).toEqual(createdAssignment);
      expect(prisma.documentSubjectAssignment.create).toHaveBeenCalledWith({
        data: {
          legalDocumentId: 'doc-1',
          derivativeArtifactId: undefined,
          subjectId: validSubject.id,
          subjectTopicId: undefined,
          isPrimary: true,
          confidence: 0.95,
          classifiedBy: 'ai',
          classifierModelRunId: undefined,
        },
      });
    });

    it('rejects when neither legalDocumentId nor derivativeArtifactId set', async () => {
      await expect(
        service.classifyDocument({
          subjectId: validSubject.id,
          isPrimary: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when subjectId does not exist', async () => {
      prisma.subject.findUnique.mockResolvedValue(null);

      await expect(
        service.classifyDocument({
          legalDocumentId: 'doc-1',
          subjectId: 'nonexistent-id',
          isPrimary: true,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when subjectTopicId does not belong to the subject', async () => {
      prisma.subject.findUnique.mockResolvedValue(validSubject);
      // Topic belongs to a different subject
      prisma.subjectTopic.findUnique.mockResolvedValue({
        ...validTopic,
        subjectId: 'id-civil_law-study_8',
      });

      await expect(
        service.classifyDocument({
          legalDocumentId: 'doc-1',
          subjectId: validSubject.id,
          subjectTopicId: validTopic.id,
          isPrimary: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // getClassificationCoverage
  // -------------------------------------------------------------------------

  describe('getClassificationCoverage', () => {
    it('returns correct coverage stats', async () => {
      // Total documents: 100
      prisma.legalDocument.count.mockResolvedValue(100);

      // 60 distinct classified document IDs
      prisma.documentSubjectAssignment.findMany.mockResolvedValue(
        Array.from({ length: 60 }, (_, i) => ({ legalDocumentId: `doc-${i}` })),
      );

      // Return 2 study_8 subjects for per-subject breakdown
      const twoSubjects = [
        makeSubject('civil_law', 'study_8', { displayOrder: 1 }),
        makeSubject('criminal_law', 'study_8', { displayOrder: 2 }),
      ];
      prisma.subject.findMany.mockResolvedValue(twoSubjects);

      // Per-subject counts based on query args
      prisma.documentSubjectAssignment.count.mockImplementation(
        async (args: { where: { subjectId: string; isPrimary?: boolean } }) => {
          const id = args.where.subjectId;
          const isPrimary = args.where.isPrimary;
          if (id === 'id-civil_law-study_8') return isPrimary === true ? 30 : 40;
          if (id === 'id-criminal_law-study_8') return isPrimary === true ? 20 : 25;
          return 0;
        },
      );

      const result = await service.getClassificationCoverage();

      expect(result.totalDocuments).toBe(100);
      expect(result.classifiedDocuments).toBe(60);
      expect(result.unclassifiedDocuments).toBe(40);
      expect(result.coveragePercent).toBe(60);
      expect(result.bySubject).toHaveLength(2);
      expect(result.bySubject[0]).toEqual({
        subjectId: 'id-civil_law-study_8',
        subjectCode: 'civil_law',
        subjectName: 'Name of civil_law',
        documentCount: 40,
        primaryCount: 30,
      });
      expect(result.bySubject[1]).toEqual({
        subjectId: 'id-criminal_law-study_8',
        subjectCode: 'criminal_law',
        subjectName: 'Name of criminal_law',
        documentCount: 25,
        primaryCount: 20,
      });
    });
  });
});
