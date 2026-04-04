import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateBookmarkDto, ListBookmarksQueryDto } from './dto';

@Injectable()
export class BookmarksService {
  private readonly logger = new Logger(BookmarksService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBookmarkDto, userId: string) {
    // Verify the legal document exists
    const docCount = await this.prisma.legalDocument.count({
      where: { id: dto.legalDocumentId },
    });
    if (docCount === 0) {
      throw new NotFoundException('Legal document not found');
    }

    // Verify section exists if provided
    if (dto.legalDocumentSectionId) {
      const sectionCount = await this.prisma.legalDocumentSection.count({
        where: { id: dto.legalDocumentSectionId, legalDocumentId: dto.legalDocumentId },
      });
      if (sectionCount === 0) {
        throw new NotFoundException('Section not found in this document');
      }
    }

    // Check for duplicate bookmark (same user + doc + section)
    const existing = await this.prisma.bookmark.findFirst({
      where: {
        userId,
        legalDocumentId: dto.legalDocumentId,
        legalDocumentSectionId: dto.legalDocumentSectionId ?? null,
      },
    });
    if (existing) {
      throw new ConflictException('Bookmark already exists for this document/section');
    }

    return this.prisma.bookmark.create({
      data: {
        userId,
        legalDocumentId: dto.legalDocumentId,
        legalDocumentSectionId: dto.legalDocumentSectionId,
        note: dto.note?.trim(),
      },
      include: {
        legalDocument: {
          select: { id: true, title: true, shortTitle: true, citationText: true, grNo: true },
        },
        section: {
          select: { id: true, sectionType: true, sectionLabel: true },
        },
      },
    });
  }

  async list(userId: string, query: ListBookmarksQueryDto) {
    const limit = query.limit ?? 20;

    const where: { userId: string; legalDocumentId?: string } = { userId };
    if (query.legalDocumentId) {
      where.legalDocumentId = query.legalDocumentId;
    }

    const bookmarks = await this.prisma.bookmark.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { createdAt: 'desc' },
      include: {
        legalDocument: {
          select: {
            id: true,
            title: true,
            shortTitle: true,
            citationText: true,
            grNo: true,
            documentType: true,
            court: true,
            decisionDate: true,
          },
        },
        section: {
          select: { id: true, sectionType: true, sectionLabel: true },
        },
      },
    });

    const hasNext = bookmarks.length > limit;
    const items = hasNext ? bookmarks.slice(0, limit) : bookmarks;
    const lastItem = items[items.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items,
      meta: { hasNext, nextCursor, limit },
    };
  }

  async delete(bookmarkId: string, userId: string) {
    const bookmark = await this.prisma.bookmark.findFirst({
      where: { id: bookmarkId, userId },
    });

    if (!bookmark) {
      throw new NotFoundException('Bookmark not found');
    }

    await this.prisma.bookmark.delete({ where: { id: bookmarkId } });
  }
}
