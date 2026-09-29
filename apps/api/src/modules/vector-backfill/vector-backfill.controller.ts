import {
  BadRequestException,
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
import { RequiredPlatformPermissions } from '../../common/decorators/platform-permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { PlatformPermissionsGuard } from '../../common/guards/platform-permissions.guard';
import { optionalOrganizationId } from '../../common/utils/optional-organization-id';
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
 * Guarded exactly like the search index-maintenance endpoints — a PLATFORM
 * route: `JwtAuthGuard, MfaGuard, PlatformPermissionsGuard` + platform
 * `admin:ingestion`, the mechanism /platform/staff and /admin/digests use — and
 * audit-logged on every state change. Reads are guarded too: the gap report is
 * a map of which parts of the corpus are unsearchable by kNN, which is
 * operational detail, not public information.
 *
 * No TenantGuard: platform admins belong to no organization, and TenantGuard
 * 403'd them on "No organization context" before the permission check ran.
 * Nothing here reads `request.tenantContext` or `user.memberId`; the only use
 * of the caller's organization is as an optional label on audit rows and the
 * run row (`optionalOrganizationId`).
 */
@ApiTags('Admin — Vector Backfill')
@Controller('admin/vector-backfill')
@UseGuards(JwtAuthGuard, MfaGuard, PlatformPermissionsGuard)
@RequiredPlatformPermissions('admin:ingestion')
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
    if (dto.force === true && !(dto.documentIds && dto.documentIds.length > 0)) {
      // Refused before anything is enqueued: a corpus-wide forced re-embed is
      // ~4.3 hours of embedding capacity, and "force" without a target list is
      // far more likely a mistake than an intent.
      throw new BadRequestException(
        'force requires documentIds: a forced re-embed is only allowed for an explicit list of documents',
      );
    }
    if (dto.force === true && dto.pruneStale === true) {
      throw new BadRequestException(
        'pruneStale cannot be combined with force: force already deletes stale ids, and re-embeds everything',
      );
    }

    const run = await this.backfill.enqueueRun({
      dryRun: dto.dryRun,
      documentTypes: dto.documentTypes,
      documentIds: dto.documentIds,
      force: dto.force === true,
      pruneStale: dto.pruneStale === true,
      batchSize: dto.batchSize,
      batchDelayMs: dto.batchDelayMs,
      maxDocuments: dto.maxDocuments,
      triggeredByUserId: user.sub,
      organizationId: optionalOrganizationId(user),
    });

    await this.auditService.log({
      organizationId: optionalOrganizationId(user),
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'search.vector_backfill.requested',
      entityType: 'vector_backfill_run',
      entityId: run.id,
      metadata: {
        jobId: run.jobId,
        dryRun: run.dryRun,
        documentTypes: run.documentTypes,
        documentIds: run.documentIds,
        force: run.force,
        pruneStale: run.pruneStale,
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
      organizationId: optionalOrganizationId(user),
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
      organizationId: optionalOrganizationId(user),
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
      organizationId: optionalOrganizationId(user),
    });
    await this.auditService.log({
      organizationId: optionalOrganizationId(user),
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
