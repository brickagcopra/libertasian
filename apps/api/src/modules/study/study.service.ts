import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateFlashcardSetDto,
  UpdateFlashcardSetDto,
  ListFlashcardSetsQueryDto,
  CreateFlashcardDto,
  UpdateFlashcardDto,
  GenerateAiFlashcardsDto,
  CreateReviewerPackDto,
  UpdateReviewerPackDto,
  ListReviewerPacksQueryDto,
  AddReviewerPackItemDto,
  UpdateReviewerPackItemDto,
  UpsertStudyProgressDto,
  ListCodalsBySubjectQueryDto,
  SubmitFlashcardReviewDto,
  StartStudySessionDto,
  EndStudySessionDto,
  ListSyllabiQueryDto,
  CreateSyllabusTopicDto,
  UpdateSyllabusTopicDto,
  AddSyllabusTopicResourceDto,
  SyllabusTopicProgressDto,
} from './dto';

interface RagFlashcardResponse {
  flashcards: {
    front: string;
    back: string;
    source_document_id: string | null;
    source_section_id: string | null;
    difficulty: string;
  }[];
  total_generated: number;
  topic: string;
  card_type: string;
  confidence_score: number;
  model_name: string;
  prompt_template_version: string;
}

@Injectable()
export class StudyService {
  private readonly logger = new Logger(StudyService.name);
  private readonly ragServiceUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.ragServiceUrl = this.config.get<string>('RAG_SERVICE_URL', 'http://localhost:8000');
  }

  // =========================================================================
  // Codal Reader
  // =========================================================================

  /**
   * List all bar subjects with document counts.
   * Uses LegalMetadataTag with tagType='bar_subject' joined to documents.
   */
  async listBarSubjects() {
    const tags = await this.prisma.legalMetadataTag.findMany({
      where: { tagType: 'bar_subject' },
      include: {
        _count: { select: { documentTags: true } },
      },
      orderBy: { name: 'asc' },
    });

    return tags.map((tag) => ({
      code: tag.code,
      name: tag.name,
      documentCount: tag._count.documentTags,
    }));
  }

  /**
   * List codals/statutes by bar subject with cursor pagination.
   * Joins through LegalDocumentTagMap → LegalMetadataTag.
   */
  async listCodalsBySubject(subject: string, query: ListCodalsBySubjectQueryDto) {
    const limit = query.limit ?? 20;

    // Verify the bar subject exists
    const tag = await this.prisma.legalMetadataTag.findFirst({
      where: { code: subject, tagType: 'bar_subject' },
    });
    if (!tag) {
      throw new NotFoundException(`Bar subject '${subject}' not found`);
    }

    const where: Prisma.LegalDocumentWhereInput = {
      tagMaps: { some: { tagId: tag.id } },
      isPublished: true,
      status: 'published',
    };

    if (query.documentType) {
      where.documentType = query.documentType;
    }

    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { shortTitle: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const documents = await this.prisma.legalDocument.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { title: 'asc' },
      select: {
        id: true,
        title: true,
        shortTitle: true,
        documentType: true,
        citationText: true,
        promulgationDate: true,
        isOfficial: true,
        _count: { select: { sections: true } },
      },
    });

    const hasNext = documents.length > limit;
    const items = hasNext ? documents.slice(0, limit) : documents;
    const lastItem = items[items.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items,
      meta: { hasNext, nextCursor, limit, subject: tag.name },
    };
  }

  // =========================================================================
  // Flashcard Sets
  // =========================================================================

  async createFlashcardSet(dto: CreateFlashcardSetDto, userId: string, organizationId: string) {
    return this.prisma.flashcardSet.create({
      data: {
        organizationId,
        userId,
        title: dto.title.trim(),
        description: dto.description?.trim(),
        barSubject: dto.barSubject,
        topic: dto.topic?.trim(),
        visibility: dto.visibility ?? 'private',
      },
    });
  }

  async listFlashcardSets(userId: string, organizationId: string, query: ListFlashcardSetsQueryDto) {
    const limit = query.limit ?? 20;

    const where: Prisma.FlashcardSetWhereInput = {
      OR: [
        { userId, visibility: 'private' },
        { organizationId, visibility: 'org' },
        { visibility: 'public_editorial' },
      ],
    };

    if (query.barSubject) {
      where.barSubject = query.barSubject;
    }
    if (query.visibility) {
      where.visibility = query.visibility;
    }

    const sets = await this.prisma.flashcardSet.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { flashcards: true } },
      },
    });

    const hasNext = sets.length > limit;
    const items = hasNext ? sets.slice(0, limit) : sets;
    const lastItem = items[items.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items,
      meta: { hasNext, nextCursor, limit },
    };
  }

  async getFlashcardSet(id: string, userId: string, organizationId: string) {
    const set = await this.prisma.flashcardSet.findUnique({
      where: { id },
      include: {
        _count: { select: { flashcards: true } },
      },
    });

    if (!set) {
      throw new NotFoundException('Flashcard set not found');
    }

    this.assertAccess(
      { userId: set.userId, organizationId: set.organizationId, visibility: set.visibility },
      userId,
      organizationId,
    );

    return set;
  }

  async updateFlashcardSet(
    id: string,
    dto: UpdateFlashcardSetDto,
    userId: string,
    organizationId: string,
  ) {
    const set = await this.prisma.flashcardSet.findUnique({ where: { id } });
    if (!set) {
      throw new NotFoundException('Flashcard set not found');
    }

    this.assertAccess(
      { userId: set.userId, organizationId: set.organizationId, visibility: set.visibility },
      userId,
      organizationId,
    );

    if (set.userId !== userId) {
      throw new ForbiddenException('Only the set creator can update it');
    }

    const data: Prisma.FlashcardSetUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) data.description = dto.description.trim();
    if (dto.barSubject !== undefined) data.barSubject = dto.barSubject;
    if (dto.topic !== undefined) data.topic = dto.topic.trim();
    if (dto.visibility !== undefined) data.visibility = dto.visibility;

    return this.prisma.flashcardSet.update({
      where: { id },
      data,
    });
  }

  async deleteFlashcardSet(id: string, userId: string, organizationId: string) {
    const set = await this.prisma.flashcardSet.findUnique({ where: { id } });
    if (!set) {
      throw new NotFoundException('Flashcard set not found');
    }

    this.assertAccess(
      { userId: set.userId, organizationId: set.organizationId, visibility: set.visibility },
      userId,
      organizationId,
    );

    if (set.userId !== userId) {
      throw new ForbiddenException('Only the set creator can delete it');
    }

    await this.prisma.flashcardSet.delete({ where: { id } });
  }

  // =========================================================================
  // Flashcards
  // =========================================================================

  async addFlashcard(setId: string, dto: CreateFlashcardDto, userId: string, organizationId: string) {
    // Verify set ownership
    const set = await this.prisma.flashcardSet.findUnique({ where: { id: setId } });
    if (!set) {
      throw new NotFoundException('Flashcard set not found');
    }
    if (set.userId !== userId) {
      throw new ForbiddenException('Only the set creator can add flashcards');
    }

    const [card] = await this.prisma.$transaction([
      this.prisma.flashcard.create({
        data: {
          flashcardSetId: setId,
          front: dto.front.trim(),
          back: dto.back.trim(),
          legalDocumentId: dto.legalDocumentId,
          sectionId: dto.sectionId,
          digestId: dto.digestId,
          sourceType: dto.sourceType ?? 'manual',
          ordering: dto.ordering ?? 0,
        },
      }),
      this.prisma.flashcardSet.update({
        where: { id: setId },
        data: { cardCount: { increment: 1 } },
      }),
    ]);

    return card;
  }

  async listFlashcards(setId: string, userId: string, organizationId: string) {
    // Verify access to the set
    await this.getFlashcardSet(setId, userId, organizationId);

    return this.prisma.flashcard.findMany({
      where: { flashcardSetId: setId },
      orderBy: { ordering: 'asc' },
      include: {
        legalDocument: {
          select: { id: true, title: true, shortTitle: true, citationText: true },
        },
        digest: {
          select: { id: true, title: true },
        },
      },
    });
  }

  async updateFlashcard(id: string, dto: UpdateFlashcardDto, userId: string) {
    const card = await this.prisma.flashcard.findUnique({
      where: { id },
      include: { flashcardSet: { select: { userId: true } } },
    });

    if (!card) {
      throw new NotFoundException('Flashcard not found');
    }
    if (card.flashcardSet.userId !== userId) {
      throw new ForbiddenException('Only the set creator can update flashcards');
    }

    const data: Prisma.FlashcardUpdateInput = {};
    if (dto.front !== undefined) data.front = dto.front.trim();
    if (dto.back !== undefined) data.back = dto.back.trim();
    if (dto.ordering !== undefined) data.ordering = dto.ordering;

    return this.prisma.flashcard.update({ where: { id }, data });
  }

  async deleteFlashcard(id: string, userId: string) {
    const card = await this.prisma.flashcard.findUnique({
      where: { id },
      include: { flashcardSet: { select: { id: true, userId: true } } },
    });

    if (!card) {
      throw new NotFoundException('Flashcard not found');
    }
    if (card.flashcardSet.userId !== userId) {
      throw new ForbiddenException('Only the set creator can delete flashcards');
    }

    await this.prisma.$transaction([
      this.prisma.flashcard.delete({ where: { id } }),
      this.prisma.flashcardSet.update({
        where: { id: card.flashcardSetId },
        data: { cardCount: { decrement: 1 } },
      }),
    ]);
  }

  // =========================================================================
  // AI Flashcard Generation (RAG Service Integration)
  // =========================================================================

  /**
   * Call the RAG service to generate AI flashcards and save them to a flashcard set.
   * The RAG service retrieves relevant legal content from OpenSearch, builds context,
   * and generates structured flashcards via vLLM.
   */
  async generateAiFlashcards(
    setId: string,
    dto: GenerateAiFlashcardsDto,
    userId: string,
    organizationId: string,
  ) {
    // Verify set ownership
    const set = await this.prisma.flashcardSet.findUnique({ where: { id: setId } });
    if (!set) {
      throw new NotFoundException('Flashcard set not found');
    }
    if (set.userId !== userId) {
      throw new ForbiddenException('Only the set creator can generate AI flashcards');
    }

    // Call RAG service
    const ragResponse = await this.callRagFlashcardService(dto);

    if (ragResponse.flashcards.length === 0) {
      return {
        generatedCount: 0,
        flashcards: [],
        confidenceScore: ragResponse.confidence_score,
        modelName: ragResponse.model_name,
      };
    }

    // Save generated flashcards to the set in a transaction
    const currentMaxOrder = await this.prisma.flashcard.aggregate({
      where: { flashcardSetId: setId },
      _max: { ordering: true },
    });
    const startOrder = (currentMaxOrder._max.ordering ?? -1) + 1;

    const createdCards = await this.prisma.$transaction(
      ragResponse.flashcards.map((card, index) =>
        this.prisma.flashcard.create({
          data: {
            flashcardSetId: setId,
            front: card.front,
            back: card.back,
            legalDocumentId: card.source_document_id || undefined,
            sectionId: card.source_section_id || undefined,
            sourceType: 'ai_generated',
            ordering: startOrder + index,
          },
        }),
      ),
    );

    // Update card count on the set
    await this.prisma.flashcardSet.update({
      where: { id: setId },
      data: { cardCount: { increment: createdCards.length } },
    });

    return {
      generatedCount: createdCards.length,
      flashcards: createdCards,
      confidenceScore: ragResponse.confidence_score,
      modelName: ragResponse.model_name,
    };
  }

  private async callRagFlashcardService(dto: GenerateAiFlashcardsDto): Promise<RagFlashcardResponse> {
    const url = `${this.ragServiceUrl}/flashcards/generate`;

    const body = {
      topic: dto.topic,
      card_type: dto.cardType ?? 'mixed',
      count: dto.count ?? 10,
      bar_subject: dto.barSubject ?? null,
      context_document_ids: dto.contextDocumentIds ?? [],
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        this.logger.error(`RAG flashcard service error: ${response.status} — ${errorText}`);
        throw new BadRequestException(
          `AI flashcard generation failed (status ${response.status}). Please try again.`,
        );
      }

      return (await response.json()) as RagFlashcardResponse;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`RAG flashcard service unreachable: ${String(error)}`);
      throw new BadRequestException(
        'AI flashcard generation service is currently unavailable. Please try again later.',
      );
    }
  }

  // =========================================================================
  // Reviewer Packs
  // =========================================================================

  async createReviewerPack(dto: CreateReviewerPackDto, userId: string, organizationId: string) {
    return this.prisma.reviewerPack.create({
      data: {
        organizationId,
        creatorUserId: userId,
        title: dto.title.trim(),
        description: dto.description?.trim(),
        barSubject: dto.barSubject,
        topic: dto.topic?.trim(),
        visibility: dto.visibility ?? 'private',
      },
    });
  }

  async listReviewerPacks(userId: string, organizationId: string, query: ListReviewerPacksQueryDto) {
    const limit = query.limit ?? 20;

    const where: Prisma.ReviewerPackWhereInput = {
      OR: [
        { creatorUserId: userId, visibility: 'private' },
        { organizationId, visibility: 'org' },
        { visibility: 'public_editorial' },
      ],
    };

    if (query.barSubject) {
      where.barSubject = query.barSubject;
    }
    if (query.visibility) {
      where.visibility = query.visibility;
    }

    const packs = await this.prisma.reviewerPack.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { items: true } },
        creator: { select: { id: true, fullName: true } },
      },
    });

    const hasNext = packs.length > limit;
    const items = hasNext ? packs.slice(0, limit) : packs;
    const lastItem = items[items.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items,
      meta: { hasNext, nextCursor, limit },
    };
  }

  async getReviewerPack(id: string, userId: string, organizationId: string) {
    const pack = await this.prisma.reviewerPack.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, fullName: true } },
        items: {
          orderBy: { ordering: 'asc' },
          include: {
            legalDocument: {
              select: {
                id: true,
                title: true,
                shortTitle: true,
                citationText: true,
                documentType: true,
              },
            },
            digest: {
              select: { id: true, title: true, digestType: true },
            },
            section: {
              select: { id: true, sectionLabel: true, sectionType: true },
            },
          },
        },
        _count: { select: { items: true } },
      },
    });

    if (!pack) {
      throw new NotFoundException('Reviewer pack not found');
    }

    this.assertAccess(
      {
        userId: pack.creatorUserId,
        organizationId: pack.organizationId,
        visibility: pack.visibility,
      },
      userId,
      organizationId,
    );

    return pack;
  }

  async updateReviewerPack(
    id: string,
    dto: UpdateReviewerPackDto,
    userId: string,
    organizationId: string,
  ) {
    const pack = await this.prisma.reviewerPack.findUnique({ where: { id } });
    if (!pack) {
      throw new NotFoundException('Reviewer pack not found');
    }

    this.assertAccess(
      {
        userId: pack.creatorUserId,
        organizationId: pack.organizationId,
        visibility: pack.visibility,
      },
      userId,
      organizationId,
    );

    if (pack.creatorUserId !== userId) {
      throw new ForbiddenException('Only the pack creator can update it');
    }

    const data: Prisma.ReviewerPackUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) data.description = dto.description.trim();
    if (dto.barSubject !== undefined) data.barSubject = dto.barSubject;
    if (dto.topic !== undefined) data.topic = dto.topic.trim();
    if (dto.visibility !== undefined) data.visibility = dto.visibility;

    return this.prisma.reviewerPack.update({ where: { id }, data });
  }

  async deleteReviewerPack(id: string, userId: string, organizationId: string) {
    const pack = await this.prisma.reviewerPack.findUnique({ where: { id } });
    if (!pack) {
      throw new NotFoundException('Reviewer pack not found');
    }

    this.assertAccess(
      {
        userId: pack.creatorUserId,
        organizationId: pack.organizationId,
        visibility: pack.visibility,
      },
      userId,
      organizationId,
    );

    if (pack.creatorUserId !== userId) {
      throw new ForbiddenException('Only the pack creator can delete it');
    }

    await this.prisma.reviewerPack.delete({ where: { id } });
  }

  // =========================================================================
  // Reviewer Pack Items
  // =========================================================================

  async addReviewerPackItem(
    packId: string,
    dto: AddReviewerPackItemDto,
    userId: string,
    organizationId: string,
  ) {
    const pack = await this.prisma.reviewerPack.findUnique({ where: { id: packId } });
    if (!pack) {
      throw new NotFoundException('Reviewer pack not found');
    }
    if (pack.creatorUserId !== userId) {
      throw new ForbiddenException('Only the pack creator can add items');
    }

    // Validate item reference exists
    await this.validateItemReference(dto);

    const [item] = await this.prisma.$transaction([
      this.prisma.reviewerPackItem.create({
        data: {
          reviewerPackId: packId,
          itemType: dto.itemType,
          legalDocumentId: dto.legalDocumentId,
          digestId: dto.digestId,
          sectionId: dto.sectionId,
          ordering: dto.ordering ?? 0,
          note: dto.note?.trim(),
        },
        include: {
          legalDocument: {
            select: { id: true, title: true, shortTitle: true, citationText: true },
          },
          digest: {
            select: { id: true, title: true },
          },
          section: {
            select: { id: true, sectionLabel: true, sectionType: true },
          },
        },
      }),
      this.prisma.reviewerPack.update({
        where: { id: packId },
        data: { itemCount: { increment: 1 } },
      }),
    ]);

    return item;
  }

  async updateReviewerPackItem(id: string, dto: UpdateReviewerPackItemDto, userId: string) {
    const item = await this.prisma.reviewerPackItem.findUnique({
      where: { id },
      include: { reviewerPack: { select: { creatorUserId: true } } },
    });

    if (!item) {
      throw new NotFoundException('Reviewer pack item not found');
    }
    if (item.reviewerPack.creatorUserId !== userId) {
      throw new ForbiddenException('Only the pack creator can update items');
    }

    const data: Prisma.ReviewerPackItemUpdateInput = {};
    if (dto.ordering !== undefined) data.ordering = dto.ordering;
    if (dto.note !== undefined) data.note = dto.note.trim();

    return this.prisma.reviewerPackItem.update({ where: { id }, data });
  }

  async deleteReviewerPackItem(id: string, userId: string) {
    const item = await this.prisma.reviewerPackItem.findUnique({
      where: { id },
      include: { reviewerPack: { select: { id: true, creatorUserId: true } } },
    });

    if (!item) {
      throw new NotFoundException('Reviewer pack item not found');
    }
    if (item.reviewerPack.creatorUserId !== userId) {
      throw new ForbiddenException('Only the pack creator can delete items');
    }

    await this.prisma.$transaction([
      this.prisma.reviewerPackItem.delete({ where: { id } }),
      this.prisma.reviewerPack.update({
        where: { id: item.reviewerPackId },
        data: { itemCount: { decrement: 1 } },
      }),
    ]);
  }

  // =========================================================================
  // Study Progress
  // =========================================================================

  async upsertProgress(
    userId: string,
    entityType: string,
    entityId: string,
    dto: UpsertStudyProgressDto,
  ) {
    const now = new Date();
    const completedAt = dto.status === 'completed' ? now : null;

    return this.prisma.studyProgress.upsert({
      where: {
        userId_entityType_entityId: { userId, entityType, entityId },
      },
      create: {
        userId,
        entityType,
        entityId,
        status: dto.status,
        progressPct: dto.progressPct ?? 0,
        lastAccessedAt: now,
        completedAt,
        metadataJson: (dto.metadataJson ?? {}) as Prisma.InputJsonValue,
      },
      update: {
        status: dto.status,
        progressPct: dto.progressPct ?? undefined,
        lastAccessedAt: now,
        completedAt,
        metadataJson: dto.metadataJson
          ? (dto.metadataJson as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }

  async listProgress(userId: string) {
    return this.prisma.studyProgress.findMany({
      where: { userId },
      orderBy: { lastAccessedAt: 'desc' },
    });
  }

  async getProgress(userId: string, entityType: string, entityId: string) {
    const progress = await this.prisma.studyProgress.findUnique({
      where: {
        userId_entityType_entityId: { userId, entityType, entityId },
      },
    });

    if (!progress) {
      throw new NotFoundException('Study progress not found');
    }

    return progress;
  }

  // =========================================================================
  // Syllabus Mode (Bar Topic Study Path)
  // =========================================================================

  /**
   * List all bar syllabi, optionally filtered to active-only.
   */
  async listSyllabi(query: ListSyllabiQueryDto) {
    const where = query.activeOnly !== false ? { isActive: true } : {};
    return this.prisma.barSyllabus.findMany({
      where,
      orderBy: { ordering: 'asc' },
      include: {
        _count: { select: { topics: true } },
      },
    });
  }

  /**
   * Get a single syllabus by ID with its full topic tree.
   */
  async getSyllabus(id: string) {
    const syllabus = await this.prisma.barSyllabus.findUnique({
      where: { id },
      include: {
        topics: {
          orderBy: { ordering: 'asc' },
          include: {
            _count: { select: { resources: true, children: true } },
          },
        },
      },
    });

    if (!syllabus) {
      throw new NotFoundException('Syllabus not found');
    }

    return syllabus;
  }

  /**
   * Get a syllabus by bar subject code.
   */
  async getSyllabusBySubject(code: string) {
    const syllabus = await this.prisma.barSyllabus.findUnique({
      where: { barSubjectCode: code },
      include: {
        topics: {
          orderBy: { ordering: 'asc' },
          include: {
            _count: { select: { resources: true, children: true } },
          },
        },
      },
    });

    if (!syllabus) {
      throw new NotFoundException(`Syllabus for subject '${code}' not found`);
    }

    return syllabus;
  }

  /**
   * Get a single syllabus topic with its resources.
   */
  async getSyllabusTopic(syllabusId: string, topicId: string) {
    const topic = await this.prisma.syllabusTopic.findFirst({
      where: { id: topicId, syllabusId },
      include: {
        resources: { orderBy: { ordering: 'asc' } },
        children: {
          orderBy: { ordering: 'asc' },
          include: {
            _count: { select: { resources: true, children: true } },
          },
        },
        parent: { select: { id: true, title: true, slug: true } },
      },
    });

    if (!topic) {
      throw new NotFoundException('Syllabus topic not found');
    }

    return topic;
  }

  /**
   * Get user progress for all topics in a syllabus.
   */
  async getSyllabusProgress(syllabusId: string, userId: string) {
    // Get all topic IDs for this syllabus
    const topics = await this.prisma.syllabusTopic.findMany({
      where: { syllabusId },
      select: { id: true, parentTopicId: true, depth: true },
    });

    const topicIds = topics.map((t) => t.id);

    // Get progress records for all syllabus topics
    const progressRecords = await this.prisma.studyProgress.findMany({
      where: {
        userId,
        entityType: 'syllabus_topic',
        entityId: { in: topicIds },
      },
    });

    const totalTopics = topicIds.length;
    const completedCount = progressRecords.filter(
      (p) => p.status === 'completed',
    ).length;
    const inProgressCount = progressRecords.filter(
      (p) => p.status === 'in_progress',
    ).length;
    const overallPct = totalTopics > 0 ? Math.round((completedCount / totalTopics) * 100) : 0;

    return {
      syllabusId,
      totalTopics,
      completedCount,
      inProgressCount,
      notStartedCount: totalTopics - completedCount - inProgressCount,
      overallPct,
      topicProgress: progressRecords.reduce(
        (acc, p) => ({ ...acc, [p.entityId]: { status: p.status, progressPct: p.progressPct } }),
        {} as Record<string, { status: string; progressPct: number }>,
      ),
    };
  }

  /**
   * Upsert progress for a syllabus topic. Reuses StudyProgress with entityType 'syllabus_topic'.
   */
  async upsertSyllabusTopicProgress(
    topicId: string,
    dto: SyllabusTopicProgressDto,
    userId: string,
  ) {
    // Verify topic exists
    const topic = await this.prisma.syllabusTopic.findUnique({
      where: { id: topicId },
    });
    if (!topic) {
      throw new NotFoundException('Syllabus topic not found');
    }

    return this.upsertProgress(userId, 'syllabus_topic', topicId, {
      status: dto.status as 'not_started' | 'in_progress' | 'completed',
      progressPct: dto.progressPct,
    });
  }

  /**
   * Compute the overall "Bar Exam Readiness" score across all syllabi.
   */
  async getBarExamReadiness(userId: string) {
    const syllabi = await this.prisma.barSyllabus.findMany({
      where: { isActive: true },
      orderBy: { ordering: 'asc' },
      include: {
        _count: { select: { topics: true } },
      },
    });

    // Get all topic IDs across all syllabi
    const allTopics = await this.prisma.syllabusTopic.findMany({
      where: { syllabusId: { in: syllabi.map((s) => s.id) } },
      select: { id: true, syllabusId: true },
    });

    const allTopicIds = allTopics.map((t) => t.id);

    // Get all progress at once
    const allProgress = await this.prisma.studyProgress.findMany({
      where: {
        userId,
        entityType: 'syllabus_topic',
        entityId: { in: allTopicIds },
      },
    });

    const progressMap = new Map(allProgress.map((p) => [p.entityId, p]));

    const subjects = syllabi.map((syllabus) => {
      const syllabusTopicIds = allTopics
        .filter((t) => t.syllabusId === syllabus.id)
        .map((t) => t.id);
      const total = syllabusTopicIds.length;
      const completed = syllabusTopicIds.filter(
        (id) => progressMap.get(id)?.status === 'completed',
      ).length;
      return {
        barSubjectCode: syllabus.barSubjectCode,
        title: syllabus.title,
        totalTopics: total,
        completedTopics: completed,
        pct: total > 0 ? Math.round((completed / total) * 100) : 0,
      };
    });

    const totalAll = subjects.reduce((sum, s) => sum + s.totalTopics, 0);
    const completedAll = subjects.reduce((sum, s) => sum + s.completedTopics, 0);
    const overallPct = totalAll > 0 ? Math.round((completedAll / totalAll) * 100) : 0;

    return {
      overallPct,
      totalTopics: totalAll,
      completedTopics: completedAll,
      subjects,
    };
  }

  // =========================================================================
  // Syllabus Admin CRUD
  // =========================================================================

  async createSyllabusTopic(dto: CreateSyllabusTopicDto) {
    // Verify syllabus exists
    const syllabus = await this.prisma.barSyllabus.findUnique({
      where: { id: dto.syllabusId },
    });
    if (!syllabus) {
      throw new NotFoundException('Syllabus not found');
    }

    // Verify parent topic exists if provided
    if (dto.parentTopicId) {
      const parent = await this.prisma.syllabusTopic.findFirst({
        where: { id: dto.parentTopicId, syllabusId: dto.syllabusId },
      });
      if (!parent) {
        throw new NotFoundException('Parent topic not found in this syllabus');
      }
    }

    const topic = await this.prisma.syllabusTopic.create({
      data: {
        syllabusId: dto.syllabusId,
        parentTopicId: dto.parentTopicId,
        slug: dto.slug.trim(),
        title: dto.title.trim(),
        description: dto.description?.trim(),
        depth: dto.depth ?? 0,
        ordering: dto.ordering ?? 0,
      },
    });

    // Update topic count on the syllabus
    await this.prisma.barSyllabus.update({
      where: { id: dto.syllabusId },
      data: { topicCount: { increment: 1 } },
    });

    return topic;
  }

  async updateSyllabusTopic(id: string, dto: UpdateSyllabusTopicDto) {
    const topic = await this.prisma.syllabusTopic.findUnique({ where: { id } });
    if (!topic) {
      throw new NotFoundException('Syllabus topic not found');
    }

    const data: Prisma.SyllabusTopicUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) data.description = dto.description.trim();
    if (dto.ordering !== undefined) data.ordering = dto.ordering;

    return this.prisma.syllabusTopic.update({ where: { id }, data });
  }

  async deleteSyllabusTopic(id: string) {
    const topic = await this.prisma.syllabusTopic.findUnique({ where: { id } });
    if (!topic) {
      throw new NotFoundException('Syllabus topic not found');
    }

    await this.prisma.syllabusTopic.delete({ where: { id } });

    // Decrement topic count on the syllabus
    await this.prisma.barSyllabus.update({
      where: { id: topic.syllabusId },
      data: { topicCount: { decrement: 1 } },
    });
  }

  async addSyllabusTopicResource(topicId: string, dto: AddSyllabusTopicResourceDto) {
    const topic = await this.prisma.syllabusTopic.findUnique({ where: { id: topicId } });
    if (!topic) {
      throw new NotFoundException('Syllabus topic not found');
    }

    // Validate the resource reference exists
    await this.validateResourceReference(dto.resourceType, dto.resourceId);

    return this.prisma.syllabusTopicResource.create({
      data: {
        topicId,
        resourceType: dto.resourceType,
        resourceId: dto.resourceId,
        title: dto.title?.trim(),
        note: dto.note?.trim(),
        ordering: dto.ordering ?? 0,
      },
    });
  }

  async removeSyllabusTopicResource(id: string) {
    const resource = await this.prisma.syllabusTopicResource.findUnique({
      where: { id },
    });
    if (!resource) {
      throw new NotFoundException('Syllabus topic resource not found');
    }

    await this.prisma.syllabusTopicResource.delete({ where: { id } });
  }

  /**
   * Validate that a resource reference exists in the appropriate table.
   */
  private async validateResourceReference(resourceType: string, resourceId: string) {
    let count = 0;
    switch (resourceType) {
      case 'legal_document':
        count = await this.prisma.legalDocument.count({ where: { id: resourceId } });
        break;
      case 'digest':
        count = await this.prisma.digest.count({ where: { id: resourceId } });
        break;
      case 'flashcard_set':
        count = await this.prisma.flashcardSet.count({ where: { id: resourceId } });
        break;
      case 'reviewer_pack':
        count = await this.prisma.reviewerPack.count({ where: { id: resourceId } });
        break;
      case 'codal_section':
        count = await this.prisma.legalDocumentSection.count({ where: { id: resourceId } });
        break;
      default:
        throw new BadRequestException(`Unknown resource type '${resourceType}'`);
    }
    if (count === 0) {
      throw new NotFoundException(`Referenced ${resourceType.replace(/_/g, ' ')} not found`);
    }
  }

  // =========================================================================
  // Flashcard Reviews (Spaced Repetition)
  // =========================================================================

  /**
   * Submit a flashcard review using SM-2 algorithm variant.
   * Updates the card's spaced repetition state (interval, ease factor).
   */
  async submitFlashcardReview(
    flashcardId: string,
    dto: SubmitFlashcardReviewDto,
    userId: string,
  ) {
    // Verify flashcard exists and user has access
    const card = await this.prisma.flashcard.findUnique({
      where: { id: flashcardId },
      include: { flashcardSet: { select: { userId: true, organizationId: true, visibility: true } } },
    });
    if (!card) {
      throw new NotFoundException('Flashcard not found');
    }

    // Get the last review to compute next interval
    const lastReview = await this.prisma.flashcardReview.findFirst({
      where: { flashcardId, userId },
      orderBy: { reviewedAt: 'desc' },
    });

    // SM-2 variant: compute new interval and ease factor
    const prevEase = lastReview?.easeFactor ?? 2.5;
    const prevInterval = lastReview?.interval ?? 0;
    const { interval, easeFactor } = this.computeSpacedRepetition(
      dto.response,
      prevInterval,
      prevEase,
    );

    // Create review record
    const review = await this.prisma.flashcardReview.create({
      data: {
        flashcardId,
        userId,
        response: dto.response,
        confidence: dto.confidence ?? 3,
        interval,
        easeFactor,
      },
    });

    // Update study streak
    await this.updateStudyStreak(userId);

    return review;
  }

  /**
   * Get flashcard review history for a set (user's reviews).
   */
  async getFlashcardReviewStats(
    flashcardSetId: string,
    userId: string,
  ) {
    const reviews = await this.prisma.flashcardReview.groupBy({
      by: ['response'],
      where: {
        flashcard: { flashcardSetId },
        userId,
      },
      _count: { response: true },
    });

    const totalReviews = await this.prisma.flashcardReview.count({
      where: {
        flashcard: { flashcardSetId },
        userId,
      },
    });

    const dueCards = await this.prisma.flashcardReview.findMany({
      where: {
        flashcard: { flashcardSetId },
        userId,
      },
      orderBy: { reviewedAt: 'desc' },
      distinct: ['flashcardId'],
      select: {
        flashcardId: true,
        interval: true,
        reviewedAt: true,
      },
    });

    const now = new Date();
    const dueCount = dueCards.filter((r) => {
      const nextDue = new Date(r.reviewedAt);
      nextDue.setDate(nextDue.getDate() + r.interval);
      return nextDue <= now;
    }).length;

    return {
      totalReviews,
      responseBreakdown: reviews.reduce(
        (acc, r) => ({ ...acc, [r.response]: r._count.response }),
        {} as Record<string, number>,
      ),
      dueCount,
    };
  }

  // =========================================================================
  // Study Sessions
  // =========================================================================

  /**
   * Start a study session. Returns the session ID for later completion.
   */
  async startStudySession(dto: StartStudySessionDto, userId: string) {
    const session = await this.prisma.studySession.create({
      data: {
        userId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        barSubject: dto.barSubject,
      },
    });

    return session;
  }

  /**
   * End a study session by recording duration and items studied.
   */
  async endStudySession(
    sessionId: string,
    dto: EndStudySessionDto,
    userId: string,
  ) {
    const session = await this.prisma.studySession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Study session not found');
    }
    if (session.endedAt) {
      throw new BadRequestException('Session already ended');
    }

    const now = new Date();
    const durationSecs = Math.floor(
      (now.getTime() - session.startedAt.getTime()) / 1000,
    );

    const updated = await this.prisma.studySession.update({
      where: { id: sessionId },
      data: {
        endedAt: now,
        durationSecs,
        itemsStudied: dto.itemsStudied ?? 0,
        itemsCorrect: dto.itemsCorrect ?? 0,
      },
    });

    // Update study streak
    await this.updateStudyStreak(userId);

    return updated;
  }

  /**
   * Get study session statistics for a user.
   */
  async getStudyStats(userId: string) {
    const streak = await this.prisma.studyStreak.findUnique({
      where: { userId },
    });

    const totalSessions = await this.prisma.studySession.count({
      where: { userId, endedAt: { not: null } },
    });

    const totalTime = await this.prisma.studySession.aggregate({
      where: { userId, endedAt: { not: null } },
      _sum: { durationSecs: true },
    });

    const subjectBreakdown = await this.prisma.studySession.groupBy({
      by: ['barSubject'],
      where: { userId, endedAt: { not: null }, barSubject: { not: null } },
      _sum: { durationSecs: true },
      _count: { id: true },
    });

    return {
      streak: {
        current: streak?.currentStreak ?? 0,
        longest: streak?.longestStreak ?? 0,
        totalStudyDays: streak?.totalStudyDays ?? 0,
        lastStudyDate: streak?.lastStudyDate ?? null,
      },
      totalSessions,
      totalStudyTimeSecs: totalTime._sum.durationSecs ?? 0,
      subjectBreakdown: subjectBreakdown.map((s) => ({
        barSubject: s.barSubject,
        totalTimeSecs: s._sum.durationSecs ?? 0,
        sessionCount: s._count.id,
      })),
    };
  }

  // =========================================================================
  // Study Streak (private helper)
  // =========================================================================

  /**
   * Update the user's study streak. Called after reviews and session completions.
   */
  private async updateStudyStreak(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    const existing = await this.prisma.studyStreak.findUnique({
      where: { userId },
    });

    if (!existing) {
      await this.prisma.studyStreak.create({
        data: {
          userId,
          currentStreak: 1,
          longestStreak: 1,
          totalStudyDays: 1,
          lastStudyDate: today,
        },
      });
      return;
    }

    const lastDateStr = existing.lastStudyDate
      ? new Date(existing.lastStudyDate).toISOString().split('T')[0]
      : null;

    if (lastDateStr === todayStr) {
      // Already studied today — no streak change
      return;
    }

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    let newStreak: number;
    if (lastDateStr === yesterdayStr) {
      // Consecutive day — increment streak
      newStreak = existing.currentStreak + 1;
    } else {
      // Streak broken — reset to 1
      newStreak = 1;
    }

    await this.prisma.studyStreak.update({
      where: { userId },
      data: {
        currentStreak: newStreak,
        longestStreak: Math.max(newStreak, existing.longestStreak),
        totalStudyDays: existing.totalStudyDays + 1,
        lastStudyDate: today,
      },
    });
  }

  /**
   * SM-2 variant: compute next review interval and ease factor.
   */
  private computeSpacedRepetition(
    response: string,
    prevInterval: number,
    prevEase: number,
  ): { interval: number; easeFactor: number } {
    // Response quality mapping
    const qualityMap: Record<string, number> = {
      again: 0,
      hard: 2,
      good: 4,
      easy: 5,
    };
    const quality = qualityMap[response] ?? 3;

    // Ease factor adjustment (SM-2 formula)
    let easeFactor =
      prevEase + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    easeFactor = Math.max(1.3, easeFactor);

    // Interval computation
    let interval: number;
    if (quality < 3) {
      // Failed — reset to 1 day
      interval = 1;
    } else if (prevInterval === 0) {
      interval = 1;
    } else if (prevInterval === 1) {
      interval = 6;
    } else {
      interval = Math.round(prevInterval * easeFactor);
    }

    return { interval, easeFactor: Math.round(easeFactor * 100) / 100 };
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  /**
   * Assert visibility-based access control.
   * Mirrors DigestsService pattern: private → owner only, org → org members, public → all.
   */
  private assertAccess(
    entity: { userId: string | null; organizationId: string | null; visibility: string },
    userId: string,
    organizationId: string,
  ) {
    if (entity.visibility === 'public_editorial') {
      return;
    }
    if (entity.visibility === 'private' && entity.userId === userId) {
      return;
    }
    if (entity.visibility === 'org' && entity.organizationId === organizationId) {
      return;
    }
    if (entity.userId === userId) {
      return;
    }
    throw new ForbiddenException('You do not have access to this resource');
  }

  /**
   * Validate that the referenced entity exists for a reviewer pack item.
   */
  private async validateItemReference(dto: AddReviewerPackItemDto) {
    if (dto.itemType === 'legal_document' && dto.legalDocumentId) {
      const count = await this.prisma.legalDocument.count({
        where: { id: dto.legalDocumentId },
      });
      if (count === 0) {
        throw new NotFoundException('Referenced legal document not found');
      }
    } else if (dto.itemType === 'digest' && dto.digestId) {
      const count = await this.prisma.digest.count({
        where: { id: dto.digestId },
      });
      if (count === 0) {
        throw new NotFoundException('Referenced digest not found');
      }
    } else if (dto.itemType === 'section' && dto.sectionId) {
      const count = await this.prisma.legalDocumentSection.count({
        where: { id: dto.sectionId },
      });
      if (count === 0) {
        throw new NotFoundException('Referenced section not found');
      }
    } else {
      throw new BadRequestException(
        `Item type '${dto.itemType}' requires a matching ID field`,
      );
    }
  }
}
