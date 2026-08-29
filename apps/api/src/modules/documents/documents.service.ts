import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';

import { PaywallException } from '../../common/exceptions/paywall.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CONTENT_PUBLISHED_EVENT,
  type ContentPublishedEvent,
} from '../audio/audio.events';
import {
  CreateLegalDocumentDto,
  UpdateLegalDocumentDto,
  ListDocumentsQueryDto,
  CreateDocumentSectionDto,
} from './dto';

const AUTO_ENQUEUE_DERIVATIVE_TYPES = ['case_digest', 'doctrine_extract'] as const;

/**
 * Document types a non-entitled ("previewOnly") caller may read in full: the
 * statutory corpus. `decision` (Supreme Court decisions) and
 * `bar_exam_questions` are paid and fall outside this list.
 *
 * This is a TYPE allowlist, not an id allowlist, so it needs no cache: the
 * filter is a `documentType IN (...)` predicate served by
 * `idx_legal_docs_type`. Lists and search FILTER locked rows out rather than
 * showing-and-refusing them, so a 402 is only ever reachable by direct id.
 */
export const FREE_DOCUMENT_TYPES = [
  'codal',
  'rules_of_court',
  'constitution',
  'republic_act',
  'presidential_decree',
  'executive_order',
  'administrative_matter',
  'administrative_case',
] as const;

export type FreeDocumentType = (typeof FREE_DOCUMENT_TYPES)[number];

/** Whether a document type is readable without an entitlement. */
export function isFreeDocumentType(documentType: string | null | undefined): boolean {
  return (
    documentType != null &&
    (FREE_DOCUMENT_TYPES as readonly string[]).includes(documentType)
  );
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

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

  async findById(id: string, previewOnly = false) {
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

    if (previewOnly && !isFreeDocumentType(doc.documentType)) {
      throw new PaywallException({ corpus: 'documents' });
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

  async list(query: ListDocumentsQueryDto, previewOnly = false) {
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

    // Free tier: locked document types are FILTERED OUT of the list rather
    // than returned-and-refused, so a 402 is never reachable by tapping a
    // result (App Store 3.1.1). `lockedCount` still reports how much of the
    // corpus is out of reach so web can render its upgrade banner; the mobile
    // client ignores it.
    let lockedCount = 0;
    if (previewOnly) {
      const allowedTypes = query.documentType
        ? (FREE_DOCUMENT_TYPES as readonly string[]).filter(
            (t) => t === query.documentType,
          )
        : (FREE_DOCUMENT_TYPES as readonly string[]);

      lockedCount = await this.prisma.legalDocument.count({
        where: { ...where, documentType: { notIn: [...FREE_DOCUMENT_TYPES] } },
      });

      where.documentType =
        allowedTypes.length === 0 ? { in: [] } : { in: [...allowedTypes] };
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
      meta: {
        hasNext,
        nextCursor,
        limit,
        ...(previewOnly && {
          previewMode: true,
          lockedCount,
          upgradeRequired: true,
        }),
      },
    };
  }

  /**
   * Free-tier gate for a single document. Throws 404 if the document does not
   * exist, 402 only when it exists and its type is outside
   * {@link FREE_DOCUMENT_TYPES}. Reachable by direct id only — every list and
   * search surface filters locked types out before the caller can tap one.
   */
  private async assertDocumentTypeAllowed(id: string): Promise<void> {
    const doc = await this.prisma.legalDocument.findUnique({
      where: { id },
      select: { documentType: true },
    });
    if (!doc) {
      throw new NotFoundException('Legal document not found');
    }
    if (!isFreeDocumentType(doc.documentType)) {
      throw new PaywallException({ corpus: 'documents' });
    }
  }

  // ---- Sections ----

  async listSections(documentId: string, previewOnly = false) {
    if (previewOnly) {
      await this.assertDocumentTypeAllowed(documentId);
    }
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

  async getSection(documentId: string, sectionId: string, previewOnly = false) {
    if (previewOnly) {
      await this.assertDocumentTypeAllowed(documentId);
    }

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

  async listCitations(documentId: string, previewOnly = false) {
    if (previewOnly) {
      await this.assertDocumentTypeAllowed(documentId);
    }
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

  async listRelated(documentId: string, previewOnly = false) {
    if (previewOnly) {
      await this.assertDocumentTypeAllowed(documentId);
    }
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

    const updated = await this.prisma.legalDocument.update({
      where: { id },
      data: {
        status: 'published',
        truthfulnessStatus: 'verified',
        isPublished: true,
      },
    });

    // Domain event, not a direct AudioModule import — a direct dependency
    // would create a documents -> audio -> digests cycle.
    this.events.emit(CONTENT_PUBLISHED_EVENT, {
      contentType: 'legal_document',
      contentId: id,
    } satisfies ContentPublishedEvent);

    // Auto-enqueue derivative generation jobs (fire-and-forget — never
    // block the publish response).
    this.enqueueDerivativeJobs(id).catch((err) => {
      this.logger.error(
        `Failed to auto-enqueue derivative jobs for document ${id}`,
        err,
      );
    });

    return updated;
  }

  private async enqueueDerivativeJobs(documentId: string): Promise<void> {
    const enqueuedTypes: string[] = [];
    const skippedTypes: string[] = [];
    const jobIds: string[] = [];

    for (const derivativeType of AUTO_ENQUEUE_DERIVATIVE_TYPES) {
      // Skip if a pending or running job already exists
      const existingJob =
        await this.prisma.derivativeGenerationJob.findFirst({
          where: {
            derivativeType,
            sourceDocumentId: documentId,
            status: { in: ['pending', 'running'] },
          },
          select: { id: true },
        });

      if (existingJob) {
        skippedTypes.push(derivativeType);
        continue;
      }

      // Skip if a non-deleted artifact already exists
      const existingArtifact =
        await this.prisma.derivativeArtifact.findFirst({
          where: {
            derivativeType,
            sourceDocumentId: documentId,
            deletedAt: null,
          },
          select: { id: true },
        });

      if (existingArtifact) {
        skippedTypes.push(derivativeType);
        continue;
      }

      const job = await this.prisma.derivativeGenerationJob.create({
        data: {
          derivativeType,
          triggerType: 'auto_publish',
          sourceDocumentId: documentId,
          status: 'pending',
          triggeredByUserId: null,
        },
      });

      enqueuedTypes.push(derivativeType);
      jobIds.push(job.id);
    }

    await this.audit.log({
      actorType: 'system',
      action: 'document.auto_enqueue_derivatives',
      entityType: 'legal_document',
      entityId: documentId,
      metadata: {
        actor_label: 'auto_publish',
        enqueuedTypes,
        skippedTypes,
        jobIds,
      },
    });

    if (enqueuedTypes.length > 0) {
      this.logger.log(
        `Auto-enqueued derivative jobs for document ${documentId}: ${enqueuedTypes.join(', ')}`,
      );
    }
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
