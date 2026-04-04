import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { StudyExportService } from './study-export.service';

// Mock pdfkit — return a writable stream-like object
jest.mock('pdfkit', () => {
  return jest.fn().mockImplementation(() => {
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    return {
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(handler);
        return this;
      }),
      fontSize: jest.fn().mockReturnThis(),
      font: jest.fn().mockReturnThis(),
      text: jest.fn().mockReturnThis(),
      fillColor: jest.fn().mockReturnThis(),
      moveDown: jest.fn().mockReturnThis(),
      moveTo: jest.fn().mockReturnThis(),
      lineTo: jest.fn().mockReturnThis(),
      strokeColor: jest.fn().mockReturnThis(),
      stroke: jest.fn().mockReturnThis(),
      addPage: jest.fn().mockReturnThis(),
      end: jest.fn(() => {
        // Emit data then end
        if (handlers['data']) handlers['data'].forEach(h => h(Buffer.from('pdf-content')));
        if (handlers['end']) handlers['end'].forEach(h => h());
      }),
      page: { width: 612, height: 792 },
      y: 100,
    };
  });
});

// Mock docx
jest.mock('docx', () => ({
  Document: jest.fn().mockImplementation(() => ({})),
  Packer: {
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('docx-content')),
  },
  Paragraph: jest.fn().mockImplementation(() => ({})),
  TextRun: jest.fn().mockImplementation(() => ({})),
  HeadingLevel: { HEADING_1: 'HEADING_1' },
  AlignmentType: { CENTER: 'CENTER' },
  BorderStyle: { SINGLE: 'SINGLE' },
  Table: jest.fn().mockImplementation(() => ({})),
  TableRow: jest.fn().mockImplementation(() => ({})),
  TableCell: jest.fn().mockImplementation(() => ({})),
  WidthType: { PERCENTAGE: 'PERCENTAGE' },
  ShadingType: { SOLID: 'SOLID' },
}));

