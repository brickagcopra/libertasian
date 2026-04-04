import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { DoctrinesService } from './doctrines.service';
import { ConfigService } from '@nestjs/config';

describe('DoctrinesService', () => {
  let service: DoctrinesService;
  let prisma: jest.Mocked<PrismaService>;
  let doctrinesQueue: { addBulk: jest.Mock };

  const mockDoctrine = {
    id: 'doc-ext-1',
    legalDocumentId: 'ld-1',
    digestId: null,
    sourceSectionId: null,
    text: 'The doctrine of last clear chance applies when...',
    normalizedText: null,
    doctrineType: 'ratio_decidendi',
    confidence: 0.85,
    reviewStatus: 'draft',
    createdAt: new Date(),
  };

  const mockDocument = {
    id: 'ld-1',
    title: 'People v. Santos',
    shortTitle: 'Santos',
    citationText: 'G.R. No. 123456',
    grNo: '123456',
    documentType: 'case',
  };

  beforeEach(async () => {
    doctrinesQueue = { addBulk: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DoctrinesService,
        {
          provide: PrismaService,
          useValue: {
            doctrineExtract: {
              create: jest.fn(),
              createMany: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              count: jest.fn(),
            },
            doctrineLink: {
              create: jest.fn(),
              findMany: jest.fn(),
              delete: jest.fn(),
              count: jest.fn(),
            },
            legalDocument: {
              count: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
            },
            digest: {
              count: jest.fn(),
            },
            modelRun: {
              create: jest.fn(),
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('http://localhost:8000'),
          },
        },
        {
          provide: getQueueToken('doctrines'),
          useValue: doctrinesQueue,
        },
      ],
    }).compile();

    service = module.get<DoctrinesService>(DoctrinesService);
    prisma = module.get(PrismaService);
  });

  // ---- create ----

  describe('create', () => {
    it('should create a doctrine extract', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.doctrineExtract.create as jest.Mock).mockResolvedValue(mockDoctrine);

      const result = await service.create({
        legalDocumentId: 'ld-1',
        text: 'The doctrine of last clear chance applies when...',
        doctrineType: 'ratio_decidendi',
        confidence: 0.85,
      });

      expect(result).toEqual(mockDoctrine);
    });

    it('should throw NotFoundException for missing legal document', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(0);

      await expect(
        service.create({ legalDocumentId: 'ld-x', text: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for missing digest', async () => {
      (prisma.digest.count as jest.Mock).mockResolvedValue(0);

      await expect(
        service.create({ digestId: 'dig-x', text: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create without optional references', async () => {
      (prisma.doctrineExtract.create as jest.Mock).mockResolvedValue(mockDoctrine);

      const result = await service.create({ text: 'Standalone doctrine' });
      expect(result).toEqual(mockDoctrine);
    });
  });

  // ---- findById ----

  describe('findById', () => {
    it('should return doctrine with all relations', async () => {
      (prisma.doctrineExtract.findUnique as jest.Mock).mockResolvedValue({
        ...mockDoctrine,
        legalDocument: mockDocument,
        digest: null,
        sourceSection: null,
        linksFrom: [],
        linksTo: [],
      });

      const result = await service.findById('doc-ext-1');
      expect(result.id).toBe('doc-ext-1');
    });

    it('should throw NotFoundException for missing doctrine', async () => {
      (prisma.doctrineExtract.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findById('doc-ext-x')).rejects.toThrow(NotFoundException);
    });
  });

  // ---- list ----

  describe('list', () => {
    it('should return paginated doctrines', async () => {
      const items = Array.from({ length: 3 }, (_, i) => ({
        id: `doc-ext-${i}`,
        text: `Doctrine ${i}`,
      }));
      (prisma.doctrineExtract.findMany as jest.Mock).mockResolvedValue(items);

      const result = await service.list({});
      expect(result.items).toHaveLength(3);
      expect(result.meta.hasNext).toBe(false);
    });

    it('should filter by reviewStatus', async () => {
      (prisma.doctrineExtract.findMany as jest.Mock).mockResolvedValue([]);

      await service.list({ reviewStatus: 'approved' });
      expect(prisma.doctrineExtract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ reviewStatus: 'approved' }),
        }),
      );
    });

    it('should support cursor pagination', async () => {
      const items = Array.from({ length: 21 }, (_, i) => ({ id: `doc-ext-${i}` }));
      (prisma.doctrineExtract.findMany as jest.Mock).mockResolvedValue(items);

      const result = await service.list({ limit: 20 });
      expect(result.items).toHaveLength(20);
      expect(result.meta.hasNext).toBe(true);
    });
  });

  // ---- listApproved ----

  describe('listApproved', () => {
    it('should only return approved doctrines', async () => {
      (prisma.doctrineExtract.findMany as jest.Mock).mockResolvedValue([]);

      await service.listApproved({});
      expect(prisma.doctrineExtract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ reviewStatus: 'approved' }),
        }),
      );
    });
  });

  // ---- update ----

  describe('update', () => {
    it('should update doctrine fields', async () => {
      (prisma.doctrineExtract.count as jest.Mock).mockResolvedValue(1);
      (prisma.doctrineExtract.update as jest.Mock).mockResolvedValue({
        ...mockDoctrine,
        reviewStatus: 'approved',
      });

      const result = await service.update('doc-ext-1', { reviewStatus: 'approved' });
      expect(result.reviewStatus).toBe('approved');
    });

    it('should throw NotFoundException for missing doctrine', async () => {
      (prisma.doctrineExtract.count as jest.Mock).mockResolvedValue(0);

      await expect(service.update('doc-ext-x', { reviewStatus: 'approved' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---- delete ----

  describe('delete', () => {
    it('should delete doctrine', async () => {
      (prisma.doctrineExtract.count as jest.Mock).mockResolvedValue(1);
      (prisma.doctrineExtract.delete as jest.Mock).mockResolvedValue(mockDoctrine);

      await expect(service.delete('doc-ext-1')).resolves.not.toThrow();
    });

    it('should throw NotFoundException for missing doctrine', async () => {
      (prisma.doctrineExtract.count as jest.Mock).mockResolvedValue(0);

      await expect(service.delete('doc-ext-x')).rejects.toThrow(NotFoundException);
    });
  });

  // ---- approve / reject ----

  describe('approve', () => {
    it('should set status to approved', async () => {
      (prisma.doctrineExtract.count as jest.Mock).mockResolvedValue(1);
      (prisma.doctrineExtract.update as jest.Mock).mockResolvedValue({
        ...mockDoctrine,
        reviewStatus: 'approved',
      });

      const result = await service.approve('doc-ext-1');
      expect(result.reviewStatus).toBe('approved');
    });
  });

  describe('reject', () => {
    it('should set status to rejected', async () => {
      (prisma.doctrineExtract.count as jest.Mock).mockResolvedValue(1);
      (prisma.doctrineExtract.update as jest.Mock).mockResolvedValue({
        ...mockDoctrine,
        reviewStatus: 'rejected',
      });

      const result = await service.reject('doc-ext-1');
      expect(result.reviewStatus).toBe('rejected');
    });
  });

  // ---- triggerExtraction ----

  describe('triggerExtraction', () => {
    it('should create placeholder and call RAG service', async () => {
      (prisma.legalDocument.findUnique as jest.Mock).mockResolvedValue(mockDocument);
      (prisma.doctrineExtract.create as jest.Mock).mockResolvedValue({
        ...mockDoctrine,
        id: 'placeholder-1',
      });

      const ragResponse = {
        document_id: 'ld-1',
        doctrines: [
          {
            text: 'Last clear chance doctrine',
            normalized_text: null,
            doctrine_type: 'ratio_decidendi',
            source_section_id: null,
            confidence: 0.9,
          },
        ],
        model_name: 'qwen-72b',
        prompt_template_version: 'v1',
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(ragResponse),
      });

      (prisma.modelRun.create as jest.Mock).mockResolvedValue({});
      (prisma.doctrineExtract.update as jest.Mock).mockResolvedValue(mockDoctrine);
      (prisma.doctrineExtract.findUnique as jest.Mock).mockResolvedValue(mockDoctrine);

      const result = await service.triggerExtraction({ legalDocumentId: 'ld-1' });
      expect(prisma.modelRun.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException for missing document', async () => {
      (prisma.legalDocument.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.triggerExtraction({ legalDocumentId: 'ld-x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle RAG service failure gracefully', async () => {
      (prisma.legalDocument.findUnique as jest.Mock).mockResolvedValue(mockDocument);
      (prisma.doctrineExtract.create as jest.Mock).mockResolvedValue({
        ...mockDoctrine,
        id: 'placeholder-1',
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Internal Server Error'),
      });

      (prisma.doctrineExtract.update as jest.Mock).mockResolvedValue(mockDoctrine);
      (prisma.doctrineExtract.findUnique as jest.Mock).mockResolvedValue(mockDoctrine);

      // Should not throw — marks as failed instead
      await expect(service.triggerExtraction({ legalDocumentId: 'ld-1' })).resolves.toBeDefined();
      expect(prisma.doctrineExtract.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reviewStatus: 'failed' }),
        }),
      );
    });
  });

  // ---- triggerBatchExtraction ----

  describe('triggerBatchExtraction', () => {
    it('should validate docs and enqueue batch jobs', async () => {
      (prisma.legalDocument.findMany as jest.Mock).mockResolvedValue([
        { id: 'ld-1', title: 'Case 1' },
        { id: 'ld-2', title: 'Case 2' },
      ]);

      const result = await service.triggerBatchExtraction(
        { legalDocumentIds: ['ld-1', 'ld-2'] },
        'user-1',
      );

      expect(result.totalDocuments).toBe(2);
      expect(result.status).toBe('queued');
      expect(doctrinesQueue.addBulk).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'extract-doctrines',
            data: expect.objectContaining({ legalDocumentId: 'ld-1' }),
          }),
        ]),
      );
    });

    it('should throw NotFoundException for missing documents', async () => {
      (prisma.legalDocument.findMany as jest.Mock).mockResolvedValue([
        { id: 'ld-1', title: 'Case 1' },
      ]);

      await expect(
        service.triggerBatchExtraction(
          { legalDocumentIds: ['ld-1', 'ld-missing'] },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---- findByDocument ----

  describe('findByDocument', () => {
    it('should return doctrines for a document', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.doctrineExtract.findMany as jest.Mock).mockResolvedValue([mockDoctrine]);

      const result = await service.findByDocument('ld-1');
      expect(result).toHaveLength(1);
    });

    it('should throw NotFoundException for missing document', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(0);

      await expect(service.findByDocument('ld-x')).rejects.toThrow(NotFoundException);
    });
  });

  // ---- Doctrine Links ----

  describe('createLink', () => {
    it('should create link between two doctrines', async () => {
      (prisma.doctrineExtract.count as jest.Mock)
        .mockResolvedValueOnce(1)  // from
        .mockResolvedValueOnce(1); // to

      (prisma.doctrineLink.create as jest.Mock).mockResolvedValue({
        id: 'link-1',
        fromDoctrineId: 'doc-ext-1',
        toDoctrineId: 'doc-ext-2',
        linkType: 'applied',
      });

      const result = await service.createLink({
        fromDoctrineId: 'doc-ext-1',
        toDoctrineId: 'doc-ext-2',
        linkType: 'applied',
      });

      expect(result.id).toBe('link-1');
    });

    it('should throw NotFoundException for missing source doctrine', async () => {
      (prisma.doctrineExtract.count as jest.Mock)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);

      await expect(
        service.createLink({
          fromDoctrineId: 'doc-ext-x',
          toDoctrineId: 'doc-ext-2',
          linkType: 'applied',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for self-link', async () => {
      (prisma.doctrineExtract.count as jest.Mock)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1);

      await expect(
        service.createLink({
          fromDoctrineId: 'doc-ext-1',
          toDoctrineId: 'doc-ext-1',
          linkType: 'applied',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listLinks', () => {
    it('should return outgoing and incoming links', async () => {
      (prisma.doctrineExtract.count as jest.Mock).mockResolvedValue(1);
      (prisma.doctrineLink.findMany as jest.Mock)
        .mockResolvedValueOnce([{ id: 'link-1' }])   // outgoing
        .mockResolvedValueOnce([{ id: 'link-2' }]);   // incoming

      const result = await service.listLinks('doc-ext-1');
      expect(result.outgoing).toHaveLength(1);
      expect(result.incoming).toHaveLength(1);
    });
  });

  describe('deleteLink', () => {
    it('should delete a doctrine link', async () => {
      (prisma.doctrineLink.count as jest.Mock).mockResolvedValue(1);
      (prisma.doctrineLink.delete as jest.Mock).mockResolvedValue({ id: 'link-1' });

      await expect(service.deleteLink('link-1')).resolves.not.toThrow();
    });

    it('should throw NotFoundException for missing link', async () => {
      (prisma.doctrineLink.count as jest.Mock).mockResolvedValue(0);

      await expect(service.deleteLink('link-x')).rejects.toThrow(NotFoundException);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});
