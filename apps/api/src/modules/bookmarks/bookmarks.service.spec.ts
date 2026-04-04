import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { BookmarksService } from './bookmarks.service';
import type { CreateBookmarkDto, ListBookmarksQueryDto } from './dto';

describe('BookmarksService', () => {
  let service: BookmarksService;
  let prisma: jest.Mocked<PrismaService>;

  const userId = 'user-1';

  const mockBookmark = {
    id: 'bm-1',
    userId,
    legalDocumentId: 'doc-1',
    legalDocumentSectionId: null,
    note: 'Important case',
    createdAt: new Date(),
    legalDocument: {
      id: 'doc-1',
      title: 'People v. Santos',
      shortTitle: 'Santos',
      citationText: 'G.R. No. 123456',
      grNo: 'G.R. No. 123456',
    },
    section: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookmarksService,
        {
          provide: PrismaService,
          useValue: {
            legalDocument: {
              count: jest.fn(),
            },
            legalDocumentSection: {
              count: jest.fn(),
            },
            bookmark: {
              findFirst: jest.fn(),
              findMany: jest.fn(),
              create: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<BookmarksService>(BookmarksService);
    prisma = module.get(PrismaService);
  });

  // ---- create ----

  describe('create', () => {
    const dto: CreateBookmarkDto = {
      legalDocumentId: 'doc-1',
      note: '  Important case  ',
    };

    it('should create a bookmark successfully', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.bookmark.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.bookmark.create as jest.Mock).mockResolvedValue(mockBookmark);

      const result = await service.create(dto, userId);

      expect(result).toEqual(mockBookmark);
      expect(prisma.bookmark.create).toHaveBeenCalledWith({
        data: {
          userId,
          legalDocumentId: 'doc-1',
          legalDocumentSectionId: undefined,
          note: 'Important case', // trimmed
        },
        include: expect.any(Object),
      });
    });

    it('should throw NotFoundException when legal document does not exist', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(0);

      await expect(service.create(dto, userId)).rejects.toThrow(NotFoundException);
      await expect(service.create(dto, userId)).rejects.toThrow('Legal document not found');
    });

    it('should throw NotFoundException when section does not exist', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.legalDocumentSection.count as jest.Mock).mockResolvedValue(0);

      const dtoWithSection: CreateBookmarkDto = {
        legalDocumentId: 'doc-1',
        legalDocumentSectionId: 'section-999',
      };

      await expect(service.create(dtoWithSection, userId)).rejects.toThrow(NotFoundException);
      await expect(service.create(dtoWithSection, userId)).rejects.toThrow(
        'Section not found in this document',
      );
    });

    it('should verify section belongs to the same document', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.legalDocumentSection.count as jest.Mock).mockResolvedValue(1);
      (prisma.bookmark.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.bookmark.create as jest.Mock).mockResolvedValue(mockBookmark);

      const dtoWithSection: CreateBookmarkDto = {
        legalDocumentId: 'doc-1',
        legalDocumentSectionId: 'section-1',
      };

      await service.create(dtoWithSection, userId);

      expect(prisma.legalDocumentSection.count).toHaveBeenCalledWith({
        where: { id: 'section-1', legalDocumentId: 'doc-1' },
      });
    });

    it('should throw ConflictException for duplicate bookmark', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.bookmark.findFirst as jest.Mock).mockResolvedValue(mockBookmark);

      await expect(service.create(dto, userId)).rejects.toThrow(ConflictException);
      await expect(service.create(dto, userId)).rejects.toThrow(
        'Bookmark already exists for this document/section',
      );
    });

    it('should treat null section as distinct from specific section for duplicates', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.bookmark.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.bookmark.create as jest.Mock).mockResolvedValue(mockBookmark);

      await service.create(dto, userId);

      expect(prisma.bookmark.findFirst).toHaveBeenCalledWith({
        where: {
          userId,
          legalDocumentId: 'doc-1',
          legalDocumentSectionId: null,
        },
      });
    });

    it('should handle undefined note gracefully', async () => {
      (prisma.legalDocument.count as jest.Mock).mockResolvedValue(1);
      (prisma.bookmark.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.bookmark.create as jest.Mock).mockResolvedValue(mockBookmark);

      await service.create({ legalDocumentId: 'doc-1' }, userId);

      expect(prisma.bookmark.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ note: undefined }),
        }),
      );
    });
  });

  // ---- list ----

  describe('list', () => {
    it('should return paginated bookmarks with default limit', async () => {
      const bookmarks = Array.from({ length: 21 }, (_, i) => ({
        ...mockBookmark,
        id: `bm-${i}`,
      }));
      (prisma.bookmark.findMany as jest.Mock).mockResolvedValue(bookmarks);

      const result = await service.list(userId, {});

      expect(result.items).toHaveLength(20);
      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.nextCursor).toBe('bm-19');
      expect(result.meta.limit).toBe(20);
    });

    it('should return all items when under limit', async () => {
      const bookmarks = [{ ...mockBookmark, id: 'bm-1' }];
      (prisma.bookmark.findMany as jest.Mock).mockResolvedValue(bookmarks);

      const result = await service.list(userId, {});

      expect(result.items).toHaveLength(1);
      expect(result.meta.hasNext).toBe(false);
      expect(result.meta.nextCursor).toBeUndefined();
    });

    it('should support custom limit', async () => {
      (prisma.bookmark.findMany as jest.Mock).mockResolvedValue([]);

      await service.list(userId, { limit: 5 });

      expect(prisma.bookmark.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 6 }), // limit + 1
      );
    });

    it('should support cursor-based pagination', async () => {
      (prisma.bookmark.findMany as jest.Mock).mockResolvedValue([]);

      await service.list(userId, { cursor: 'bm-5' });

      expect(prisma.bookmark.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 1,
          cursor: { id: 'bm-5' },
        }),
      );
    });

    it('should filter by legalDocumentId when provided', async () => {
      (prisma.bookmark.findMany as jest.Mock).mockResolvedValue([]);

      await service.list(userId, { legalDocumentId: 'doc-1' });

      expect(prisma.bookmark.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, legalDocumentId: 'doc-1' },
        }),
      );
    });

    it('should not include legalDocumentId filter when not provided', async () => {
      (prisma.bookmark.findMany as jest.Mock).mockResolvedValue([]);

      await service.list(userId, {});

      expect(prisma.bookmark.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId },
        }),
      );
    });

    it('should order by createdAt desc', async () => {
      (prisma.bookmark.findMany as jest.Mock).mockResolvedValue([]);

      await service.list(userId, {});

      expect(prisma.bookmark.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should include related document and section data', async () => {
      (prisma.bookmark.findMany as jest.Mock).mockResolvedValue([]);

      await service.list(userId, {});

      expect(prisma.bookmark.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            legalDocument: expect.any(Object),
            section: expect.any(Object),
          }),
        }),
      );
    });
  });

  // ---- delete ----

  describe('delete', () => {
    it('should delete bookmark owned by user', async () => {
      (prisma.bookmark.findFirst as jest.Mock).mockResolvedValue(mockBookmark);
      (prisma.bookmark.delete as jest.Mock).mockResolvedValue(mockBookmark);

      await service.delete('bm-1', userId);

      expect(prisma.bookmark.delete).toHaveBeenCalledWith({
        where: { id: 'bm-1' },
      });
    });

    it('should throw NotFoundException when bookmark does not exist', async () => {
      (prisma.bookmark.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.delete('bm-999', userId)).rejects.toThrow(NotFoundException);
      await expect(service.delete('bm-999', userId)).rejects.toThrow('Bookmark not found');
    });

    it('should scope lookup to the requesting user', async () => {
      (prisma.bookmark.findFirst as jest.Mock).mockResolvedValue(null);

      await service.delete('bm-1', 'other-user').catch(() => {});

      expect(prisma.bookmark.findFirst).toHaveBeenCalledWith({
        where: { id: 'bm-1', userId: 'other-user' },
      });
    });
  });
});
