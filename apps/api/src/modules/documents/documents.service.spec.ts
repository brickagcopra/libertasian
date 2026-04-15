import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateLegalDocumentDto,
  UpdateLegalDocumentDto,
  ListDocumentsQueryDto,
} from './dto';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let prismaService: jest.Mocked<PrismaService>;

  const mockPrismaService = {
    legalDocument: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    legalDocumentSection: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    citation: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
    prismaService = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a legal document with normalized citation and grNo', async () => {
      const dto: CreateLegalDocumentDto = {
        documentType: 'case',
        title: '  People vs. Cruz  ',
        shortTitle: 'People vs. Cruz',
        citationText: '  123  Phil.   456  ',
        grNo: 'GR No. 123456',
        docketNo: 'A-123',
        promulgationDate: '2024-01-15',
        decisionDate: '2024-01-10',
        ponente: 'Justice Smith',
        court: 'Supreme Court',
        jurisdiction: 'PH',
        language: 'en',
        isOfficial: true,
        sourceId: 'source-123',
      };

      const expectedDocument = {
        id: 'doc-1',
        documentType: 'case',
        title: 'People vs. Cruz',
        shortTitle: 'People vs. Cruz',
        citationText: '123 Phil. 456',
        grNo: 'G.R. No. 123456',
        docketNo: 'A-123',
        status: 'draft',
        truthfulnessStatus: 'needs_review',
        createdAt: new Date(),
      };

      mockPrismaService.legalDocument.create.mockResolvedValue(expectedDocument);

      const result = await service.create(dto);

      expect(result).toEqual(expectedDocument);
      expect(mockPrismaService.legalDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          documentType: 'case',
          title: 'People vs. Cruz',
          citationText: '123 Phil. 456',
          grNo: 'G.R. No. 123456',
          status: 'draft',
          truthfulnessStatus: 'needs_review',
          isOfficial: true,
          source: { connect: { id: 'source-123' } },
        }),
      });
    });

    it('should create a document with minimal required fields', async () => {
      const dto: CreateLegalDocumentDto = {
        documentType: 'statute',
        title: 'Republic Act No. 10173',
      };

      const expectedDocument = {
        id: 'doc-2',
        documentType: 'statute',
        title: 'Republic Act No. 10173',
        status: 'draft',
        truthfulnessStatus: 'needs_review',
        jurisdiction: 'PH',
        language: 'en',
        isOfficial: false,
      };

      mockPrismaService.legalDocument.create.mockResolvedValue(expectedDocument);

      const result = await service.create(dto);

      expect(result).toEqual(expectedDocument);
      expect(mockPrismaService.legalDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          documentType: 'statute',
          title: 'Republic Act No. 10173',
          status: 'draft',
          truthfulnessStatus: 'needs_review',
          jurisdiction: 'PH',
          language: 'en',
          isOfficial: false,
        }),
      });
    });
  });

  describe('findById', () => {
    it('should return a document with source and counts', async () => {
      const expectedDoc = {
        id: 'doc-1',
        documentType: 'case',
        title: 'People vs. Smith',
        grNo: 'G.R. No. 123456',
        status: 'published',
        source: {
          id: 'source-1',
          name: 'Supreme Court',
          type: 'official',
          trustLevel: 'high',
        },
        _count: {
          sections: 5,
          citationsFrom: 3,
          bookmarks: 10,
          digests: 2,
        },
      };

      mockPrismaService.legalDocument.findUnique.mockResolvedValue(expectedDoc);

      const result = await service.findById('doc-1');

      expect(result).toEqual(expectedDoc);
      expect(mockPrismaService.legalDocument.findUnique).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        include: {
          source: { select: { id: true, name: true, type: true, trustLevel: true } },
          _count: { select: { sections: true, citationsFrom: true, bookmarks: true, digests: true } },
        },
      });
    });

    it('should throw NotFoundException when document does not exist', async () => {
      mockPrismaService.legalDocument.findUnique.mockResolvedValue(null);

      await expect(service.findById('non-existent')).rejects.toThrow(
        new NotFoundException('Legal document not found'),
      );

      expect(mockPrismaService.legalDocument.findUnique).toHaveBeenCalledWith({
        where: { id: 'non-existent' },
        include: expect.any(Object),
      });
    });
  });

  describe('update', () => {
    it('should update document fields with normalization', async () => {
      const dto: UpdateLegalDocumentDto = {
        title: '  Updated Title  ',
        citationText: '  456  Phil.  789  ',
        grNo: 'GR-987654',
        status: 'published',
        truthfulnessStatus: 'verified',
      };

      const updatedDoc = {
        id: 'doc-1',
        title: 'Updated Title',
        citationText: '456 Phil. 789',
        grNo: 'G.R. No. 987654',
        status: 'published',
        truthfulnessStatus: 'verified',
      };

      mockPrismaService.legalDocument.count.mockResolvedValue(1);
      mockPrismaService.legalDocument.update.mockResolvedValue(updatedDoc);

      const result = await service.update('doc-1', dto);

      expect(result).toEqual(updatedDoc);
      expect(mockPrismaService.legalDocument.count).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
      });
      expect(mockPrismaService.legalDocument.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: expect.objectContaining({
          title: 'Updated Title',
          citationText: '456 Phil. 789',
          grNo: 'G.R. No. 987654',
          status: 'published',
          truthfulnessStatus: 'verified',
        }),
      });
    });

    it('should throw NotFoundException when document does not exist', async () => {
      const dto: UpdateLegalDocumentDto = { title: 'New Title' };

      mockPrismaService.legalDocument.count.mockResolvedValue(0);

      await expect(service.update('non-existent', dto)).rejects.toThrow(
        new NotFoundException('Legal document not found'),
      );

      expect(mockPrismaService.legalDocument.update).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('should return paginated results with hasNext', async () => {
      const query: ListDocumentsQueryDto = {
        limit: 2,
        documentType: 'case',
        status: 'published',
      };

      const mockDocuments = [
        {
          id: 'doc-1',
          documentType: 'case',
          title: 'Case 1',
          status: 'published',
          createdAt: new Date('2024-01-15'),
          source: { id: 'source-1', name: 'Source 1' },
        },
        {
          id: 'doc-2',
          documentType: 'case',
          title: 'Case 2',
          status: 'published',
          createdAt: new Date('2024-01-14'),
          source: { id: 'source-1', name: 'Source 1' },
        },
        {
          id: 'doc-3',
          documentType: 'case',
          title: 'Case 3',
          status: 'published',
          createdAt: new Date('2024-01-13'),
          source: { id: 'source-1', name: 'Source 1' },
        },
      ];

      mockPrismaService.legalDocument.findMany.mockResolvedValue(mockDocuments);

      const result = await service.list(query);

      expect(result.items).toHaveLength(2);
      expect(result.items[0]!.id).toBe('doc-1');
      expect(result.items[1]!.id).toBe('doc-2');
      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.nextCursor).toBe('doc-2');
      expect(result.meta.limit).toBe(2);

      expect(mockPrismaService.legalDocument.findMany).toHaveBeenCalledWith({
        where: {
          documentType: 'case',
          status: 'published',
        },
        take: 3, // limit + 1
        orderBy: { createdAt: 'desc' },
        select: expect.any(Object),
      });
    });

    it('should return results without hasNext when at end', async () => {
      const query: ListDocumentsQueryDto = { limit: 5 };

      const mockDocuments = [
        {
          id: 'doc-1',
          documentType: 'case',
          title: 'Case 1',
          status: 'published',
          createdAt: new Date(),
          source: { id: 'source-1', name: 'Source 1' },
        },
        {
          id: 'doc-2',
          documentType: 'case',
          title: 'Case 2',
          status: 'published',
          createdAt: new Date(),
          source: { id: 'source-1', name: 'Source 1' },
        },
      ];

      mockPrismaService.legalDocument.findMany.mockResolvedValue(mockDocuments);

      const result = await service.list(query);

      expect(result.items).toHaveLength(2);
      expect(result.meta.hasNext).toBe(false);
      expect(result.meta.nextCursor).toBeUndefined();
    });

    it('should apply multiple filters correctly', async () => {
      const query: ListDocumentsQueryDto = {
        documentType: 'case',
        status: 'published',
        court: 'Supreme',
        ponente: 'Smith',
        grNo: '123456',
        search: 'People',
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
        publishedOnly: 'true',
      };

      mockPrismaService.legalDocument.findMany.mockResolvedValue([]);

      await service.list(query);

      expect(mockPrismaService.legalDocument.findMany).toHaveBeenCalledWith({
        where: {
          documentType: 'case',
          status: 'published',
          court: { contains: 'Supreme', mode: 'insensitive' },
          ponente: { contains: 'Smith', mode: 'insensitive' },
          grNo: { contains: '123456', mode: 'insensitive' },
          title: { contains: 'People', mode: 'insensitive' },
          isPublished: true,
          decisionDate: {
            gte: new Date('2024-01-01'),
            lte: new Date('2024-12-31'),
          },
        },
        take: 21, // default limit 20 + 1
        orderBy: { createdAt: 'desc' },
        select: expect.any(Object),
      });
    });

    it('should support cursor-based pagination', async () => {
      const query: ListDocumentsQueryDto = {
        cursor: 'doc-5',
        limit: 10,
      };

      mockPrismaService.legalDocument.findMany.mockResolvedValue([]);

      await service.list(query);

      expect(mockPrismaService.legalDocument.findMany).toHaveBeenCalledWith({
        where: {},
        take: 11,
        skip: 1,
        cursor: { id: 'doc-5' },
        orderBy: { createdAt: 'desc' },
        select: expect.any(Object),
      });
    });
  });

  describe('listSections', () => {
    it('should return sections ordered by ordering', async () => {
      const mockSections = [
        {
          id: 'section-1',
          sectionType: 'facts',
          sectionLabel: 'Facts',
          plainText: 'The petitioner filed a complaint.',
          ordering: 1,
          pageStart: 1,
          pageEnd: 3,
          tokenCount: 500,
          createdAt: new Date(),
        },
        {
          id: 'section-2',
          sectionType: 'issues',
          sectionLabel: 'Issues',
          plainText: 'Whether the dismissal was legal.',
          ordering: 2,
          pageStart: 3,
          pageEnd: 5,
          tokenCount: 300,
          createdAt: new Date(),
        },
      ];

      mockPrismaService.legalDocument.count.mockResolvedValue(1);
      mockPrismaService.legalDocumentSection.findMany.mockResolvedValue(mockSections);

      const result = await service.listSections('doc-1');

      expect(result).toEqual(mockSections);
      expect(mockPrismaService.legalDocumentSection.findMany).toHaveBeenCalledWith({
        where: { legalDocumentId: 'doc-1' },
        orderBy: { ordering: 'asc' },
        select: expect.any(Object),
      });
    });

    it('should include plainText in the select for reader rendering', async () => {
      mockPrismaService.legalDocument.count.mockResolvedValue(1);
      mockPrismaService.legalDocumentSection.findMany.mockResolvedValue([]);

      await service.listSections('doc-1');

      const call = mockPrismaService.legalDocumentSection.findMany.mock.calls[0]![0]!;
      expect(call.select).toHaveProperty('plainText', true);
    });

    it('should throw NotFoundException when document does not exist', async () => {
      mockPrismaService.legalDocument.count.mockResolvedValue(0);

      await expect(service.listSections('non-existent')).rejects.toThrow(
        new NotFoundException('Legal document not found'),
      );

      expect(mockPrismaService.legalDocumentSection.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getSection', () => {
    it('should return a specific section', async () => {
      const mockSection = {
        id: 'section-1',
        legalDocumentId: 'doc-1',
        sectionType: 'facts',
        sectionLabel: 'Facts',
        plainText: 'This is the facts section...',
        htmlText: '<p>This is the facts section...</p>',
        ordering: 1,
        pageStart: 1,
        pageEnd: 3,
        tokenCount: 500,
      };

      mockPrismaService.legalDocumentSection.findFirst.mockResolvedValue(mockSection);

      const result = await service.getSection('doc-1', 'section-1');

      expect(result).toEqual(mockSection);
      expect(mockPrismaService.legalDocumentSection.findFirst).toHaveBeenCalledWith({
        where: { id: 'section-1', legalDocumentId: 'doc-1' },
      });
    });

    it('should throw NotFoundException when section does not exist', async () => {
      mockPrismaService.legalDocumentSection.findFirst.mockResolvedValue(null);

      await expect(service.getSection('doc-1', 'non-existent')).rejects.toThrow(
        new NotFoundException('Section not found'),
      );
    });
  });

  describe('publishDocument', () => {
    it('should publish a document when no high-severity flags exist', async () => {
      const mockDoc = {
        id: 'doc-1',
        title: 'Test Document',
        status: 'draft',
        truthfulnessStatus: 'needs_review',
        isPublished: false,
        source: {
          id: 'source-1',
          trustLevel: 'high',
        },
        editorialFlags: [],
      };

      const updatedDoc = {
        ...mockDoc,
        status: 'published',
        truthfulnessStatus: 'verified',
        isPublished: true,
      };

      mockPrismaService.legalDocument.findUnique.mockResolvedValue(mockDoc);
      mockPrismaService.legalDocument.update.mockResolvedValue(updatedDoc);

      const result = await service.publishDocument('doc-1');

      expect(result.status).toBe('published');
      expect(result.truthfulnessStatus).toBe('verified');
      expect(result.isPublished).toBe(true);

      expect(mockPrismaService.legalDocument.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: {
          status: 'published',
          truthfulnessStatus: 'verified',
          isPublished: true,
        },
      });
    });

    it('should throw BadRequestException when high-severity flags exist', async () => {
      const mockDoc = {
        id: 'doc-1',
        title: 'Test Document',
        status: 'draft',
        source: {
          id: 'source-1',
          trustLevel: 'high',
        },
        editorialFlags: [
          { id: 'flag-1' },
          { id: 'flag-2' },
        ],
      };

      mockPrismaService.legalDocument.findUnique.mockResolvedValue(mockDoc);

      await expect(service.publishDocument('doc-1')).rejects.toThrow(
        new BadRequestException(
          'Cannot publish: 2 high-severity editorial flag(s) still open',
        ),
      );

      expect(mockPrismaService.legalDocument.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when document does not exist', async () => {
      mockPrismaService.legalDocument.findUnique.mockResolvedValue(null);

      await expect(service.publishDocument('non-existent')).rejects.toThrow(
        new NotFoundException('Legal document not found'),
      );
    });
  });

  describe('quarantineDocument', () => {
    it('should quarantine a document', async () => {
      const quarantinedDoc = {
        id: 'doc-1',
        title: 'Test Document',
        status: 'draft',
        truthfulnessStatus: 'quarantined',
        isPublished: false,
      };

      mockPrismaService.legalDocument.count.mockResolvedValue(1);
      mockPrismaService.legalDocument.update.mockResolvedValue(quarantinedDoc);

      const result = await service.quarantineDocument('doc-1');

      expect(result.truthfulnessStatus).toBe('quarantined');
      expect(result.isPublished).toBe(false);

      expect(mockPrismaService.legalDocument.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: {
          truthfulnessStatus: 'quarantined',
          isPublished: false,
        },
      });
    });

    it('should throw NotFoundException when document does not exist', async () => {
      mockPrismaService.legalDocument.count.mockResolvedValue(0);

      await expect(service.quarantineDocument('non-existent')).rejects.toThrow(
        new NotFoundException('Legal document not found'),
      );

      expect(mockPrismaService.legalDocument.update).not.toHaveBeenCalled();
    });
  });

  describe('normalizeGrNo', () => {
    it('should normalize "GR No. 123456" to "G.R. No. 123456"', () => {
      expect(service.normalizeGrNo('GR No. 123456')).toBe('G.R. No. 123456');
    });

    it('should normalize "G.R.No.123456" to "G.R. No. 123456"', () => {
      expect(service.normalizeGrNo('G.R.No.123456')).toBe('G.R. No. 123456');
    });

    it('should normalize "GRN 123456"', () => {
      // The regex first branch matches "GR" then captures "N 123456"
      expect(service.normalizeGrNo('GRN 123456')).toBe('G.R. No. N 123456');
    });

    it('should normalize "GR-123456" to "G.R. No. 123456"', () => {
      expect(service.normalizeGrNo('GR-123456')).toBe('G.R. No. 123456');
    });

    it('should preserve already canonical format "G.R. No. 123456"', () => {
      expect(service.normalizeGrNo('G.R. No. 123456')).toBe('G.R. No. 123456');
    });

    it('should normalize "G.R. NO. 123456" (uppercase) to "G.R. No. 123456"', () => {
      expect(service.normalizeGrNo('G.R. NO. 123456')).toBe('G.R. No. 123456');
    });

    it('should normalize with extra spaces "GR   No.   123456"', () => {
      expect(service.normalizeGrNo('GR   No.   123456')).toBe('G.R. No. 123456');
    });

    it('should handle leading and trailing whitespace', () => {
      expect(service.normalizeGrNo('  GR No. 123456  ')).toBe('G.R. No. 123456');
    });

    it('should normalize "gr no 123456" (lowercase) to "G.R. No. 123456"', () => {
      expect(service.normalizeGrNo('gr no 123456')).toBe('G.R. No. 123456');
    });

    it('should return input as-is if pattern does not match', () => {
      expect(service.normalizeGrNo('SOMETHING 123456')).toBe('SOMETHING 123456');
    });
  });

  describe('normalizeCitation', () => {
    it('should trim whitespace from citation', () => {
      expect(service.normalizeCitation('  123 Phil. 456  ')).toBe('123 Phil. 456');
    });

    it('should collapse multiple spaces to single space', () => {
      expect(service.normalizeCitation('123   Phil.    456')).toBe('123 Phil. 456');
    });

    it('should handle mixed whitespace (tabs, newlines)', () => {
      expect(service.normalizeCitation('123\tPhil.\n456')).toBe('123 Phil. 456');
    });

    it('should handle citation with no extra whitespace', () => {
      expect(service.normalizeCitation('123 Phil. 456')).toBe('123 Phil. 456');
    });

    it('should collapse whitespace and trim in complex citation', () => {
      expect(service.normalizeCitation('  G.R.  No.   123456,    January   15,   2024  ')).toBe(
        'G.R. No. 123456, January 15, 2024',
      );
    });
  });
});
