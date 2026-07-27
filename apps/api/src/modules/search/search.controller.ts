import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { InternalApiGuard } from '../../common/guards/internal-api.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TrackEvent } from '../analytics';
import { AuditService } from '../audit/audit.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { IndexRebuildService } from './index-rebuild.service';
import { SearchService } from './search.service';
import {
  CitationSearchDto,
  IndexRebuildDto,
  IndexRollbackDto,
  SearchQueryDto,
  SuggestionQueryDto,
} from './dto';

/**
 * Search controller.
 * POST /search requires authentication (search queries are audit-logged).
 * GET /citation and /suggestions are public (open access to corpus discovery).
 * POST /index/* endpoints require JwtAuthGuard + MfaGuard + RolesGuard (admin/editor).
 */
@ApiTags('Search')
@Controller('search')
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(
    private readonly searchService: SearchService,
    private readonly auditService: AuditService,
    private readonly usageQuota: UsageQuotaService,
    private readonly indexRebuild: IndexRebuildService,
  ) {}

  @Post()
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: 'Natural language search across legal documents' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @TrackEvent('search_executed', (req, res) => {
    const response = res.data as Record<string, unknown> | undefined;
    const meta = response?.['meta'] as Record<string, unknown> | undefined;
    const total = (meta?.['total'] as number) ?? 0;
    return {
      query_length: (req.body?.query as string)?.length ?? 0,
      search_type: (req.body?.mode as string) ?? 'search',
      result_count: total,
      has_zero_results: total === 0,
    };
  })
  async search(
    @Body() dto: SearchQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    // Enforce plan-based search query quota
    const quota = await this.usageQuota.checkAndIncrement(
      user.organizationId,
      user.sub,
      'searchQueries',
      { isPlatformAdmin: user.isPlatformAdmin === true },
    );
    if (!quota.allowed) {
      throw new ForbiddenException({
        message: 'Search query quota exceeded',
        quota: { used: quota.used, limit: quota.limit, resetsAt: quota.resetsAt },
      });
    }

    // The derivative visibility filter's principal comes from the VERIFIED JWT
    // claims and nowhere else. `dto` is never consulted for identity: a
    // body-supplied organization id would let any caller read any tenant's
    // derivatives. This route is behind JwtAuthGuard, so a caller always exists
    // — an unauthenticated route would pass `null` and get the public branch,
    // never skip the filter.
    const result = await this.searchService.search(dto, {
      organizationId: user.organizationId,
    });

    // Log search for analytics (non-blocking)
    this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'search.query',
      entityType: 'search',
      metadata: {
        query: dto.query,
        resultCount: result.meta.total,
        mode: dto.mode ?? 'search',
      },
    });

    return {
      success: true,
      data: result.items,
      meta: {
        ...result.meta,
        quota: { used: quota.used, limit: quota.limit, remaining: quota.remaining },
      },
    };
  }

  @Get('citation/:citation')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: 'Exact citation lookup (G.R. No., RA No., etc.)' })
  async searchByCitation(@Param() params: CitationSearchDto) {
    const result = await this.searchService.searchByCitation(params.citation);
    return { success: true, data: result.items, meta: { total: result.total } };
  }

  @Get('suggestions')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: 'Search suggestions / autocomplete' })
  async getSuggestions(@Query() query: SuggestionQueryDto) {
    const suggestions = await this.searchService.getSuggestions(
      query.q,
      query.limit ?? 10,
    );
    return { success: true, data: suggestions };
  }

  @Post('index/initialize')
  @ApiOperation({ summary: 'Initialize OpenSearch indexes (admin only)' })
  @UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
  @RequiredPermissions('admin:ingestion')
  @ApiBearerAuth()
  async initializeIndexes(@CurrentUser() user: JwtPayload) {
    const result = await this.searchService.initializeIndexes();
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'search.index.initialize',
      entityType: 'search_index',
    });
    return { success: true, data: result };
  }

  @Get('index/topology')
  @ApiOperation({
    summary: 'Show which physical index each search alias resolves to (admin only)',
  })
  @UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
  @RequiredPermissions('admin:ingestion')
  @ApiBearerAuth()
  async getIndexTopology() {
    return { success: true, data: await this.indexRebuild.describeTopology() };
  }

  @Post('index/rebuild')
  @ApiOperation({
    summary:
      'Rebuild the OpenSearch indices from PostgreSQL and swap the aliases (admin only)',
  })
  @UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
  @RequiredPermissions('admin:ingestion')
  @ApiBearerAuth()
  async rebuildIndexes(
    @Body() dto: IndexRebuildDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const { jobId } = await this.indexRebuild.enqueueRebuild({
      triggeredByUserId: user.sub,
      organizationId: user.organizationId,
      dryRun: dto.dryRun === true,
    });
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'search.index.rebuild_requested',
      entityType: 'search_index',
      entityId: jobId,
      metadata: { jobId, dryRun: dto.dryRun === true },
    });
    return { success: true, data: { jobId, dryRun: dto.dryRun === true } };
  }

  @Get('index/rebuild/:jobId')
  @ApiOperation({ summary: 'Progress of a search index rebuild job (admin only)' })
  @UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
  @RequiredPermissions('admin:ingestion')
  @ApiBearerAuth()
  async getRebuildStatus(@Param('jobId') jobId: string) {
    return { success: true, data: await this.indexRebuild.getJobStatus(jobId) };
  }

  @Post('index/rollback')
  @ApiOperation({
    summary: 'Repoint a search alias at a previous physical index (admin only)',
  })
  @UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
  @RequiredPermissions('admin:ingestion')
  @ApiBearerAuth()
  async rollbackIndex(
    @Body() dto: IndexRollbackDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.indexRebuild.rollbackAlias(dto.alias, dto.targetIndex);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'search.index.rollback',
      entityType: 'search_index',
      entityId: dto.alias,
      metadata: { ...result },
    });
    return { success: true, data: result };
  }

  @Post('index/document/:id')
  @ApiOperation({ summary: 'Index a single document into OpenSearch (admin only)' })
  @UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
  @RequiredPermissions('admin:ingestion')
  @ApiBearerAuth()
  async indexDocument(
    @Param('id') documentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.searchService.indexLegalDocument(documentId);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'search.index.document',
      entityType: 'legal_document',
      entityId: documentId,
    });
    return { success: true, data: { message: `Document ${documentId} indexed` } };
  }

  @Post('index/bulk')
  @ApiOperation({ summary: 'Bulk index documents into OpenSearch (admin only)' })
  @UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
  @RequiredPermissions('admin:ingestion')
  @ApiBearerAuth()
  async bulkIndex(
    @Body() body: { documentIds: string[] },
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.searchService.bulkIndexDocuments(body.documentIds);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'search.index.bulk',
      entityType: 'search_index',
      metadata: { ...result },
    });
    return { success: true, data: result };
  }

  /**
   * Internal endpoint for worker-service to trigger OpenSearch indexing
   * after auto-publish. Authenticated via X-Internal-Api-Key (no JWT).
   *
   * `@SkipThrottle()` — this is a service-to-service call, not user traffic,
   * and it is keyed by the worker container's IP, so a bulk publish run puts
   * every document through one bucket. The #322 backfill sustained 250–350
   * calls/min against the 300/min general bucket: 5,220 of 11,561 triggers
   * came back 429, and the worker's client discarded them with no retry, so
   * those documents went live in PostgreSQL and stayed unsearchable. A 429
   * here is silent data loss rather than backpressure, because the caller has
   * already committed the publish. The route stays protected by
   * `InternalApiGuard` (X-Internal-Api-Key), same reasoning as the
   * class-level `@SkipThrottle()` on `InternalDerivativesController`.
   */
  @Post('internal/index/:id')
  @ApiOperation({ summary: 'Index a document (internal service-to-service)' })
  @SkipThrottle()
  @UseGuards(InternalApiGuard)
  async internalIndexDocument(@Param('id') documentId: string) {
    this.logger.log(
      `Internal index request for document ${documentId}`,
    );
    await this.searchService.indexLegalDocument(documentId);
    return { success: true, data: { message: `Document ${documentId} indexed` } };
  }
}
