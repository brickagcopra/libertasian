import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditService } from '../audit/audit.service';
import { DuplicatesService } from './duplicates.service';
import { ListDuplicatesQueryDto, MergeDuplicateDto, ResolveDuplicateDto } from './dto';

@ApiTags('Admin — Duplicates')
@Controller('admin/duplicates')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions('admin:duplicates')
@Throttle({ default: { ttl: 60000, limit: 100 } })
@ApiBearerAuth()
export class DuplicatesController {
  constructor(
    private readonly duplicatesService: DuplicatesService,
    private readonly auditService: AuditService,
  ) {}

  // ---- Query Endpoints ----

  @Get()
  @ApiOperation({ summary: 'List duplicate pairs (paginated)' })
  async list(@Query() query: ListDuplicatesQueryDto) {
    const result = await this.duplicatesService.list(query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get duplicate detection stats' })
  async getStats() {
    const stats = await this.duplicatesService.getStats();
    return { success: true, data: stats };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single duplicate pair with full document details' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    const pair = await this.duplicatesService.findById(id);
    return { success: true, data: pair };
  }

  @Get('review-queue')
  @ApiOperation({ summary: 'Get reviewable duplicate pairs (possible_duplicate tier)' })
  async getReviewQueue(
    @Query() query: ListDuplicatesQueryDto,
  ) {
    const result = await this.duplicatesService.getReviewablePairs({
      cursor: query.cursor,
      limit: query.limit,
    });
    return { success: true, data: result.items, meta: result.meta };
  }

  @Post(':id/resolve')
  @ApiOperation({ summary: 'Resolve a duplicate pair (merge, dismiss, or version_update)' })
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveDuplicateDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.duplicatesService.resolve(
      id,
      dto.action,
      dto.keepDocumentId,
      user.sub,
    );
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: `duplicate.resolved`,
      entityType: 'document_similarity',
      entityId: id,
      metadata: { ip, ...result },
    });
    return { success: true, data: result };
  }

  // ---- Detection Endpoints ----

  @Post('detect')
  @ApiOperation({ summary: 'Run full duplicate detection (checksum + title + citation)' })
  async runFullDetection(
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.duplicatesService.runFullDetection();
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'duplicate.detect_full',
      entityType: 'document_similarity',
      entityId: undefined,
      metadata: { ip, ...result },
    });
    return { success: true, data: result };
  }

  @Post('detect/checksum')
  @ApiOperation({ summary: 'Detect duplicates by checksum only' })
  async detectChecksum(
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.duplicatesService.detectChecksumDuplicates();
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'duplicate.detect_checksum',
      entityType: 'document_similarity',
      entityId: undefined,
      metadata: { ip, pairsCreated: result.pairsCreated },
    });
    return { success: true, data: { ...result, similarityType: 'checksum' } };
  }

  @Post('detect/title')
  @ApiOperation({ summary: 'Detect duplicates by title similarity' })
  async detectTitle(
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.duplicatesService.detectTitleDuplicates();
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'duplicate.detect_title',
      entityType: 'document_similarity',
      entityId: undefined,
      metadata: { ip, pairsCreated: result.pairsCreated },
    });
    return { success: true, data: { ...result, similarityType: 'title' } };
  }

  @Post('detect/citation')
  @ApiOperation({ summary: 'Detect duplicates by citation overlap (GR No. / citation text)' })
  async detectCitation(
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.duplicatesService.detectCitationOverlap();
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'duplicate.detect_citation',
      entityType: 'document_similarity',
      entityId: undefined,
      metadata: { ip, pairsCreated: result.pairsCreated },
    });
    return { success: true, data: { ...result, similarityType: 'citation' } };
  }

  // ---- Action Endpoints ----

  @Post(':id/merge')
  @ApiOperation({ summary: 'Merge a duplicate pair (keep one, archive the other)' })
  async merge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MergeDuplicateDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.duplicatesService.merge(id, dto, user.sub);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'duplicate.merge',
      entityType: 'document_similarity',
      entityId: id,
      metadata: {
        ip,
        keptDocumentId: result.keptDocumentId,
        archivedDocumentId: result.archivedDocumentId,
      },
    });
    return { success: true, data: result };
  }

  @Post(':id/dismiss')
  @ApiOperation({ summary: 'Dismiss a duplicate pair as not a true duplicate' })
  async dismiss(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.duplicatesService.dismiss(id);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'duplicate.dismiss',
      entityType: 'document_similarity',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: result };
  }
}
