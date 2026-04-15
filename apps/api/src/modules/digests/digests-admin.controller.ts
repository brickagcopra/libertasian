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
import { TrackEvent } from '../analytics';
import { AuditService } from '../audit/audit.service';
import { DigestsService } from './digests.service';
import {
  AssignReviewerDto,
  BatchApproveDto,
  BatchAssignDto,
  BatchRejectDto,
  ReviewQueueQueryDto,
  SubmitReviewDto,
} from './dto';

@ApiTags('Admin — Digests')
@Controller('admin/digests')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions({ permissions: ['digests:review', 'admin:review-queue'], mode: 'any' })
@Throttle({ default: { ttl: 60000, limit: 100 } })
@ApiBearerAuth()
export class DigestsAdminController {
  constructor(
    private readonly digestsService: DigestsService,
    private readonly auditService: AuditService,
  ) {}

  @Get('review-queue')
  @ApiOperation({ summary: 'List digests in the review queue with advanced filters' })
  async getReviewQueue(@Query() query: ReviewQueueQueryDto) {
    const result = await this.digestsService.getReviewQueue(query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get('review-stats')
  @ApiOperation({ summary: 'Get review queue statistics' })
  async getReviewStats() {
    const stats = await this.digestsService.getReviewStats();
    return { success: true, data: stats };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get full digest detail (admin view, bypasses visibility checks)' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    const digest = await this.digestsService.findByIdAdmin(id);
    return { success: true, data: digest };
  }

  @Post(':id/assign')
  @ApiOperation({ summary: 'Assign a reviewer to a digest' })
  async assignReviewer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignReviewerDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const digest = await this.digestsService.assignReviewer(id, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'digest.reviewer.assign',
      entityType: 'digest',
      entityId: id,
      metadata: { ip, reviewerUserId: dto.reviewerUserId },
    });
    return { success: true, data: digest };
  }

  @Post(':id/unassign')
  @ApiOperation({ summary: 'Remove reviewer assignment from a digest' })
  async unassignReviewer(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const digest = await this.digestsService.unassignReviewer(id);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'digest.reviewer.unassign',
      entityType: 'digest',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: digest };
  }

  @Post(':id/review')
  @ApiOperation({ summary: 'Submit a review verdict for a digest' })
  @TrackEvent('digest_reviewed', (req) => ({
    verdict: (req.body?.verdict as string) ?? 'unknown',
    reviewer_role: 'admin',
  }))
  async submitReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitReviewDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.digestsService.submitReview(id, user.sub, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'digest.review.submit',
      entityType: 'digest',
      entityId: id,
      metadata: {
        ip,
        verdict: dto.verdict,
        newStatus: result.newStatus,
        reviewId: result.reviewId,
      },
    });
    return { success: true, data: result };
  }

  @Post('batch-approve')
  @ApiOperation({ summary: 'Batch approve multiple digests' })
  async batchApprove(
    @Body() dto: BatchApproveDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.digestsService.batchApprove(dto, user.sub);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'digest.batch.approve',
      entityType: 'digest',
      entityId: dto.digestIds[0],
      metadata: { ip, digestIds: result.digestIds, processed: result.processed },
    });
    return { success: true, data: result };
  }

  @Post('batch-reject')
  @ApiOperation({ summary: 'Batch reject multiple digests' })
  async batchReject(
    @Body() dto: BatchRejectDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.digestsService.batchReject(dto, user.sub);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'digest.batch.reject',
      entityType: 'digest',
      entityId: dto.digestIds[0],
      metadata: {
        ip,
        digestIds: result.digestIds,
        processed: result.processed,
        reason: dto.reason,
      },
    });
    return { success: true, data: result };
  }

  @Post('batch-assign')
  @ApiOperation({ summary: 'Batch assign a reviewer to multiple digests' })
  async batchAssign(
    @Body() dto: BatchAssignDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.digestsService.batchAssign(dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'digest.batch.assign',
      entityType: 'digest',
      entityId: dto.digestIds[0],
      metadata: {
        ip,
        digestIds: dto.digestIds,
        reviewerUserId: dto.reviewerUserId,
        processed: result.processed,
      },
    });
    return { success: true, data: result };
  }
}
