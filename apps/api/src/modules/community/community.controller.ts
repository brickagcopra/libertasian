import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuditService } from '../audit/audit.service';
import { CommunityService } from './community.service';
import {
  MarketplaceQueryDto,
  CreateCommunityRatingDto,
  ListRatingsQueryDto,
  UpsertCommunityVoteDto,
  CreateCommunityFlagDto,
  SubmitExpertVerificationDto,
} from './dto';

@ApiTags('Community')
@Controller('community')
export class CommunityController {
  constructor(
    private readonly communityService: CommunityService,
    private readonly auditService: AuditService,
  ) {}

  // =========================================================================
  // Marketplace Browse (public — no auth required)
  // =========================================================================

  @Get('marketplace/flashcard-sets')
  @ApiOperation({ summary: 'Browse public flashcard sets' })
  async browseFlashcardSets(@Query() query: MarketplaceQueryDto) {
    const result = await this.communityService.browseFlashcardSets(query);
    return { success: true, data: result.items, meta: { hasNext: result.hasNext, nextCursor: result.nextCursor } };
  }

  @Get('marketplace/reviewer-packs')
  @ApiOperation({ summary: 'Browse public reviewer packs' })
  async browseReviewerPacks(@Query() query: MarketplaceQueryDto) {
    const result = await this.communityService.browseReviewerPacks(query);
    return { success: true, data: result.items, meta: { hasNext: result.hasNext, nextCursor: result.nextCursor } };
  }

  @Get('marketplace/digests')
  @ApiOperation({ summary: 'Browse public digests' })
  async browseDigests(@Query() query: MarketplaceQueryDto) {
    const result = await this.communityService.browseDigests(query);
    return { success: true, data: result.items, meta: { hasNext: result.hasNext, nextCursor: result.nextCursor } };
  }

  @Get('marketplace/featured')
  @ApiOperation({ summary: 'Get featured/trending marketplace items' })
  async getFeatured() {
    const data = await this.communityService.getFeatured();
    return { success: true, data };
  }

  @Get('contributors/:userId')
  @ApiOperation({ summary: 'Get contributor public profile' })
  async getContributorProfile(@Param('userId', ParseUUIDPipe) userId: string) {
    const data = await this.communityService.getContributorProfile(userId);
    return { success: true, data };
  }

  // =========================================================================
  // Ratings (public read, auth'd write)
  // =========================================================================

  @Get('ratings/:entityType/:entityId')
  @ApiOperation({ summary: 'List ratings for an entity' })
  async listRatings(
    @Param('entityType') entityType: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Query() query: ListRatingsQueryDto,
  ) {
    const result = await this.communityService.listRatings(entityType, entityId, query);
    return { success: true, data: result.items, aggregate: result.aggregate, meta: { hasNext: result.hasNext, nextCursor: result.nextCursor } };
  }

  @Post('ratings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create or update a rating (upsert)' })
  async upsertRating(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCommunityRatingDto,
  ) {
    const rating = await this.communityService.upsertRating(user.sub, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      organizationId: user.organizationId,
      action: 'community_rating.upsert',
      entityType: 'community_rating',
      entityId: rating.id,
      metadata: { entityType: dto.entityType, entityId: dto.entityId, score: dto.score },
    });
    return { success: true, data: rating };
  }

  @Get('ratings/mine/:entityType/:entityId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get my rating for an entity' })
  async getMyRating(
    @CurrentUser() user: JwtPayload,
    @Param('entityType') entityType: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
  ) {
    const rating = await this.communityService.getMyRating(user.sub, entityType, entityId);
    return { success: true, data: rating };
  }

  @Delete('ratings/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete own rating' })
  async deleteRating(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.communityService.deleteRating(user.sub, id);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      organizationId: user.organizationId,
      action: 'community_rating.delete',
      entityType: 'community_rating',
      entityId: id,
    });
    return { success: true };
  }

  // =========================================================================
  // Votes (auth'd)
  // =========================================================================

  @Put('votes/:entityType/:entityId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upsert vote on an entity' })
  async upsertVote(
    @CurrentUser() user: JwtPayload,
    @Param('entityType') entityType: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Body() dto: UpsertCommunityVoteDto,
  ) {
    const vote = await this.communityService.upsertVote(user.sub, entityType, entityId, dto);
    return { success: true, data: vote };
  }

  @Delete('votes/:entityType/:entityId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove vote from an entity' })
  async removeVote(
    @CurrentUser() user: JwtPayload,
    @Param('entityType') entityType: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
  ) {
    await this.communityService.removeVote(user.sub, entityType, entityId);
    return { success: true };
  }

  @Get('votes/mine/:entityType/:entityId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get my vote for an entity' })
  async getMyVote(
    @CurrentUser() user: JwtPayload,
    @Param('entityType') entityType: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
  ) {
    const vote = await this.communityService.getMyVote(user.sub, entityType, entityId);
    return { success: true, data: vote };
  }

  // =========================================================================
  // Flags (auth'd)
  // =========================================================================

  @Post('flags')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Report content' })
  async createFlag(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCommunityFlagDto,
  ) {
    const flag = await this.communityService.createFlag(user.sub, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      organizationId: user.organizationId,
      action: 'community_flag.create',
      entityType: 'community_flag',
      entityId: flag.id,
      metadata: { flaggedEntityType: dto.entityType, flaggedEntityId: dto.entityId, reason: dto.reason },
    });
    return { success: true, data: flag };
  }

  // =========================================================================
  // Expert Verification (auth'd)
  // =========================================================================

  @Post('expert-verification')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit expert verification request' })
  async submitExpertVerification(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SubmitExpertVerificationDto,
  ) {
    const verification = await this.communityService.submitExpertVerification(user.sub, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      organizationId: user.organizationId,
      action: 'expert_verification.submit',
      entityType: 'expert_verification',
      entityId: verification.id,
      metadata: { expertiseType: dto.expertiseType },
    });
    return { success: true, data: verification };
  }

  @Get('expert-verification/me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get own expert verification status' })
  async getMyExpertVerification(@CurrentUser() user: JwtPayload) {
    const verification = await this.communityService.getMyExpertVerification(user.sub);
    return { success: true, data: verification };
  }
}
