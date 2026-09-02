import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import type { JwtPayload } from '@libertasian/types';
import { AuditService } from '../audit/audit.service';
import {
  ListRunDocumentsQueryDto,
  ListVectorBackfillRunsQueryDto,
  StartVectorBackfillDto,
  VectorBackfillGapQueryDto,
} from './dto';
import { VectorBackfillService } from './vector-backfill.service';

/**
 * Admin control surface for the vector-index backfill.
 *
 * Guarded exactly like the other admin search endpoints
 * (`JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard` +
 * `admin:ingestion`) and audit-logged on every state change. Reads are guarded
 * too: the gap report is a map of which parts of the corpus are unsearchable by
 * kNN, which is operational detail, not public information.
 */
@ApiTags('Admin — Vector Backfill')
@Controller('admin/vector-backfill')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions('admin:ingestion')
@Throttle({ default: { ttl: 60_000, limit: 100 } })
@ApiBearerAuth()
export class VectorBackfillController {
  constructor(
    private readonly backfill: VectorBackfillService,
    private readonly auditService: AuditService,
  ) {}

  @Get('gap')
  @ApiOperation({
    summary: 'Measure the vector-index gap without embedding anything',
    description:
      'Diffs the chunks legal_document_sections implies against the ids ' +
      'present in legal_documents_vector and reports the shortfall per ' +
      'document_type. Read-only: it starts no job and writes no run row.',
  })
  async getGap(@Query() query: VectorBackfillGapQueryDto) {
    const report = await this.backfill.enumerateGap({
      documentTypes: query.documentTypes,
      maxDocuments: query.maxDocuments,
    });
    return { success: true, data: report };
  }

  @Post('runs')
  @ApiOperation({
    summary: 'Start a vector-index backfill run',
    description:
      'Enqueues a single-concurrency job that embeds only the missing chunks, ' +
      'in priority order. Pass dryRun to enumerate and record the gap without ' +
      'calling the embedding service.',
  })
  async startRun(
    @Body() dto: StartVectorBackfillDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const run = await this.backfill.enqueueRun({
      dryRun: dto.dryRun,
      documentTypes: dto.documentTypes,
      batchSize: dto.batchSize,
      batchDelayMs: dto.batchDelayMs,
      maxDocuments: dto.maxDocuments,
      triggeredByUserId: user.sub,
      organizationId: user.organizationId,
    });

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'search.vector_backfill.requested',
      entityType: 'vector_backfill_run',
      entityId: run.id,
      metadata: {
        jobId: run.jobId,
        dryRun: run.dryRun,
        documentTypes: run.documentTypes,
        batchSize: run.batchSize,
        batchDelayMs: run.batchDelayMs,
        maxDocuments: run.maxDocuments,
      },
    });

    return { success: true, data: run };
  }

  @Get('runs')
  @ApiOperation({ summary: 'List recent vector backfill runs' })
  async listRuns(@Query() query: ListVectorBackfillRunsQueryDto) {
    return { success: true, data: await this.backfill.listRuns(query.limit) };
  }

  @Get('runs/:runId')
  @ApiOperation({ summary: 'Status and progress of one vector backfill run' })
  async getRun(@Param('runId', ParseUUIDPipe) runId: string) {
    return { success: true, data: await this.backfill.getRun(runId) };
  }

  @Get('runs/:runId/documents')
  @ApiOperation({
    summary: 'Per-document outcomes for a run',
    description:
      'indexed / skipped-with-reason / failed-with-reason, cursor-paginated. ' +
      'Filter by ?status=failed to see only what needs another pass.',
  })
  async listRunDocuments(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Query() query: ListRunDocumentsQueryDto,
  ) {
    return {
      success: true,
      data: await this.backfill.listRunDocuments(runId, {
        status: query.status,
        cursor: query.cursor,
        limit: query.limit,
      }),
    };
  }

  @Post('runs/:runId/pause')
  @ApiOperation({
    summary: 'Ask a running backfill to stop after the current batch',
    description:
      'The job re-reads the signal between batches, finishes the batch it is ' +
      'holding, records what landed, and exits as `paused`.',
  })
  async pauseRun(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const run = await this.backfill.signal(runId, 'pause');
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'search.vector_backfill.pause_requested',
      entityType: 'vector_backfill_run',
      entityId: runId,
      metadata: { jobId: run.jobId },
    });
    return { success: true, data: run };
  }

  @Post('runs/:runId/cancel')
  @ApiOperation({ summary: 'Stop a running backfill and mark it cancelled' })
  async cancelRun(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const run = await this.backfill.signal(runId, 'cancel');
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'search.vector_backfill.cancel_requested',
      entityType: 'vector_backfill_run',
      entityId: runId,
      metadata: { jobId: run.jobId },
    });
    return { success: true, data: run };
  }

  @Post('runs/:runId/resume')
  @ApiOperation({
    summary: 'Start a new run carrying a stopped run\'s options',
    description:
      'Resuming re-enumerates the gap, so the new run picks up exactly the ' +
      'remainder — there is no stored cursor to go stale.',
  })
  async resumeRun(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const run = await this.backfill.resume(runId, {
      userId: user.sub,
      organizationId: user.organizationId,
    });
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'search.vector_backfill.resumed',
      entityType: 'vector_backfill_run',
      entityId: run.id,
      metadata: { jobId: run.jobId, resumedFrom: runId },
    });
    return { success: true, data: run };
  }
}
