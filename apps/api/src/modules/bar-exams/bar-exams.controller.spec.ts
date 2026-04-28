import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { BarExamsController } from './bar-exams.controller';
import { BarExamsService } from './bar-exams.service';

describe('BarExamsController (public)', () => {
  let controller: BarExamsController;
  let prisma: {
    barExamSitting: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      barExamSitting: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BarExamsController],
      providers: [
        BarExamsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    controller = module.get<BarExamsController>(BarExamsController);
  });

  describe('GET /bar-exams', () => {
    it('returns sittings grouped by year DESC, only those with a source document', async () => {
      prisma.barExamSitting.findMany.mockResolvedValue([
        {
          id: 's1',
          year: 2022,
          part: 'I',
          subjectStudyCode: 'civil_law',
          subjectBarAdminCode: 'civil_land_titles',
          chairperson: 'Caguioa',
          sourceUrl: 'https://lawphil.net/.../civil-I_Q.html',
          _count: { questions: 15 },
        },
        {
          id: 's2',
          year: 2018,
          part: null,
          subjectStudyCode: 'criminal_law',
          subjectBarAdminCode: 'criminal',
          chairperson: 'Del Castillo',
          sourceUrl: 'https://lawphil.net/.../criminalQ.html',
          _count: { questions: 19 },
        },
      ]);

      const result = await controller.list();

      // Public sittings query must filter on sourceDocumentId not null
      const callArgs = prisma.barExamSitting.findMany.mock.calls[0]![0];
      expect(callArgs.where).toEqual({ sourceDocumentId: { not: null } });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0]!.year).toBe(2022);
      expect(result.data[1]!.year).toBe(2018);
      expect(result.data[0]!.subjects[0]!.questionCount).toBe(15);
    });

    it('returns an empty array when no sittings exist', async () => {
      prisma.barExamSitting.findMany.mockResolvedValue([]);
      const result = await controller.list();
      expect(result.data).toEqual([]);
    });
  });

  describe('GET /bar-exams/:year', () => {
    it('returns subjects for the year', async () => {
      prisma.barExamSitting.findMany.mockResolvedValue([
        {
          id: 's1',
          year: 2018,
          part: null,
          subjectStudyCode: 'civil_law',
          subjectBarAdminCode: 'civil_land_titles',
          chairperson: null,
          sourceUrl: 'https://lawphil.net/.../civilQ.html',
          _count: { questions: 16 },
        },
      ]);

      const result = await controller.listByYear(2018);
      expect(result.success).toBe(true);
      expect(result.data.year).toBe(2018);
      expect(result.data.subjects).toHaveLength(1);
      expect(result.data.subjects[0]!.code).toBe('civil_law');
    });

    it('throws 404 when no sittings exist for the year', async () => {
      prisma.barExamSitting.findMany.mockResolvedValue([]);
      await expect(controller.listByYear(2020)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('GET /bar-exams/:year/:subjectCode', () => {
    it('returns the sitting with all questions ordered ASC', async () => {
      prisma.barExamSitting.findFirst.mockResolvedValue({
        id: 'sitting-id',
        year: 2018,
        part: null,
        subjectStudyCode: 'criminal_law',
        subjectBarAdminCode: 'criminal',
        chairperson: 'Del Castillo',
        sourceUrl: 'https://lawphil.net/.../criminalQ.html',
        sourceDocumentId: 'doc-id',
        questions: [
          {
            id: 'q1',
            questionNumber: 1,
            questionText: 'Question I body...',
            subPartsCount: 0,
            sourceSectionAnchor: null,
          },
          {
            id: 'q2',
            questionNumber: 2,
            questionText: 'Question II body...',
            subPartsCount: 2,
            sourceSectionAnchor: null,
          },
        ],
      });

      const result = await controller.getSitting(2018, 'criminal_law');

      expect(result.success).toBe(true);
      expect(result.data.sitting.year).toBe(2018);
      expect(result.data.sitting.subjectStudyCode).toBe('criminal_law');
      expect(result.data.questions).toHaveLength(2);
      expect(result.data.questions[0]!.number).toBe(1);
      expect(result.data.questions[1]!.subPartsCount).toBe(2);
    });

    it('disambiguates 2022 split papers by ?part query parameter', async () => {
      prisma.barExamSitting.findFirst.mockResolvedValue({
        id: 'sitting-id',
        year: 2022,
        part: 'I',
        subjectStudyCode: 'civil_law',
        subjectBarAdminCode: 'civil_land_titles',
        chairperson: 'Caguioa',
        sourceUrl: 'https://lawphil.net/.../civil-I_Q.html',
        sourceDocumentId: 'doc-id',
        questions: [],
      });

      await controller.getSitting(2022, 'civil_law', 'I');

      const callArgs = prisma.barExamSitting.findFirst.mock.calls[0]![0];
      expect(callArgs.where).toEqual({
        year: 2022,
        subjectStudyCode: 'civil_law',
        part: 'I',
      });
    });

    it('throws 404 for an unknown year/subject combination', async () => {
      prisma.barExamSitting.findFirst.mockResolvedValue(null);
      await expect(
        controller.getSitting(2018, 'unknown_subject'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 for a malformed part query parameter', async () => {
      await expect(
        controller.getSitting(2022, 'civil_law', '<><><>'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
