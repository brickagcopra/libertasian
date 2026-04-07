import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { ClassificationService } from './classification.service';

describe('ClassificationService', () => {
  let service: ClassificationService;
  let prisma: jest.Mocked<PrismaService>;

  const mockTagMap = {
    id: 'tm-1',
    legalDocumentId: 'doc-1',
    tagId: 'tag-1',
    isPrimary: true,
    confidence: 0.75,
    classifiedBy: 'rule_based',
    reviewStatus: 'needs_review',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassificationService,
        {
          provide: PrismaService,
          useValue: {
            legalDocument: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
            },
            legalDocumentTagMap: {
              findUnique: jest.fn(),
              update: jest.fn(),
              create: jest.fn(),
              count: jest.fn(),
              deleteMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<ClassificationService>(ClassificationService);
    prisma = module.get(PrismaService);
  });

  // ---- getClassificationReviewQueue ----

  describe('getClassificationReviewQueue', () => {
    it('should return paginated results', async () => {
      const mockDocs = [
        {
          id: 'doc-1',
          title: 'Test Case',
          documentType: 'case_law',
          court: 'supreme_court',
          grNo: 'G.R. No. 12345',
          createdAt: new Date(),
          tagMaps: [
            {
              id: 'tm-1',
              isPrimary: true,
              confidence: 0.45,
              classifiedBy: 'rule_based',
              reviewStatus: 'needs_review',
              tag: { id: 'tag-1', code: 'criminal_law', name: 'Criminal Law', tagType: 'bar_subject' },
            },
          ],
        },
      ];

      (prisma.legalDocument.findMany as jest.Mock).mockResolvedValue(mockDocs);

      const result = await service.getClassificationReviewQueue({});
      expect(result.items).toHaveLength(1);
      expect(result.meta.hasNext).toBe(false);
      expect(result.items[0]!.tagMaps[0]!.reviewStatus).toBe('needs_review');
    });

    it('should detect hasNext when items exceed limit', async () => {
      const mockDocs = Array.from({ length: 21 }, (_, i) => ({
        id: `doc-${i}`,
        title: `Case ${i}`,
        documentType: 'case_law',
        court: null,
        grNo: null,
        createdAt: new Date(),
        tagMaps: [],
      }));

      (prisma.legalDocument.findMany as jest.Mock).mockResolvedValue(mockDocs);

      const result = await service.getClassificationReviewQueue({ limit: '20' });
      expect(result.items).toHaveLength(20);
      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.nextCursor).toBe('doc-19');
    });
  });

  // ---- confirmClassification ----

  describe('confirmClassification', () => {
    it('should update review status to confirmed', async () => {
      (prisma.legalDocumentTagMap.findUnique as jest.Mock).mockResolvedValue(mockTagMap);
      (prisma.legalDocumentTagMap.update as jest.Mock).mockResolvedValue({
        ...mockTagMap,
        reviewStatus: 'confirmed',
      });

      const result = await service.confirmClassification('doc-1', 'tag-1');
      expect(result.reviewStatus).toBe('confirmed');
      expect(prisma.legalDocumentTagMap.update).toHaveBeenCalledWith({
        where: { id: 'tm-1' },
        data: { reviewStatus: 'confirmed' },
      });
    });

    it('should throw NotFoundException when tag mapping not found', async () => {
      (prisma.legalDocumentTagMap.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.confirmClassification('doc-1', 'tag-999'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---- rejectClassification ----

  describe('rejectClassification', () => {
    it('should update review status to rejected and clear isPrimary', async () => {
      (prisma.legalDocumentTagMap.findUnique as jest.Mock).mockResolvedValue(mockTagMap);
      (prisma.legalDocumentTagMap.update as jest.Mock).mockResolvedValue({
        ...mockTagMap,
        reviewStatus: 'rejected',
        isPrimary: false,
      });

      const result = await service.rejectClassification('doc-1', 'tag-1');
      expect(result.reviewStatus).toBe('rejected');
      expect(result.isPrimary).toBe(false);
      expect(prisma.legalDocumentTagMap.update).toHaveBeenCalledWith({
        where: { id: 'tm-1' },
        data: { reviewStatus: 'rejected', isPrimary: false },
      });
    });

    it('should throw NotFoundException when tag mapping not found', async () => {
      (prisma.legalDocumentTagMap.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.rejectClassification('doc-1', 'tag-999'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---- overrideClassification ----

  describe('overrideClassification', () => {
    it('should delete existing mappings and create new ones', async () => {
      (prisma.legalDocument.findUnique as jest.Mock).mockResolvedValue({ id: 'doc-1' });
      (prisma.legalDocumentTagMap.deleteMany as jest.Mock).mockResolvedValue({ count: 2 });
      (prisma.legalDocumentTagMap.create as jest.Mock).mockResolvedValue({});

      const result = await service.overrideClassification(
        'doc-1',
        'tag-primary',
        ['tag-secondary-1', 'tag-secondary-2'],
      );

      expect(result.documentId).toBe('doc-1');
      expect(result.primaryTagId).toBe('tag-primary');
      expect(result.secondaryTagIds).toEqual(['tag-secondary-1', 'tag-secondary-2']);
      expect(prisma.legalDocumentTagMap.deleteMany).toHaveBeenCalled();
      // primary + 2 secondary = 3 creates
      expect(prisma.legalDocumentTagMap.create).toHaveBeenCalledTimes(3);
    });

    it('should skip duplicating primary tag in secondary list', async () => {
      (prisma.legalDocument.findUnique as jest.Mock).mockResolvedValue({ id: 'doc-1' });
      (prisma.legalDocumentTagMap.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.legalDocumentTagMap.create as jest.Mock).mockResolvedValue({});

      const result = await service.overrideClassification(
        'doc-1',
        'tag-primary',
        ['tag-primary', 'tag-secondary'],
      );

      // Primary appears in secondary list but should be filtered
      expect(result.secondaryTagIds).toEqual(['tag-secondary']);
      // primary + 1 secondary = 2 creates
      expect(prisma.legalDocumentTagMap.create).toHaveBeenCalledTimes(2);
    });

    it('should throw NotFoundException when document not found', async () => {
      (prisma.legalDocument.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.overrideClassification('doc-999', 'tag-1', []),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---- getReviewStats ----

  describe('getReviewStats', () => {
    it('should return counts for all review statuses', async () => {
      (prisma.legalDocumentTagMap.count as jest.Mock)
        .mockResolvedValueOnce(10) // needs_review
        .mockResolvedValueOnce(50) // auto
        .mockResolvedValueOnce(30) // confirmed
        .mockResolvedValueOnce(5); // rejected

      const result = await service.getReviewStats();
      expect(result).toEqual({
        needsReview: 10,
        auto: 50,
        confirmed: 30,
        rejected: 5,
      });
    });
  });
});
