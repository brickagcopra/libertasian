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
import { SearchService } from './search.service';
import { CitationSearchDto, SearchQueryDto, SuggestionQueryDto } from './dto';

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
  ) {}

  @Post()
  @ApiOperation({ summary: 'Natural language search across legal documents' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @TrackEvent('search_executed', (req, res) => {
    const response = res.data as Record<string, unknown> | undefined;
    const meta = response?.meta as Record<string, unknown> | undefined;
    const total = (meta?.total as number) ?? 0;
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
    );
    if (!quota.allowed) {
      throw new ForbiddenException({
        message: 'Search query quota exceeded',
        quota: { used: quota.used, limit: quota.limit, resetsAt: quota.resetsAt },
      });
    }

    const result = await this.searchService.search(dto);

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
  @ApiOperation({ summary: 'Exact citation lookup (G.R. No., RA No., etc.)' })
  async searchByCitation(@Param() params: CitationSearchDto) {
    const result = await this.searchService.searchByCitation(params.citation);
    return { success: true, data: result.items, meta: { total: result.total } };
  }

  @Get('suggestions')
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
   */
  @Post('internal/index/:id')
  @ApiOperation({ summary: 'Index a document (internal service-to-service)' })
  @UseGuards(InternalApiGuard)
  async internalIndexDocument(@Param('id') documentId: string) {
    this.logger.log(
      `Internal index request for document ${documentId}`,
    );
    await this.searchService.indexLegalDocument(documentId);
    return { success: true, data: { message: `Document ${documentId} indexed` } };
  }
}
