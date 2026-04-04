import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TrackEvent } from '../analytics';
import { AuditService } from '../audit/audit.service';
import { StudyExportService } from './study-export.service';
import { StudyService } from './study.service';
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
  ExportStudyQueryDto,
  ExportFormat,
} from './dto';

@ApiTags('Study')
@Controller('study')
export class StudyController {
  constructor(
    private readonly studyService: StudyService,
    private readonly studyExportService: StudyExportService,
    private readonly auditService: AuditService,
  ) {}

  // =========================================================================
  // Codal Reader (public — no auth required for reading)
  // =========================================================================

  @Get('bar-subjects')
  @ApiOperation({ summary: 'List all bar subjects with document counts' })
  async listBarSubjects() {
    const subjects = await this.studyService.listBarSubjects();
    return { success: true, data: subjects };
  }

  @Get('codals/:subject')
  @ApiOperation({ summary: 'List codals/statutes by bar subject' })
  async listCodalsBySubject(
    @Param('subject') subject: string,
    @Query() query: ListCodalsBySubjectQueryDto,
  ) {
    const result = await this.studyService.listCodalsBySubject(subject, query);
    return { success: true, data: result.items, meta: result.meta };
  }

  // =========================================================================
  // Flashcard Sets
  // =========================================================================

  @Post('flashcard-sets')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a flashcard set' })
  async createFlashcardSet(
    @Body() dto: CreateFlashcardSetDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const set = await this.studyService.createFlashcardSet(
      dto,
      user.sub,
      user.organizationId,
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'flashcard_set.create',
      entityType: 'flashcard_set',
      entityId: set.id,
      metadata: { ip, barSubject: dto.barSubject },
    });
    return { success: true, data: set };
  }

  @Get('flashcard-sets')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List flashcard sets with filters' })
  async listFlashcardSets(
    @Query() query: ListFlashcardSetsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.studyService.listFlashcardSets(
      user.sub,
      user.organizationId,
      query,
    );
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get('flashcard-sets/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a flashcard set by ID' })
  async getFlashcardSet(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const set = await this.studyService.getFlashcardSet(
      id,
      user.sub,
      user.organizationId,
    );
    return { success: true, data: set };
  }

  @Patch('flashcard-sets/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a flashcard set' })
  async updateFlashcardSet(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFlashcardSetDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const set = await this.studyService.updateFlashcardSet(
      id,
      dto,
      user.sub,
      user.organizationId,
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'flashcard_set.update',
      entityType: 'flashcard_set',
      entityId: id,
      metadata: { ip, changes: Object.keys(dto) },
    });
    return { success: true, data: set };
  }

  @Delete('flashcard-sets/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a flashcard set' })
  async deleteFlashcardSet(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.studyService.deleteFlashcardSet(id, user.sub, user.organizationId);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'flashcard_set.delete',
      entityType: 'flashcard_set',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Flashcard set deleted' } };
  }

  // =========================================================================
  // Flashcards
  // =========================================================================

  @Post('flashcard-sets/:setId/flashcards')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a flashcard to a set' })
  async addFlashcard(
    @Param('setId', ParseUUIDPipe) setId: string,
    @Body() dto: CreateFlashcardDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const card = await this.studyService.addFlashcard(
      setId,
      dto,
      user.sub,
      user.organizationId,
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'flashcard.create',
      entityType: 'flashcard',
      entityId: card.id,
      metadata: { ip, flashcardSetId: setId, sourceType: dto.sourceType },
    });
    return { success: true, data: card };
  }

  @Get('flashcard-sets/:setId/flashcards')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List flashcards in a set' })
  async listFlashcards(
    @Param('setId', ParseUUIDPipe) setId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const cards = await this.studyService.listFlashcards(
      setId,
      user.sub,
      user.organizationId,
    );
    return { success: true, data: cards };
  }

  @Patch('flashcards/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a flashcard' })
  async updateFlashcard(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFlashcardDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const card = await this.studyService.updateFlashcard(id, dto, user.sub);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'flashcard.update',
      entityType: 'flashcard',
      entityId: id,
      metadata: { ip, changes: Object.keys(dto) },
    });
    return { success: true, data: card };
  }

  @Delete('flashcards/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a flashcard' })
  async deleteFlashcard(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.studyService.deleteFlashcard(id, user.sub);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'flashcard.delete',
      entityType: 'flashcard',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Flashcard deleted' } };
  }

  // =========================================================================
  // AI Flashcard Generation
  // =========================================================================

  @Post('flashcard-sets/:setId/generate-ai')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Generate AI flashcards for a set',
    description:
      'Calls the RAG service to generate flashcards from legal corpus content. ' +
      'Generated cards are saved directly to the specified flashcard set.',
  })
  async generateAiFlashcards(
    @Param('setId', ParseUUIDPipe) setId: string,
    @Body() dto: GenerateAiFlashcardsDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.studyService.generateAiFlashcards(
      setId,
      dto,
      user.sub,
      user.organizationId,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'flashcard.generate_ai',
      entityType: 'flashcard_set',
      entityId: setId,
      metadata: {
        ip,
        topic: dto.topic,
        cardType: dto.cardType ?? 'mixed',
        requestedCount: dto.count ?? 10,
        generatedCount: result.generatedCount,
        confidenceScore: result.confidenceScore,
        modelName: result.modelName,
      },
    });

    return { success: true, data: result };
  }

  // =========================================================================
  // Reviewer Packs
  // =========================================================================

  @Post('reviewer-packs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a reviewer pack' })
  @TrackEvent('reviewer_pack_started', (req, res) => {
    const response = res.data as Record<string, unknown> | undefined;
    const pack = response?.data as Record<string, unknown> | undefined;
    return {
      pack_id: (pack?.id as string) ?? '',
      subject_area: (req.body?.barSubject as string) ?? 'general',
    };
  })
  async createReviewerPack(
    @Body() dto: CreateReviewerPackDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const pack = await this.studyService.createReviewerPack(
      dto,
      user.sub,
      user.organizationId,
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'reviewer_pack.create',
      entityType: 'reviewer_pack',
      entityId: pack.id,
      metadata: { ip, barSubject: dto.barSubject },
    });
    return { success: true, data: pack };
  }

  @Get('reviewer-packs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List reviewer packs with filters' })
  async listReviewerPacks(
    @Query() query: ListReviewerPacksQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.studyService.listReviewerPacks(
      user.sub,
      user.organizationId,
      query,
    );
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get('reviewer-packs/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a reviewer pack with items' })
  async getReviewerPack(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const pack = await this.studyService.getReviewerPack(
      id,
      user.sub,
      user.organizationId,
    );
    return { success: true, data: pack };
  }

  @Patch('reviewer-packs/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a reviewer pack' })
  async updateReviewerPack(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReviewerPackDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const pack = await this.studyService.updateReviewerPack(
      id,
      dto,
      user.sub,
      user.organizationId,
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'reviewer_pack.update',
      entityType: 'reviewer_pack',
      entityId: id,
      metadata: { ip, changes: Object.keys(dto) },
    });
    return { success: true, data: pack };
  }

  @Delete('reviewer-packs/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a reviewer pack' })
  async deleteReviewerPack(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.studyService.deleteReviewerPack(id, user.sub, user.organizationId);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'reviewer_pack.delete',
      entityType: 'reviewer_pack',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Reviewer pack deleted' } };
  }

  // =========================================================================
  // Reviewer Pack Items
  // =========================================================================

  @Post('reviewer-packs/:packId/items')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add an item to a reviewer pack' })
  async addReviewerPackItem(
    @Param('packId', ParseUUIDPipe) packId: string,
    @Body() dto: AddReviewerPackItemDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const item = await this.studyService.addReviewerPackItem(
      packId,
      dto,
      user.sub,
      user.organizationId,
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'reviewer_pack_item.create',
      entityType: 'reviewer_pack_item',
      entityId: item.id,
      metadata: { ip, reviewerPackId: packId, itemType: dto.itemType },
    });
    return { success: true, data: item };
  }

  @Patch('reviewer-pack-items/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a reviewer pack item' })
  async updateReviewerPackItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReviewerPackItemDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const item = await this.studyService.updateReviewerPackItem(id, dto, user.sub);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'reviewer_pack_item.update',
      entityType: 'reviewer_pack_item',
      entityId: id,
      metadata: { ip, changes: Object.keys(dto) },
    });
    return { success: true, data: item };
  }

  @Delete('reviewer-pack-items/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a reviewer pack item' })
  async deleteReviewerPackItem(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.studyService.deleteReviewerPackItem(id, user.sub);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'reviewer_pack_item.delete',
      entityType: 'reviewer_pack_item',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Reviewer pack item deleted' } };
  }

  // =========================================================================
  // Syllabus Mode (Bar Topic Study Path)
  // =========================================================================

  @Get('syllabi')
  @ApiOperation({ summary: 'List all active bar exam syllabi' })
  async listSyllabi(@Query() query: ListSyllabiQueryDto) {
    const syllabi = await this.studyService.listSyllabi(query);
    return { success: true, data: syllabi };
  }

  @Get('syllabi/subject/:code')
  @ApiOperation({ summary: 'Get syllabus by bar subject code' })
  async getSyllabusBySubject(@Param('code') code: string) {
    const syllabus = await this.studyService.getSyllabusBySubject(code);
    return { success: true, data: syllabus };
  }

  @Get('syllabi/:id')
  @ApiOperation({ summary: 'Get syllabus by ID with topic tree' })
  async getSyllabus(@Param('id', ParseUUIDPipe) id: string) {
    const syllabus = await this.studyService.getSyllabus(id);
    return { success: true, data: syllabus };
  }

  @Get('syllabi/:id/topics/:topicId')
  @ApiOperation({ summary: 'Get a syllabus topic with resources' })
  async getSyllabusTopic(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('topicId', ParseUUIDPipe) topicId: string,
  ) {
    const topic = await this.studyService.getSyllabusTopic(id, topicId);
    return { success: true, data: topic };
  }

  @Get('syllabi/:id/progress')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user progress for a syllabus' })
  async getSyllabusProgress(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const progress = await this.studyService.getSyllabusProgress(id, user.sub);
    return { success: true, data: progress };
  }

  @Put('syllabi/topics/:topicId/progress')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark a syllabus topic as studied/completed' })
  async upsertSyllabusTopicProgress(
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @Body() dto: SyllabusTopicProgressDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const progress = await this.studyService.upsertSyllabusTopicProgress(
      topicId,
      dto,
      user.sub,
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'syllabus_topic_progress.upsert',
      entityType: 'study_progress',
      entityId: progress.id,
      metadata: { ip, topicId, status: dto.status },
    });
    return { success: true, data: progress };
  }

  @Get('bar-readiness')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get overall bar exam readiness score' })
  async getBarExamReadiness(@CurrentUser() user: JwtPayload) {
    const readiness = await this.studyService.getBarExamReadiness(user.sub);
    return { success: true, data: readiness };
  }

  // ─── Syllabus Admin ─────────────────────────────────────────────────

  @Post('syllabi/topics')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: create a syllabus topic' })
  async createSyllabusTopic(
    @Body() dto: CreateSyllabusTopicDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const topic = await this.studyService.createSyllabusTopic(dto);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'syllabus_topic.create',
      entityType: 'syllabus_topic',
      entityId: topic.id,
      metadata: { ip, syllabusId: dto.syllabusId, slug: dto.slug },
    });
    return { success: true, data: topic };
  }

  @Patch('syllabi/topics/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: update a syllabus topic' })
  async updateSyllabusTopic(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSyllabusTopicDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const topic = await this.studyService.updateSyllabusTopic(id, dto);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'syllabus_topic.update',
      entityType: 'syllabus_topic',
      entityId: id,
      metadata: { ip, changes: Object.keys(dto) },
    });
    return { success: true, data: topic };
  }

  @Delete('syllabi/topics/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: delete a syllabus topic' })
  async deleteSyllabusTopic(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.studyService.deleteSyllabusTopic(id);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'syllabus_topic.delete',
      entityType: 'syllabus_topic',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Syllabus topic deleted' } };
  }

  @Post('syllabi/topics/:topicId/resources')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: link a resource to a syllabus topic' })
  async addSyllabusTopicResource(
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @Body() dto: AddSyllabusTopicResourceDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const resource = await this.studyService.addSyllabusTopicResource(topicId, dto);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'syllabus_topic_resource.create',
      entityType: 'syllabus_topic_resource',
      entityId: resource.id,
      metadata: { ip, topicId, resourceType: dto.resourceType, resourceId: dto.resourceId },
    });
    return { success: true, data: resource };
  }

  @Delete('syllabi/topic-resources/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: unlink a resource from a syllabus topic' })
  async removeSyllabusTopicResource(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.studyService.removeSyllabusTopicResource(id);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'syllabus_topic_resource.delete',
      entityType: 'syllabus_topic_resource',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Syllabus topic resource removed' } };
  }

  // =========================================================================
  // Study Progress
  // =========================================================================

  @Put('progress/:entityType/:entityId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upsert study progress for an entity' })
  async upsertProgress(
    @Param('entityType') entityType: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Body() dto: UpsertStudyProgressDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const progress = await this.studyService.upsertProgress(
      user.sub,
      entityType,
      entityId,
      dto,
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'study_progress.upsert',
      entityType: 'study_progress',
      entityId: progress.id,
      metadata: { ip, targetEntityType: entityType, targetEntityId: entityId, status: dto.status },
    });
    return { success: true, data: progress };
  }

  @Get('progress')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all study progress for the user' })
  async listProgress(@CurrentUser() user: JwtPayload) {
    const progress = await this.studyService.listProgress(user.sub);
    return { success: true, data: progress };
  }

  @Get('progress/:entityType/:entityId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get study progress for a specific entity' })
  async getProgress(
    @Param('entityType') entityType: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const progress = await this.studyService.getProgress(
      user.sub,
      entityType,
      entityId,
    );
    return { success: true, data: progress };
  }

  // =========================================================================
  // Flashcard Reviews (Spaced Repetition)
  // =========================================================================

  @Post('flashcards/:id/review')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit a flashcard review (spaced repetition)' })
  @TrackEvent('flashcard_answered', (req) => ({
    correct: (req.body?.response as string) === 'correct',
    time_to_answer_ms: (req.body?.timeToAnswerMs as number) ?? 0,
    difficulty_rating: (req.body?.difficultyRating as number) ?? 0,
  }))
  async submitFlashcardReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitFlashcardReviewDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const review = await this.studyService.submitFlashcardReview(
      id,
      dto,
      user.sub,
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'flashcard_review.submit',
      entityType: 'flashcard_review',
      entityId: review.id,
      metadata: { ip, flashcardId: id, response: dto.response },
    });
    return { success: true, data: review };
  }

  @Get('flashcard-sets/:setId/review-stats')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get review statistics for a flashcard set' })
  async getFlashcardReviewStats(
    @Param('setId', ParseUUIDPipe) setId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const stats = await this.studyService.getFlashcardReviewStats(
      setId,
      user.sub,
    );
    return { success: true, data: stats };
  }

  // =========================================================================
  // Study Sessions
  // =========================================================================

  @Post('sessions/start')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start a study session' })
  @TrackEvent('flashcard_session_started', (req, res) => {
    const response = res.data as Record<string, unknown> | undefined;
    const session = response?.data as Record<string, unknown> | undefined;
    return {
      card_count: 0,
      subject_area: (req.body?.subjectArea as string) ?? 'general',
      source: (req.body?.entityType as string) ?? 'manual',
    };
  })
  async startStudySession(
    @Body() dto: StartStudySessionDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const session = await this.studyService.startStudySession(dto, user.sub);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'study_session.start',
      entityType: 'study_session',
      entityId: session.id,
      metadata: { ip, entityType: dto.entityType, entityId: dto.entityId },
    });
    return { success: true, data: session };
  }

  @Post('sessions/:id/end')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'End a study session' })
  @TrackEvent('study_session_completed', (req, res) => {
    const response = res.data as Record<string, unknown> | undefined;
    const session = response?.data as Record<string, unknown> | undefined;
    return {
      duration_minutes: Math.round(((session?.durationSecs as number) ?? 0) / 60),
      cards_reviewed: (session?.itemsStudied as number) ?? 0,
      sections_read: 0,
      subject_area: (req.body?.subjectArea as string) ?? 'general',
    };
  })
  async endStudySession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndStudySessionDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const session = await this.studyService.endStudySession(id, dto, user.sub);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'study_session.end',
      entityType: 'study_session',
      entityId: id,
      metadata: {
        ip,
        durationSecs: session.durationSecs,
        itemsStudied: session.itemsStudied,
      },
    });
    return { success: true, data: session };
  }

  // =========================================================================
  // Study Stats & Streak
  // =========================================================================

  @Get('stats')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get study statistics including streak and time' })
  async getStudyStats(@CurrentUser() user: JwtPayload) {
    const stats = await this.studyService.getStudyStats(user.sub);
    return { success: true, data: stats };
  }

  // =========================================================================
  // Export Study Sets
  // =========================================================================

  @Get('flashcard-sets/:id/export')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export flashcard set as PDF or DOCX' })
  async exportFlashcardSet(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ExportStudyQueryDto,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const format = query.format ?? ExportFormat.PDF;

    const { buffer, filename } =
      format === ExportFormat.DOCX
        ? await this.studyExportService.exportFlashcardSetDocx(id, user.sub, user.organizationId)
        : await this.studyExportService.exportFlashcardSetPdf(id, user.sub, user.organizationId);

    const contentType =
      format === ExportFormat.DOCX
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf';

    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Content-Length': buffer.length.toString(),
    });
    res.end(buffer);
  }

  @Get('reviewer-packs/:id/export')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export reviewer pack as PDF or DOCX' })
  async exportReviewerPack(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ExportStudyQueryDto,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const format = query.format ?? ExportFormat.PDF;

    const { buffer, filename } =
      format === ExportFormat.DOCX
        ? await this.studyExportService.exportReviewerPackDocx(id, user.sub, user.organizationId)
        : await this.studyExportService.exportReviewerPackPdf(id, user.sub, user.organizationId);

    const contentType =
      format === ExportFormat.DOCX
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf';

    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Content-Length': buffer.length.toString(),
    });
    res.end(buffer);
  }
}