describe('StudyExportService', () => {
  let service: StudyExportService;
  let prisma: jest.Mocked<PrismaService>;

  const userId = 'user-1';
  const orgId = 'org-1';

  const mockFlashcardSet = {
    id: 'set-1',
    userId,
    organizationId: orgId,
    title: 'Civil Law Flashcards',
    description: 'Key provisions from the Civil Code',
    barSubject: 'civil_law',
    topic: 'Obligations',
    visibility: 'private',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockFlashcards = [
    {
      id: 'fc-1',
      flashcardSetId: 'set-1',
      front: 'What is Article 1191?',
      back: 'Rescission of reciprocal obligations.',
      cardType: 'definition',
      ordering: 0,
      legalDocument: { id: 'doc-1', title: 'Civil Code', shortTitle: 'CC', citationText: 'R.A. No. 386' },
      digest: null,
    },
    {
      id: 'fc-2',
      flashcardSetId: 'set-1',
      front: 'What is Article 2176?',
      back: 'Quasi-delicts — whoever causes damage to another by fault or negligence.',
      cardType: 'definition',
      ordering: 1,
      legalDocument: null,
      digest: { id: 'dig-1', title: 'Torts Digest' },
    },
  ];

  const mockReviewerPack = {
    id: 'pack-1',
    creatorUserId: userId,
    organizationId: orgId,
    title: 'Criminal Law Reviewer',
    description: 'Essential cases for criminal law',
    barSubject: 'criminal_law',
    topic: 'Crimes Against Persons',
    visibility: 'private',
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [
      {
        id: 'item-1',
        itemType: 'legal_document',
        ordering: 0,
        note: 'Landmark case on treachery',
        legalDocument: {
          id: 'doc-2',
          title: 'People v. Dela Cruz',
          shortTitle: 'Dela Cruz',
          citationText: 'G.R. No. 123456',
          documentType: 'case',
          court: 'Supreme Court',
        },
        digest: null,
        section: null,
      },
      {
        id: 'item-2',
        itemType: 'digest',
        ordering: 1,
        note: null,
        legalDocument: null,
        digest: { id: 'dig-2', title: 'Murder Elements', digestType: 'case_digest' },
        section: null,
      },
      {
        id: 'item-3',
        itemType: 'section',
        ordering: 2,
        note: 'Key provision',
        legalDocument: null,
        digest: null,
        section: { id: 'sec-1', sectionLabel: 'Article 248', sectionType: 'article' },
      },
    ],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudyExportService,
        {
          provide: PrismaService,
          useValue: {
            flashcardSet: {
              findUnique: jest.fn(),
            },
            flashcard: {
              findMany: jest.fn(),
            },
            reviewerPack: {
              findUnique: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<StudyExportService>(StudyExportService);
    prisma = module.get(PrismaService);
  });

  // =========================================================================
  // Flashcard Set Export
  // =========================================================================

  describe('exportFlashcardSetPdf', () => {
    it('should export flashcard set as PDF with buffer and filename', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValueOnce(mockFlashcardSet);
      (prisma.flashcard.findMany as jest.Mock).mockResolvedValueOnce(mockFlashcards);

      const result = await service.exportFlashcardSetPdf('set-1', userId, orgId);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.filename).toContain('flashcards.pdf');
      expect(result.filename).toContain('Civil Law Flashcards');
    });

    it('should throw NotFoundException when set does not exist', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.exportFlashcardSetPdf('missing', userId, orgId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when user lacks access', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockFlashcardSet,
        userId: 'other-user',
        organizationId: 'other-org',
        visibility: 'private',
      });

      await expect(
        service.exportFlashcardSetPdf('set-1', userId, orgId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow access for org-visibility sets within same org', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockFlashcardSet,
        userId: 'other-user',
        visibility: 'org',
      });
      (prisma.flashcard.findMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.exportFlashcardSetPdf('set-1', userId, orgId);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should allow access for public_editorial sets', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockFlashcardSet,
        userId: 'other-user',
        organizationId: 'other-org',
        visibility: 'public_editorial',
      });
      (prisma.flashcard.findMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.exportFlashcardSetPdf('set-1', userId, orgId);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });
  });

  describe('exportFlashcardSetDocx', () => {
    it('should export flashcard set as DOCX with buffer and filename', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValueOnce(mockFlashcardSet);
      (prisma.flashcard.findMany as jest.Mock).mockResolvedValueOnce(mockFlashcards);

      const result = await service.exportFlashcardSetDocx('set-1', userId, orgId);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.filename).toContain('flashcards.docx');
    });

    it('should throw NotFoundException when set does not exist', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.exportFlashcardSetDocx('missing', userId, orgId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle empty flashcard sets', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValueOnce(mockFlashcardSet);
      (prisma.flashcard.findMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.exportFlashcardSetDocx('set-1', userId, orgId);
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.filename).toContain('docx');
    });
  });

  // =========================================================================
  // Reviewer Pack Export
  // =========================================================================

  describe('exportReviewerPackPdf', () => {
    it('should export reviewer pack as PDF with buffer and filename', async () => {
      (prisma.reviewerPack.findUnique as jest.Mock).mockResolvedValueOnce(mockReviewerPack);

      const result = await service.exportReviewerPackPdf('pack-1', userId, orgId);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.filename).toContain('reviewer-pack.pdf');
      expect(result.filename).toContain('Criminal Law Reviewer');
    });

    it('should throw NotFoundException when pack does not exist', async () => {
      (prisma.reviewerPack.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.exportReviewerPackPdf('missing', userId, orgId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when user lacks access', async () => {
      (prisma.reviewerPack.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockReviewerPack,
        creatorUserId: 'other-user',
        organizationId: 'other-org',
      });

      await expect(
        service.exportReviewerPackPdf('pack-1', userId, orgId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('exportReviewerPackDocx', () => {
    it('should export reviewer pack as DOCX with buffer and filename', async () => {
      (prisma.reviewerPack.findUnique as jest.Mock).mockResolvedValueOnce(mockReviewerPack);

      const result = await service.exportReviewerPackDocx('pack-1', userId, orgId);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.filename).toContain('reviewer-pack.docx');
    });

    it('should throw NotFoundException when pack does not exist', async () => {
      (prisma.reviewerPack.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.exportReviewerPackDocx('missing', userId, orgId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle pack with no items', async () => {
      (prisma.reviewerPack.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockReviewerPack,
        items: [],
      });

      const result = await service.exportReviewerPackDocx('pack-1', userId, orgId);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should handle items with section type (no label)', async () => {
      (prisma.reviewerPack.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockReviewerPack,
        items: [
          {
            id: 'item-4',
            itemType: 'section',
            ordering: 0,
            note: null,
            legalDocument: null,
            digest: null,
            section: { id: 'sec-2', sectionLabel: null, sectionType: 'headnote' },
          },
        ],
      });

      const result = await service.exportReviewerPackDocx('pack-1', userId, orgId);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });
  });

  // =========================================================================
  // Access Control
  // =========================================================================

  describe('access control (assertAccess)', () => {
    it('should allow private set owner to export', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValueOnce(mockFlashcardSet);
      (prisma.flashcard.findMany as jest.Mock).mockResolvedValueOnce([]);

      await expect(
        service.exportFlashcardSetDocx('set-1', userId, orgId),
      ).resolves.toBeDefined();
    });

    it('should deny different user from exporting private set', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockFlashcardSet,
        userId: 'other-user',
        organizationId: 'other-org',
        visibility: 'private',
      });

      await expect(
        service.exportFlashcardSetDocx('set-1', userId, orgId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow same-org user to export org-visibility set', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockFlashcardSet,
        userId: 'other-user',
        visibility: 'org',
      });
      (prisma.flashcard.findMany as jest.Mock).mockResolvedValueOnce([]);

      await expect(
        service.exportFlashcardSetDocx('set-1', userId, orgId),
      ).resolves.toBeDefined();
    });

    it('should allow anyone to export public_editorial set', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockFlashcardSet,
        userId: 'other-user',
        organizationId: 'other-org',
        visibility: 'public_editorial',
      });
      (prisma.flashcard.findMany as jest.Mock).mockResolvedValueOnce([]);

      await expect(
        service.exportFlashcardSetDocx('set-1', userId, orgId),
      ).resolves.toBeDefined();
    });
  });

  // =========================================================================
  // Filename sanitization
  // =========================================================================

  describe('filename sanitization', () => {
    it('should strip special characters from filename', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockFlashcardSet,
        title: 'Civil Law: "Obligations" & Contracts <2024>',
      });
      (prisma.flashcard.findMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.exportFlashcardSetDocx('set-1', userId, orgId);
      // Should not contain colons, quotes, angle brackets, etc.
      expect(result.filename).not.toMatch(/[:"<>&]/);
      expect(result.filename).toContain('docx');
    });

    it('should truncate long titles to 80 characters', async () => {
      (prisma.flashcardSet.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockFlashcardSet,
        title: 'A'.repeat(200),
      });
      (prisma.flashcard.findMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.exportFlashcardSetDocx('set-1', userId, orgId);
      // Filename = truncated title + suffix
      const nameWithoutSuffix = result.filename.replace('-flashcards.docx', '');
      expect(nameWithoutSuffix.length).toBeLessThanOrEqual(80);
    });
  });
});
