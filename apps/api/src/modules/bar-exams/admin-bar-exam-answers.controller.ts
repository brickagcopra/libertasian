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
  type AdminBarExamAnswerDetail,
  type DispatchResult,
  type ListResult,
} from './admin-bar-exam-answers.service';
import {
  DispatchAnswerGenerationDto,
  ListBarExamAnswersQueryDto,
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
      'List bar exam AI answers, filterable by review status. Default ' +
      'returns pending oldest-first (queue order).',
  })
  async list(
    @Query() query: ListBarExamAnswersQueryDto,
  ): Promise<{ success: true; data: ListResult }> {
    const data = await this.service.listAnswers({
      reviewStatus: query.reviewStatus,
      cursor: query.cursor,
      limit: query.limit,
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

  @Post('dispatch-generation')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary:
      'Resolve filters → up to 50 question ids → dispatch the Celery ' +
      'generation task. Truncates silently above the cap; the response ' +
      'flags whether truncation occurred so the UI can warn.',
  })
  async dispatch(
    @Body() dto: DispatchAnswerGenerationDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ): Promise<{ success: true; data: DispatchResult }> {
    const data = await this.service.dispatchGeneration(dto);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'admin_dispatched_bar_exam_answer_generation',
      entityType: 'celery_task',
      entityId: data.taskId,
      metadata: {
        ip,
        taskName: data.taskName,
        questionCount: data.questionCount,
        truncated: data.truncated,
        filters: {
          questionIds: dto.questionIds ?? null,
          sittingId: dto.sittingId ?? null,
          year: dto.year ?? null,
          subjectCode: dto.subjectCode ?? null,
        },
      },
    });
    return { success: true, data };
  }
}
