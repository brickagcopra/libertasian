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
import { DerivativesAdminService } from './derivatives-admin.service';
import { DerivativesReviewService } from './derivatives-review.service';
import {
  BulkApproveByConfidenceDto,
  EnqueueGenerationDto,
  ListDerivativeJobsDto,
  SubmitDerivativeReviewDto,
  UpdateDerivativeSettingsDto,
} from './dto';

@ApiTags('Derivatives Admin')
@Controller('admin/derivatives')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions('admin:settings')
@ApiBearerAuth()
export class DerivativesAdminController {
  constructor(
    private readonly service: DerivativesAdminService,
    private readonly reviewService: DerivativesReviewService,
    private readonly auditService: AuditService,
  ) {}

  @Get('stats')
  async getStats() {
    const data = await this.service.getStats();
    return { success: true, data };
  }

  @Get('settings')
  async getSettings() {
    const data = await this.service.getDerivativeSettings();
    return { success: true, data };
  }

  @Patch('settings')
  async updateSettings(
    @Body() dto: UpdateDerivativeSettingsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.service.updateDerivativeSettings(dto, user.sub);
    return { success: true };
  }

  @Post('generate')
  async enqueueGeneration(
    @Body() dto: EnqueueGenerationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.service.enqueueGeneration(dto, user.sub);
    return { success: true, data };
  }

  @Get('jobs')
  async getJobs(@Query() dto: ListDerivativeJobsDto) {
    const data = await this.service.getJobs(dto);
    return { success: true, data };
  }

  @Get('jobs/:id')
  async getJob(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.service.getJob(id);
    return { success: true, data };
  }

  @Get('jobs/:id/digest')
  @ApiOperation({ summary: 'Get the digest artifact produced by a derivative generation job' })
  async getJobDigest(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.service.getJobDigest(id);
    return { success: true, data };
  }

  @Get('jobs/:id/doctrines')
  @ApiOperation({ summary: 'Get doctrine extracts produced by a derivative generation job' })
  async getJobDoctrines(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.service.getJobDoctrines(id);
    return { success: true, data };
  }

  @Get('jobs/:id/essay')
  @ApiOperation({ summary: 'Get the essay prompt artifact produced by a derivative generation job' })
  async getJobEssay(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.service.getJobEssay(id);
    return { success: true, data };
  }

  @Get('jobs/:id/mcqs')
  @ApiOperation({ summary: 'Get the MCQ artifacts produced by a derivative generation job' })
  async getJobMcqs(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.service.getJobMcqs(id);
    return { success: true, data };
  }

  @Get('jobs/:id/flashcards')
  @ApiOperation({ summary: 'Get the flashcard artifacts produced by a derivative generation job' })
  async getJobFlashcards(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.service.getJobFlashcards(id);
    return { success: true, data };
  }

  @Get('jobs/:id/outlines')
  @ApiOperation({ summary: 'Get the subject_outline artifacts produced by a derivative generation job' })
  async getJobOutlines(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.service.getJobOutlines(id);
    return { success: true, data };
  }

  @Post('jobs/:id/retry')
  async retryJob(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.service.retryJob(id, user.sub);
    return { success: true };
  }

  @Post('artifacts/:id/regenerate')
  async regenerateArtifact(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const data = await this.service.regenerateArtifact(id, user.sub);
    return { success: true, data };
  }

  @Post('artifacts/:id/review')
  @ApiOperation({ summary: 'Submit a review verdict for a derivative artifact' })
  @Throttle({ default: { ttl: 60_000, limit: 100 } })
  async submitArtifactReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitDerivativeReviewDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.reviewService.submitReview(id, user.sub, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'derivative.review.submit',
      entityType: 'derivative_artifact',
      entityId: id,
      metadata: {
        ip,
        verdict: dto.verdict,
        newStatus: result.newStatus,
        newVisibility: result.newVisibility,
        reviewId: result.reviewId,
        subjectsCopiedFromParent: result.subjectsCopiedFromParent,
      },
    });
    if (result.newVisibility === 'public_editorial') {
      await this.auditService.log({
        actorUserId: user.sub,
        actorType: 'admin',
        action: 'derivative.publish_editorial',
        entityType: 'derivative_artifact',
        entityId: id,
        metadata: { ip, reviewId: result.reviewId },
      });
    }
    if (result.subjectsCopiedFromParent > 0) {
      await this.auditService.log({
        actorUserId: user.sub,
        actorType: 'admin',
        action: 'derivative.subjects.fallback_copied',
        entityType: 'derivative_artifact',
        entityId: id,
        metadata: { ip, count: result.subjectsCopiedFromParent },
      });
    }
    return { success: true, data: result };
  }

  @Post('bulk-approve-by-confidence')
  @ApiOperation({
    summary:
      'Batch approve private artifacts + digests whose confidence_score >= threshold',
  })
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async bulkApproveByConfidence(
    @Body() dto: BulkApproveByConfidenceDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = await this.reviewService.bulkApproveByConfidence(dto, user.sub);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: data.dryRun
        ? 'derivative.bulk_approve.preview'
        : 'derivative.bulk_approve.execute',
      entityType: 'derivative_artifact',
      entityId: 'bulk',
      metadata: {
        ip,
        threshold: dto.threshold,
        derivativeTypes: dto.derivativeTypes ?? null,
        includeDigests: dto.includeDigests ?? true,
        artifactsPromoted: data.artifactsPromoted,
        digestsPromoted: data.digestsPromoted,
        subjectsInherited: data.subjectsInherited,
        errorCount: data.errors.length,
      },
    });
    return { success: true, data };
  }

  @Delete('jobs/:id/output')
  @ApiOperation({ summary: 'Delete the output (digest or artifact) produced by a derivative generation job' })
  async deleteJobOutput(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.service.deleteJobOutput(id, user.sub);
    return { success: true };
  }

  @Delete('artifacts/:id')
  async softDeleteArtifact(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.service.softDeleteArtifact(id, user.sub);
    return { success: true };
  }
}
