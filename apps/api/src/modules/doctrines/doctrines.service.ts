import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateDoctrineDto,
  CreateDoctrineLinkDto,
  ExtractDoctrinesBatchDto,
  ExtractDoctrinesDto,
  ListDoctrinesQueryDto,
  UpdateDoctrineDto,
} from './dto';

@Injectable()
export class DoctrinesService {
  private readonly logger = new Logger(DoctrinesService.name);

  private readonly ragServiceUrl: string;
  private readonly internalApiKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue('doctrines') private readonly doctrinesQueue: Queue,
  ) {
    this.ragServiceUrl = this.config.get<string>(
      'RAG_SERVICE_URL',
      'http://localhost:8000',
    );
    this.internalApiKey = this.config.get<string>('INTERNAL_API_KEY', '');
  }

  // ---- Doctrine CRUD ----

  async create(dto: CreateDoctrineDto) {
    if (dto.legalDocumentId) {
      const docCount = await this.prisma.legalDocument.count({
        where: { id: dto.legalDocumentId },
      });
      if (docCount === 0) {
        throw new NotFoundException('Legal document not found');
      }
    }

    if (dto.digestId) {
      // CARVE-OUT: digest existence-check spans visibility='public_editorial'; forTenant() would miscount
      const digestCount = await this.prisma.digest.count({
        where: { id: dto.digestId },
      });
      if (digestCount === 0) {
        throw new NotFoundException('Digest not found');
      }
    }

    return this.prisma.doctrineExtract.create({
      data: {
        legalDocumentId: dto.legalDocumentId,
        digestId: dto.digestId,
        sourceSectionId: dto.sourceSectionId,
        text: dto.text.trim(),
        normalizedText: dto.normalizedText?.trim(),
        doctrineType: dto.doctrineType,
        confidence: dto.confidence,
        reviewStatus: 'draft',
      },
      include: {
        legalDocument: {
          select: {
            id: true,
            title: true,
            citationText: true,
            grNo: true,
          },
        },
        digest: {
          select: { id: true, title: true },
        },
      },
    });
  }

  async findById(doctrineId: string) {
    const doctrine = await this.prisma.doctrineExtract.findUnique({
      where: { id: doctrineId },
      include: {
        legalDocument: {
          select: {
            id: true,
            title: true,
            shortTitle: true,
            citationText: true,
            grNo: true,
            court: true,
            decisionDate: true,
            documentType: true,
          },
        },
        digest: {
          select: { id: true, title: true, digestType: true },
        },
        sourceSection: {
          select: {
            id: true,
            sectionType: true,
            sectionLabel: true,
            pageStart: true,
            pageEnd: true,
          },
        },
        linksFrom: {
          include: {
            toDoctrine: {
              select: { id: true, text: true, doctrineType: true, reviewStatus: true },
            },
          },
        },
        linksTo: {
          include: {
            fromDoctrine: {
              select: { id: true, text: true, doctrineType: true, reviewStatus: true },
            },
          },
        },
      },
    });

    if (!doctrine) {
      throw new NotFoundException('Doctrine extract not found');
    }

    return doctrine;
  }

  async list(query: ListDoctrinesQueryDto) {
    const limit = query.limit ?? 20;

    const where: Prisma.DoctrineExtractWhereInput = {};

    if (query.legalDocumentId) {
      where.legalDocumentId = query.legalDocumentId;
    }
    if (query.digestId) {
      where.digestId = query.digestId;
    }
    if (query.doctrineType) {
      where.doctrineType = query.doctrineType;
    }
    if (query.reviewStatus) {
      where.reviewStatus = query.reviewStatus;
    }

    const items = await this.prisma.doctrineExtract.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { createdAt: 'desc' },
      include: {
        legalDocument: {
          select: {
            id: true,
            title: true,
            citationText: true,
            grNo: true,
          },
        },
        digest: {
          select: { id: true, title: true },
        },
        _count: {
          select: { linksFrom: true, linksTo: true },
        },
      },
    });

    const hasNext = items.length > limit;
    const results = hasNext ? items.slice(0, limit) : items;
    const lastItem = results[results.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items: results,
      meta: { hasNext, nextCursor, limit },
    };
  }

  /**
   * List approved doctrines (public access).
   */
  async listApproved(query: ListDoctrinesQueryDto) {
    const limit = query.limit ?? 20;

    const where: Prisma.DoctrineExtractWhereInput = {
      reviewStatus: 'approved',
    };

    if (query.legalDocumentId) {
      where.legalDocumentId = query.legalDocumentId;
    }
    if (query.doctrineType) {
      where.doctrineType = query.doctrineType;
    }

    const items = await this.prisma.doctrineExtract.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { createdAt: 'desc' },
      include: {
        legalDocument: {
          select: {
            id: true,
            title: true,
            citationText: true,
            grNo: true,
            court: true,
            decisionDate: true,
          },
        },
      },
    });

    const hasNext = items.length > limit;
    const results = hasNext ? items.slice(0, limit) : items;
    const lastItem = results[results.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items: results,
      meta: { hasNext, nextCursor, limit },
    };
  }

  async update(doctrineId: string, dto: UpdateDoctrineDto) {
    await this.assertDoctrineExists(doctrineId);

    const data: Prisma.DoctrineExtractUpdateInput = {};
    if (dto.text !== undefined) data.text = dto.text.trim();
    if (dto.normalizedText !== undefined) data.normalizedText = dto.normalizedText.trim();
    if (dto.doctrineType !== undefined) data.doctrineType = dto.doctrineType;
    if (dto.confidence !== undefined) data.confidence = dto.confidence;
    if (dto.reviewStatus !== undefined) data.reviewStatus = dto.reviewStatus;
    if (dto.sourceSectionId !== undefined) {
      data.sourceSection = { connect: { id: dto.sourceSectionId } };
    }

    return this.prisma.doctrineExtract.update({
      where: { id: doctrineId },
      data,
      include: {
        legalDocument: {
          select: { id: true, title: true, citationText: true, grNo: true },
        },
        digest: {
          select: { id: true, title: true },
        },
      },
    });
  }

  async delete(doctrineId: string) {
    await this.assertDoctrineExists(doctrineId);
    await this.prisma.doctrineExtract.delete({ where: { id: doctrineId } });
  }

  // ---- Review Workflow ----

  async approve(doctrineId: string) {
    await this.assertDoctrineExists(doctrineId);

    return this.prisma.doctrineExtract.update({
      where: { id: doctrineId },
      data: { reviewStatus: 'approved' },
    });
  }

  async reject(doctrineId: string) {
    await this.assertDoctrineExists(doctrineId);

    return this.prisma.doctrineExtract.update({
      where: { id: doctrineId },
      data: { reviewStatus: 'rejected' },
    });
  }

  // ---- Extraction Trigger ----

  /**
   * Trigger doctrine extraction for a legal document.
   * Creates a placeholder record in 'draft' status.
   * Actual AI extraction handled by RAG service via internal HTTP.
   */
  async triggerExtraction(dto: ExtractDoctrinesDto) {
    const document = await this.prisma.legalDocument.findUnique({
      where: { id: dto.legalDocumentId },
      select: {
        id: true,
        title: true,
        shortTitle: true,
        citationText: true,
      },
    });

    if (!document) {
      throw new NotFoundException('Legal document not found');
    }

    // Call RAG service to extract doctrines via internal HTTP
    const url = `${this.ragServiceUrl}/doctrines/extract`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.internalApiKey && { 'X-Internal-Api-Key': this.internalApiKey }),
        },
        body: JSON.stringify({
          document_id: document.id,
          strategy: dto.strategy ?? 'auto',
        }),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown extraction error';
      this.logger.error(`Doctrine extraction failed for ${dto.legalDocumentId}: ${message}`);
      throw new BadRequestException(`Doctrine extraction failed: ${message}`);
    }

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Doctrine extraction failed for ${dto.legalDocumentId}: RAG service error ${response.status}: ${body}`);
      throw new BadRequestException(`Doctrine extraction failed: RAG service error ${response.status}: ${body}`);
    }

    const result = (await response.json()) as {
      document_id: string;
      doctrines: {
        text: string;
        normalized_text: string | null;
        doctrine_type: string;
        source_section_id: string | null;
        confidence: number;
      }[];
      model_name: string;
      prompt_template_version: string;
    };

    // Create doctrine records from successful response
    const createdDoctrines = await this.prisma.doctrineExtract.createMany({
      data: result.doctrines.map((d) => ({
        legalDocumentId: document.id,
        text: d.text,
        normalizedText: d.normalized_text,
        doctrineType: d.doctrine_type,
        sourceSectionId: d.source_section_id,
        confidence: d.confidence,
        reviewStatus: d.confidence >= 0.7 ? 'pending_review' : 'needs_human_review',
      })),
    });

    // Record model run for audit per CLAUDE.md
    await this.prisma.modelRun.create({
      data: {
        runType: 'doctrine_extraction',
        modelName: result.model_name,
        promptTemplateVersion: result.prompt_template_version,
        inputRef: `document:${document.id}`,
        outputRef: `doctrines:count=${createdDoctrines.count}`,
        confidence: null,
      },
    });

    this.logger.log(
      `Doctrine extraction completed: documentId=${document.id}, count=${result.doctrines.length}, strategy=${dto.strategy ?? 'auto'}`,
    );

    // Return the first created doctrine with document info
    const firstDoctrine = await this.prisma.doctrineExtract.findFirst({
      where: { legalDocumentId: document.id },
      orderBy: { createdAt: 'desc' },
      include: {
        legalDocument: {
          select: { id: true, title: true, citationText: true, grNo: true },
        },
      },
    });

    return firstDoctrine;
  }

  // ---- Batch Extraction ----

  /**
   * Trigger batch doctrine extraction for multiple documents.
   * Validates all document IDs exist, then enqueues individual extraction jobs.
   */
  async triggerBatchExtraction(dto: ExtractDoctrinesBatchDto, userId: string) {
    // Validate all documents exist
    const documents = await this.prisma.legalDocument.findMany({
      where: { id: { in: dto.legalDocumentIds } },
      select: { id: true, title: true },
    });

    const foundIds = new Set(documents.map((d) => d.id));
    const missingIds = dto.legalDocumentIds.filter((id) => !foundIds.has(id));

    if (missingIds.length > 0) {
      throw new NotFoundException(
        `Legal documents not found: ${missingIds.join(', ')}`,
      );
    }

    const batchId = randomUUID();
    const strategy = dto.strategy ?? 'auto';

    // Enqueue individual extraction jobs
    const jobs = dto.legalDocumentIds.map((docId) => ({
      name: 'extract-doctrines',
      data: {
        legalDocumentId: docId,
        strategy,
        batchId,
        triggeredByUserId: userId,
      },
      opts: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 2,
        backoff: { type: 'exponential' as const, delay: 5000 },
      },
    }));

    await this.doctrinesQueue.addBulk(jobs);

    this.logger.log(
      `Batch doctrine extraction queued: batchId=${batchId}, count=${dto.legalDocumentIds.length}, strategy=${strategy}`,
    );

    return {
      batchId,
      totalDocuments: dto.legalDocumentIds.length,
      strategy,
      status: 'queued',
    };
  }

  // ---- Doctrines for a Document ----

  async findByDocument(documentId: string) {
    const docCount = await this.prisma.legalDocument.count({
      where: { id: documentId },
    });
    if (docCount === 0) {
      throw new NotFoundException('Legal document not found');
    }

    return this.prisma.doctrineExtract.findMany({
      where: { legalDocumentId: documentId },
      orderBy: { createdAt: 'desc' },
      include: {
        digest: {
          select: { id: true, title: true },
        },
        sourceSection: {
          select: {
            id: true,
            sectionType: true,
            sectionLabel: true,
            pageStart: true,
            pageEnd: true,
          },
        },
        _count: {
          select: { linksFrom: true, linksTo: true },
        },
      },
    });
  }

  // ---- Doctrine Links ----

  async createLink(dto: CreateDoctrineLinkDto) {
    // Validate both doctrines exist
    const [fromCount, toCount] = await Promise.all([
      this.prisma.doctrineExtract.count({ where: { id: dto.fromDoctrineId } }),
      this.prisma.doctrineExtract.count({ where: { id: dto.toDoctrineId } }),
    ]);

    if (fromCount === 0) {
      throw new NotFoundException('Source doctrine not found');
    }
    if (toCount === 0) {
      throw new NotFoundException('Target doctrine not found');
    }

    if (dto.fromDoctrineId === dto.toDoctrineId) {
      throw new BadRequestException('Cannot link a doctrine to itself');
    }

    return this.prisma.doctrineLink.create({
      data: {
        fromDoctrineId: dto.fromDoctrineId,
        toDoctrineId: dto.toDoctrineId,
        linkType: dto.linkType,
        confidence: dto.confidence,
      },
      include: {
        fromDoctrine: {
          select: { id: true, text: true, doctrineType: true },
        },
        toDoctrine: {
          select: { id: true, text: true, doctrineType: true },
        },
      },
    });
  }

  async listLinks(doctrineId: string) {
    await this.assertDoctrineExists(doctrineId);

    const [outgoing, incoming] = await Promise.all([
      this.prisma.doctrineLink.findMany({
        where: { fromDoctrineId: doctrineId },
        include: {
          toDoctrine: {
            select: {
              id: true,
              text: true,
              doctrineType: true,
              reviewStatus: true,
              legalDocument: {
                select: { id: true, title: true, citationText: true },
              },
            },
          },
        },
      }),
      this.prisma.doctrineLink.findMany({
        where: { toDoctrineId: doctrineId },
        include: {
          fromDoctrine: {
            select: {
              id: true,
              text: true,
              doctrineType: true,
              reviewStatus: true,
              legalDocument: {
                select: { id: true, title: true, citationText: true },
              },
            },
          },
        },
      }),
    ]);

    return { outgoing, incoming };
  }

  async deleteLink(linkId: string) {
    const count = await this.prisma.doctrineLink.count({ where: { id: linkId } });
    if (count === 0) {
      throw new NotFoundException('Doctrine link not found');
    }

    await this.prisma.doctrineLink.delete({ where: { id: linkId } });
  }

  // ---- Helpers ----

  private async assertDoctrineExists(id: string): Promise<void> {
    const count = await this.prisma.doctrineExtract.count({ where: { id } });
    if (count === 0) {
      throw new NotFoundException('Doctrine extract not found');
    }
  }
}
