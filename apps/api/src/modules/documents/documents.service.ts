import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateLegalDocumentDto,
  UpdateLegalDocumentDto,
  ListDocumentsQueryDto,
  CreateDocumentSectionDto,
} from './dto';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---- Legal Document CRUD ----

  async create(dto: CreateLegalDocumentDto) {
    const data: Prisma.LegalDocumentCreateInput = {
      documentType: dto.documentType,
      title: dto.title.trim(),
      shortTitle: dto.shortTitle?.trim(),
      citationText: dto.citationText ? this.normalizeCitation(dto.citationText) : undefined,
      grNo: dto.grNo ? this.normalizeGrNo(dto.grNo) : undefined,
      docketNo: dto.docketNo?.trim(),
      promulgationDate: dto.promulgationDate ? new Date(dto.promulgationDate) : undefined,
      decisionDate: dto.decisionDate ? new Date(dto.decisionDate) : undefined,
      publicationDate: dto.publicationDate ? new Date(dto.publicationDate) : undefined,
      ponente: dto.ponente?.trim(),
      court: dto.court?.trim(),
      agency: dto.agency?.trim(),
      jurisdiction: dto.jurisdiction ?? 'PH',
      language: dto.language ?? 'en',
      canonicalUrl: dto.canonicalUrl,
      externalId: dto.externalId?.trim(),
      isOfficial: dto.isOfficial ?? false,
      status: 'draft',
      truthfulnessStatus: 'needs_review',
      ...(dto.sourceId && {
        source: { connect: { id: dto.sourceId } },
      }),
    };

    return this.prisma.legalDocument.create({ data });
  }

  async findById(id: string) {
    const doc = await this.prisma.legalDocument.findUnique({
      where: { id },
      include: {
        source: { select: { id: true, name: true, type: true, trustLevel: true } },
        _count: { select: { sections: true, citationsFrom: true, bookmarks: true, digests: true } },
      },
    });

    if (!doc) {
      throw new NotFoundException('Legal document not found');
    }

    return doc;
  }

  async update(id: string, dto: UpdateLegalDocumentDto) {
    await this.assertDocExists(id);

    const data: Prisma.LegalDocumentUpdateInput = {};

    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.shortTitle !== undefined) data.shortTitle = dto.shortTitle.trim();
    if (dto.citationText !== undefined) data.citationText = this.normalizeCitation(dto.citationText);
    if (dto.grNo !== undefined) data.grNo = this.normalizeGrNo(dto.grNo);
    if (dto.docketNo !== undefined) data.docketNo = dto.docketNo.trim();
    if (dto.promulgationDate !== undefined) data.promulgationDate = new Date(dto.promulgationDate);
    if (dto.decisionDate !== undefined) data.decisionDate = new Date(dto.decisionDate);
    if (dto.publicationDate !== undefined) data.publicationDate = new Date(dto.publicationDate);
    if (dto.ponente !== undefined) data.ponente = dto.ponente.trim();
    if (dto.court !== undefined) data.court = dto.court.trim();
    if (dto.agency !== undefined) data.agency = dto.agency.trim();
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.isPublished !== undefined) data.isPublished = dto.isPublished;
    if (dto.isOfficial !== undefined) data.isOfficial = dto.isOfficial;
    if (dto.truthfulnessStatus !== undefined) data.truthfulnessStatus = dto.truthfulnessStatus;

    return this.prisma.legalDocument.update({ where: { id }, data });
  }

  async list(query: ListDocumentsQueryDto) {
    const limit = query.limit ?? 20;

    const where: Prisma.LegalDocumentWhereInput = {};

    if (query.documentType) where.documentType = query.documentType;
    if (query.status) where.status = query.status;
    if (query.court) where.court = { contains: query.court, mode: 'insensitive' };
    if (query.ponente) where.ponente = { contains: query.ponente, mode: 'insensitive' };
    if (query.sourceId) where.sourceId = query.sourceId;
    if (query.grNo) where.grNo = { contains: query.grNo, mode: 'insensitive' };
    if (query.publishedOnly === 'true') where.isPublished = true;

    if (query.search) {
      where.title = { contains: query.search, mode: 'insensitive' };
    }

    if (query.dateFrom || query.dateTo) {
      where.decisionDate = {};
      if (query.dateFrom) where.decisionDate.gte = new Date(query.dateFrom);
      if (query.dateTo) where.decisionDate.lte = new Date(query.dateTo);
    }

    const documents = await this.prisma.legalDocument.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        documentType: true,
        title: true,
        shortTitle: true,
        citationText: true,
        grNo: true,
        decisionDate: true,
        ponente: true,
        court: true,
        status: true,
        isPublished: true,
        isOfficial: true,
        truthfulnessStatus: true,
        createdAt: true,
        source: { select: { id: true, name: true } },
      },
    });

    const hasNext = documents.length > limit;
    const items = hasNext ? documents.slice(0, limit) : documents;
    const lastItem = items[items.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items,
      meta: { hasNext, nextCursor, limit },
    };
  }

  // ---- Sections ----

  async listSections(documentId: string) {
    await this.assertDocExists(documentId);

    return this.prisma.legalDocumentSection.findMany({
      where: { legalDocumentId: documentId },
      orderBy: { ordering: 'asc' },
      select: {
        id: true,
        sectionType: true,
        sectionLabel: true,
        parentSectionId: true,
        ordering: true,
        plainText: true,
        pageStart: true,
        pageEnd: true,
        tokenCount: true,
        createdAt: true,
      },
    });
  }

  async getSection(documentId: string, sectionId: string) {
    const section = await this.prisma.legalDocumentSection.findFirst({
      where: { id: sectionId, legalDocumentId: documentId },
    });

    if (!section) {
      throw new NotFoundException('Section not found');
    }

    return section;
  }

  async createSection(documentId: string, dto: CreateDocumentSectionDto) {
    await this.assertDocExists(documentId);

    return this.prisma.legalDocumentSection.create({
      data: {
        legalDocumentId: documentId,
        sectionType: dto.sectionType,
        sectionLabel: dto.sectionLabel?.trim(),
        parentSectionId: dto.parentSectionId,
        ordering: dto.ordering ?? 0,
        plainText: dto.plainText,
        htmlText: dto.htmlText,
        pageStart: dto.pageStart,
        pageEnd: dto.pageEnd,
        tokenCount: dto.tokenCount,
      },
    });
  }

  async createSectionsBulk(documentId: string, sections: CreateDocumentSectionDto[]) {
    await this.assertDocExists(documentId);

    return this.prisma.$transaction(
      sections.map((dto) =>
        this.prisma.legalDocumentSection.create({
          data: {
            legalDocumentId: documentId,
            sectionType: dto.sectionType,
            sectionLabel: dto.sectionLabel?.trim(),
            parentSectionId: dto.parentSectionId,
            ordering: dto.ordering ?? 0,
            plainText: dto.plainText,
            htmlText: dto.htmlText,
            pageStart: dto.pageStart,
            pageEnd: dto.pageEnd,
            tokenCount: dto.tokenCount,
          },
        }),
      ),
    );
  }

  // ---- Citations ----

  async listCitations(documentId: string) {
    await this.assertDocExists(documentId);

    return this.prisma.citation.findMany({
      where: { fromDocumentId: documentId },
      orderBy: { createdAt: 'asc' },
      include: {
        toDocument: {
          select: { id: true, title: true, citationText: true, grNo: true },
        },
      },
    });
  }

  // ---- Related Documents ----

  async listRelated(documentId: string) {
    await this.assertDocExists(documentId);

    // Find documents cited by this document (outgoing citations)
    const outgoing = await this.prisma.citation.findMany({
      where: { fromDocumentId: documentId, toDocumentId: { not: null } },
      select: { toDocumentId: true },
      distinct: ['toDocumentId'],
      take: 20,
    });

    // Find documents that cite this document (incoming citations)
    const incoming = await this.prisma.citation.findMany({
      where: { toDocumentId: documentId },
      select: { fromDocumentId: true },
      distinct: ['fromDocumentId'],
      take: 20,
    });

    const relatedIds = new Set<string>();
    for (const c of outgoing) {
      if (c.toDocumentId) relatedIds.add(c.toDocumentId);
    }
    for (const c of incoming) {
      relatedIds.add(c.fromDocumentId);
    }
    relatedIds.delete(documentId);

    if (relatedIds.size === 0) return [];

    return this.prisma.legalDocument.findMany({
      where: { id: { in: Array.from(relatedIds) } },
      select: {
        id: true,
        documentType: true,
        title: true,
        shortTitle: true,
        citationText: true,
        grNo: true,
        decisionDate: true,
        court: true,
      },
    });
  }

  // ---- Publish / Quarantine ----

  async publishDocument(id: string) {
    const doc = await this.prisma.legalDocument.findUnique({
      where: { id },
      include: {
        source: { select: { id: true, trustLevel: true } },
        editorialFlags: {
          where: { status: 'open', severity: 'high' },
          select: { id: true },
        },
      },
    });

    if (!doc) {
      throw new NotFoundException('Legal document not found');
    }

    if (doc.editorialFlags.length > 0) {
      throw new BadRequestException(
        `Cannot publish: ${doc.editorialFlags.length} high-severity editorial flag(s) still open`,
      );
    }

    return this.prisma.legalDocument.update({
      where: { id },
      data: {
        status: 'published',
        truthfulnessStatus: 'verified',
        isPublished: true,
      },
    });
  }

  async quarantineDocument(id: string) {
    await this.assertDocExists(id);

    return this.prisma.legalDocument.update({
      where: { id },
      data: {
        truthfulnessStatus: 'quarantined',
        isPublished: false,
      },
    });
  }

  // ---- Helpers ----

  private async assertDocExists(id: string): Promise<void> {
    const count = await this.prisma.legalDocument.count({ where: { id } });
    if (count === 0) {
      throw new NotFoundException('Legal document not found');
    }
  }

  /**
   * Normalize G.R. No. variations to canonical format per CLAUDE.md:
   * GR, G.R., GRN → G.R. No. XXXXXX
   */
  normalizeGrNo(raw: string): string {
    const trimmed = raw.trim();
    // Already canonical
    if (/^G\.R\. No\. /i.test(trimmed)) {
      return trimmed.replace(/^G\.R\. No\.\s*/i, 'G.R. No. ');
    }
    // Variations: "GR No.", "G.R.No.", "GRN", "GR-", etc.
    const match = trimmed.match(/^(?:G\.?R\.?\s*(?:No\.?)?\s*[-]?\s*|GRN?\s*[-]?\s*)(.*)/i);
    if (match && match[1]) {
      return `G.R. No. ${match[1].trim()}`;
    }
    return trimmed;
  }

  /**
   * Normalize citation text: trim whitespace, collapse multiple spaces.
   */
  normalizeCitation(raw: string): string {
    return raw.trim().replace(/\s+/g, ' ');
  }
}
