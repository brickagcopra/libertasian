import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { DuplicatesService } from './duplicates.service';

describe('DuplicatesService', () => {
  let service: DuplicatesService;
  let prisma: jest.Mocked<PrismaService>;

  const mockPair = {
    id: 'sim-1',
    documentAId: 'doc-1',
    documentBId: 'doc-2',
    similarityScore: 1.0,
    similarityType: 'checksum',
    status: 'pending',
    createdAt: new Date(),
    documentA: { id: 'doc-1', title: 'Case A', citationText: 'G.R. No. 111', grNo: '111', documentType: 'case', court: 'SC', checksum: 'abc123' },
    documentB: { id: 'doc-2', title: 'Case A (duplicate)', citationText: 'G.R. No. 111', grNo: '111', documentType: 'case', court: 'SC', checksum: 'abc123' },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DuplicatesService,
        {
          provide: PrismaService,
          useValue: {
            documentSimilarity: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              count: jest.fn(),
              groupBy: jest.fn(),
            },
            legalDocument: {
              findMany: jest.fn(),
              update: jest.fn(),
              groupBy: jest.fn(),
            },
            bookmark: { updateMany: jest.fn() },
            annotation: { updateMany: jest.fn() },
            matterDocument: { updateMany: jest.fn() },
            editorialFlag: { updateMany: jest.fn() },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DuplicatesService>(DuplicatesService);
    prisma = module.get(PrismaService);
  });

  // ---- list ----

  describe('list', () => {
    it('should return paginated duplicate pairs', async () => {
      (prisma.documentSimilarity.findMany as jest.Mock).mockResolvedValue([mockPair]);

      const result = await service.list({});
      expect(result.items).toHaveLength(1);
      expect(result.meta.hasNext).toBe(false);
    });

    it('should filter by status', async () => {
      (prisma.documentSimilarity.findMany as jest.Mock).mockResolvedValue([]);

      await service.list({ status: 'pending' });
      expect(prisma.documentSimilarity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'pending' }),
        }),
      );
    });

    it('should filter by similarityType', async () => {
      (prisma.documentSimilarity.findMany as jest.Mock).mockResolvedValue([]);

      await service.list({ similarityType: 'checksum' });
      expect(prisma.documentSimilarity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ similarityType: 'checksum' }),
        }),
      );
    });

    it('should handle pagination with hasNext', async () => {
      const items = Array.from({ length: 21 }, (_, i) => ({ id: `sim-${i}` }));
      (prisma.documentSimilarity.findMany as jest.Mock).mockResolvedValue(items);

      const result = await service.list({ limit: 20 });
      expect(result.items).toHaveLength(20);
      expect(result.meta.hasNext).toBe(true);
    });
  });

  // ---- findById ----

  describe('findById', () => {
    it('should return pair with documents', async () => {
      (prisma.documentSimilarity.findUnique as jest.Mock).mockResolvedValue(mockPair);

      const result = await service.findById('sim-1');
      expect(result.id).toBe('sim-1');
      expect(result.documentA.id).toBe('doc-1');
    });

    it('should throw NotFoundException for missing pair', async () => {
      (prisma.documentSimilarity.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findById('sim-x')).rejects.toThrow(NotFoundException);
    });
  });

  // ---- getStats ----

  describe('getStats', () => {
    it('should return aggregate stats', async () => {
      (prisma.documentSimilarity.count as jest.Mock)
        .mockResolvedValueOnce(100)   // total
        .mockResolvedValueOnce(60)    // pending
        .mockResolvedValueOnce(30)    // merged
        .mockResolvedValueOnce(10);   // dismissed

      (prisma.documentSimilarity.groupBy as jest.Mock).mockResolvedValue([
        { similarityType: 'checksum', _count: 40 },
        { similarityType: 'title', _count: 35 },
        { similarityType: 'citation', _count: 25 },
      ]);

      const result = await service.getStats();
      expect(result.total).toBe(100);
      expect(result.pending).toBe(60);
      expect(result.merged).toBe(30);
      expect(result.dismissed).toBe(10);
      expect(result.byType).toHaveLength(3);
    });
  });

  // ---- detectChecksumDuplicates ----

  describe('detectChecksumDuplicates', () => {
    it('should create pairs for documents with same checksum', async () => {
      (prisma.legalDocument.groupBy as jest.Mock).mockResolvedValue([
        { checksum: 'abc123', _count: 2 },
      ]);
      (prisma.legalDocument.findMany as jest.Mock).mockResolvedValue([
        { id: 'doc-1' },
        { id: 'doc-2' },
      ]);
      (prisma.documentSimilarity.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.documentSimilarity.create as jest.Mock).mockResolvedValue({ id: 'sim-new' });

      const result = await service.detectChecksumDuplicates();
      expect(result.pairsCreated).toBe(1);
    });

    it('should not create duplicate pairs', async () => {
      (prisma.legalDocument.groupBy as jest.Mock).mockResolvedValue([
        { checksum: 'abc123', _count: 2 },
      ]);
      (prisma.legalDocument.findMany as jest.Mock).mockResolvedValue([
        { id: 'doc-1' },
        { id: 'doc-2' },
      ]);
      (prisma.documentSimilarity.findFirst as jest.Mock).mockResolvedValue({ id: 'existing' });

      const result = await service.detectChecksumDuplicates();
      expect(result.pairsCreated).toBe(0);
    });
  });

  // ---- detectTitleDuplicates ----

  describe('detectTitleDuplicates', () => {
    it('should detect similar titles', async () => {
      (prisma.legalDocument.findMany as jest.Mock).mockResolvedValue([
        { id: 'doc-1', title: 'People vs Santos' },
        { id: 'doc-2', title: 'People vs Santos' },
        { id: 'doc-3', title: 'Completely Different Case' },
      ]);
      (prisma.documentSimilarity.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.documentSimilarity.create as jest.Mock).mockResolvedValue({ id: 'sim-new' });

      const result = await service.detectTitleDuplicates(0.85);
      expect(result.pairsCreated).toBeGreaterThanOrEqual(1);
    });
  });

  // ---- detectCitationOverlap ----

  describe('detectCitationOverlap', () => {
    it('should detect documents with same GR number', async () => {
      (prisma.legalDocument.groupBy as jest.Mock)
        .mockResolvedValueOnce([{ grNo: '123456', _count: 2 }])   // GR groups
        .mockResolvedValueOnce([]);  // citation text groups

      (prisma.legalDocument.findMany as jest.Mock).mockResolvedValue([
        { id: 'doc-1' },
        { id: 'doc-2' },
      ]);
      (prisma.documentSimilarity.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.documentSimilarity.create as jest.Mock).mockResolvedValue({ id: 'sim-new' });

      const result = await service.detectCitationOverlap();
      expect(result.pairsCreated).toBeGreaterThanOrEqual(1);
    });
  });

  // ---- runFullDetection ----

  describe('runFullDetection', () => {
    it('should run all three detection methods', async () => {
      // Mock all three methods to return 0 pairs (simple case)
      (prisma.legalDocument.groupBy as jest.Mock).mockResolvedValue([]);
      (prisma.legalDocument.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.runFullDetection();
      expect(result).toHaveProperty('checksum');
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('citation');
      expect(result).toHaveProperty('totalPairsCreated');
      expect(result).toHaveProperty('duration');
    });
  });

  // ---- merge ----

  describe('merge', () => {
    it('should merge duplicate pair keeping specified document', async () => {
      (prisma.documentSimilarity.findUnique as jest.Mock).mockResolvedValue(mockPair);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        await cb({
          bookmark: { updateMany: jest.fn() },
          annotation: { updateMany: jest.fn() },
          matterDocument: { updateMany: jest.fn() },
          editorialFlag: { updateMany: jest.fn() },
          legalDocument: { update: jest.fn() },
          documentSimilarity: { update: jest.fn(), updateMany: jest.fn() },
        });
      });

      const result = await service.merge(
        'sim-1',
        { keepDocumentId: 'doc-1' },
        'admin-1',
      );

      expect(result.keptDocumentId).toBe('doc-1');
      expect(result.archivedDocumentId).toBe('doc-2');
    });

    it('should throw BadRequestException for non-pending pair', async () => {
      (prisma.documentSimilarity.findUnique as jest.Mock).mockResolvedValue({
        ...mockPair,
        status: 'merged',
      });

      await expect(
        service.merge('sim-1', { keepDocumentId: 'doc-1' }, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid keepDocumentId', async () => {
      (prisma.documentSimilarity.findUnique as jest.Mock).mockResolvedValue(mockPair);

      await expect(
        service.merge('sim-1', { keepDocumentId: 'doc-999' }, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---- dismiss ----

  describe('dismiss', () => {
    it('should dismiss a pending pair', async () => {
      (prisma.documentSimilarity.findUnique as jest.Mock).mockResolvedValue(mockPair);
      (prisma.documentSimilarity.update as jest.Mock).mockResolvedValue({
        ...mockPair,
        status: 'dismissed',
      });

      const result = await service.dismiss('sim-1');
      expect(result.status).toBe('dismissed');
    });

    it('should throw BadRequestException for non-pending pair', async () => {
      (prisma.documentSimilarity.findUnique as jest.Mock).mockResolvedValue({
        ...mockPair,
        status: 'merged',
      });

      await expect(service.dismiss('sim-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for missing pair', async () => {
      (prisma.documentSimilarity.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.dismiss('sim-x')).rejects.toThrow(NotFoundException);
    });
  });
});
