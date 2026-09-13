import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { AuditService } from '../audit/audit.service';
import {
  AdminBarExamAnswersService,
  AUDIT_CONCURRENCY,
  chunked,
  type AdminBarExamAnswerDetail,
  type BulkReviewResult,
  type CoverageResult,
  type DispatchResult,
  type GenerationJobDetail,
  type GenerationJobSummary,
  type ListResult,
} from './admin-bar-exam-answers.service';
import {
  BulkApproveBarExamAnswersDto,
  BulkRejectBarExamAnswersDto,
  DispatchAnswerGenerationDto,
  GenerationJobDetailQueryDto,
  ListBarExamAnswersQueryDto,
  ListGenerationJobsQueryDto,
  RejectBarExamAnswerDto,
} from './dto';

@ApiTags('Admin — Bar Exam Answers')
@Controller('admin/bar-exams/answers')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions('admin:settings')
@ApiBearerAuth()
@Throttle({ default: { ttl: 60_000, limit: 60 } })
export class AdminBarExamAnswersController {
  constructor(
    private readonly service: AdminBarExamAnswersService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'List bar exam AI answers, filterable by review status, year, subject ' +
      'and minimum confidence. Default returns pending oldest-first (queue ' +
      'order); reviewStatus="all" applies no status filter.',
  })
  async list(
    @Query() query: ListBarExamAnswersQueryDto,
  ): Promise<{ success: true; data: ListResult }> {
    const data = await this.service.listAnswers({
      reviewStatus: query.reviewStatus,
      year: query.year,
      subjectCode: query.subjectCode,
      minConfidence: query.minConfidence,
      cursor: query.cursor,
      limit: query.limit,
    });
    return { success: true, data };
  }

  // NOTE: every literal-path GET must be declared before `@Get(':id')`,
  // otherwise Nest matches 'coverage' and 'generation-jobs' as an :id.

  @Get('coverage')
  @ApiOperation({
    summary:
      'Answer coverage per sitting year × subject: totals, missing, pending ' +
      '(and pending at/above 0.70), approved, rejected and unscored.',
  })
  async coverage(): Promise<{ success: true; data: CoverageResult }> {
    const data = await this.service.coverage();
    return { success: true, data };
  }

  @Get('generation-jobs')
  @ApiOperation({
    summary:
      'Recent generation jobs with per-status item counts and a stalled flag.',
  })
  async listJobs(
    @Query() query: ListGenerationJobsQueryDto,
  ): Promise<{ success: true; data: { items: GenerationJobSummary[] } }> {
    const items = await this.service.listJobs(query.limit ?? 20);
    return { success: true, data: { items } };
  }

  @Get('generation-jobs/:id')
  @ApiOperation({
    summary:
      'One generation job: counts, stalled flag, and its failed items joined ' +
      'to year / subject / question number (keyset-paginated).',
  })
  async getJob(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: GenerationJobDetailQueryDto,
  ): Promise<{ success: true; data: GenerationJobDetail }> {
    const data = await this.service.getJob(id, {
      failedCursor: query.failedCursor,
      failedLimit: query.failedLimit,
    });
    return { success: true, data };
  }

  @Post('generation-jobs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary:
      'Cancel a queued/running/paused job. The worker checks the status ' +
      'before every question, so the stop lands within one generation.',
  })
  async cancelJob(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ): Promise<{ success: true; data: GenerationJobSummary }> {
    const data = await this.service.cancelJob(id);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'admin_cancelled_bar_exam_answer_generation_job',
      entityType: 'bar_exam_answer_generation_job',
      entityId: id,
      metadata: { ip, counts: { ...data.counts }, total: data.total },
    });
    return { success: true, data };
  }

  @Post('generation-jobs/:id/retry-failed')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary:
      'Re-queue every failed item and restart the chunk chain. Also the ' +
      'resume path for a job paused on the LLM budget.',
  })
  async retryFailed(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ): Promise<{
    success: true;
    data: { job: GenerationJobSummary; requeued: number };
  }> {
    const data = await this.service.retryFailedItems(id);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'admin_retried_bar_exam_answer_generation_job',
      entityType: 'bar_exam_answer_generation_job',
      entityId: id,
      metadata: { ip, requeued: data.requeued, status: data.job.status },
    });
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Single answer detail (full ALAC + question text).' })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ success: true; data: AdminBarExamAnswerDetail }> {
    const data = await this.service.getAnswerDetail(id);
    return { success: true, data };
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Approve an answer. Flips review_status to "approved" and ' +
      'visibility to "public_editorial". Public surfacing is Phase 3b.',
  })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ): Promise<{ success: true; data: AdminBarExamAnswerDetail }> {
    const data = await this.service.approve(id, user.sub);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'admin_approved_bar_exam_answer',
      entityType: 'bar_exam_answer',
      entityId: id,
      metadata: {
        ip,
        questionId: data.barExamQuestionId,
        sittingYear: data.question.sittingYear,
        subjectStudyCode: data.question.subjectStudyCode,
      },
    });
    return { success: true, data };
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Reject an answer. Flips review_status to "rejected" and keeps ' +
      'visibility "private". Optional rejection reason is audit-logged.',
  })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectBarExamAnswerDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ): Promise<{ success: true; data: AdminBarExamAnswerDetail }> {
    const data = await this.service.reject(id, user.sub);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'admin_rejected_bar_exam_answer',
      entityType: 'bar_exam_answer',
      entityId: id,
      metadata: {
        ip,
        questionId: data.barExamQuestionId,
        sittingYear: data.question.sittingYear,
        subjectStudyCode: data.question.subjectStudyCode,
        reason: dto.reason ?? null,
      },
    });
    return { success: true, data };
  }

  @Post('bulk-approve')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary:
      'Approve many pending answers by id list or by filter. Filter mode ' +
      'requires minConfidence >= 0.70 and never includes unscored rows.',
  })
  async bulkApprove(
    @Body() dto: BulkApproveBarExamAnswersDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ): Promise<{ success: true; data: BulkReviewResult }> {
    const outcome = await this.service.bulkApprove(dto, user.sub);
    return this.finishBulk('approve', outcome, user, ip, {
      mode: dto.ids?.length ? 'ids' : 'filter',
      minConfidence: dto.filter?.minConfidence ?? null,
      year: dto.filter?.year ?? null,
      subjectCode: dto.filter?.subjectCode ?? null,
      reason: dto.reason ?? null,
    });
  }

  @Post('bulk-reject')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary:
      'Reject many pending answers by explicit id list. There is no filter ' +
      'mode — a request carrying a "filter" key is a 400. Rejected rows keep ' +
      'visibility "private".',
  })
  async bulkReject(
    @Body() dto: BulkRejectBarExamAnswersDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ): Promise<{ success: true; data: BulkReviewResult }> {
    const outcome = await this.service.bulkReject(dto, user.sub);
    return this.finishBulk('reject', outcome, user, ip, { mode: 'ids' });
  }

  @Post('dispatch-generation')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary:
      'Resolve filters into a generation job (one item per question) and ' +
      'enqueue its first chunk. There is no question cap. dryRun returns the ' +
      'resolved total plus a year × subject breakdown and creates nothing.',
  })
  async dispatch(
    @Body() dto: DispatchAnswerGenerationDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ): Promise<{ success: true; data: DispatchResult }> {
    const data = await this.service.dispatchGeneration(dto, user.sub);

    // A dry run creates nothing, so there is no state change to audit.
    if (!data.dryRun) {
      await this.auditService.log({
        organizationId: user.organizationId,
        actorUserId: user.sub,
        actorType: 'admin',
        action: 'admin_created_bar_exam_answer_generation_job',
        entityType: 'bar_exam_answer_generation_job',
        entityId: data.jobId,
        metadata: {
          ip,
          total: data.total,
          filters: {
            questionIds: dto.questionIds?.length ?? null,
            sittingId: dto.sittingId ?? null,
            year: dto.year ?? null,
            subjectCode: dto.subjectCode ?? null,
            onlyMissing: dto.onlyMissing ?? true,
            allMissing: dto.allMissing ?? false,
          },
        },
      });
    }
    return { success: true, data };
  }

  /**
   * Shared audit tail of bulk-approve / bulk-reject.
   *
   * One audit entry per row, all sharing a `bulkOperationId`: the audit log
   * is per-entity by design (`entity_id` is the answer), and a single summary
   * row would make "who approved this answer" unanswerable for every row in
   * the batch. The shared id is what stitches them back into one action.
   */
  private async finishBulk(
    action: 'approve' | 'reject',
    outcome: { result: BulkReviewResult; matchedIds: string[] },
    user: JwtPayload,
    ip: string,
    scope: Record<string, unknown>,
  ): Promise<{ success: true; data: BulkReviewResult }> {
    const { result, matchedIds } = outcome;

    if (!result.dryRun && matchedIds.length > 0) {
      const entries = matchedIds.map((id) => ({
        organizationId: user.organizationId,
        actorUserId: user.sub,
        actorType: 'admin' as const,
        action:
          action === 'approve'
            ? 'admin_bulk_approved_bar_exam_answer'
            : 'admin_bulk_rejected_bar_exam_answer',
        entityType: 'bar_exam_answer',
        entityId: id,
        metadata: {
          ip,
          bulkOperationId: result.bulkOperationId,
          ...scope,
        },
      }));
      for (const wave of chunked(entries, AUDIT_CONCURRENCY)) {
        await Promise.all(wave.map((entry) => this.auditService.log(entry)));
      }
    }

    return { success: true, data: result };
  }
}
