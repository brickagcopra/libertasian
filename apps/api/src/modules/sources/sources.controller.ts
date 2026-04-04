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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
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
import { BarSubjectCategorizerService } from '../study/bar-subject-categorizer.service';
import { SourcesService } from './sources.service';
import {
  CreateSourceDto,
  UpdateSourceDto,
  CreateSourceEndpointDto,
  UpdateSourceEndpointDto,
  StalenessQueryDto,
  CoverageGapQueryDto,
  IngestionTrendsQueryDto,
  IngestionDashboardQueryDto,
  IngestionCandidatesQueryDto,
  IngestionJobHistoryQueryDto,
} from './dto';

/**
 * Admin sources controller — MFA enforced for admin/editor roles.
 * Rate limited to 100 requests per minute per CLAUDE.md.
 */
@ApiTags('Admin — Sources')
@Controller('admin')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions({ permissions: ['sources:read', 'admin:ingestion'], mode: 'any' })
@Throttle({ default: { ttl: 60000, limit: 100 } }) // 100 req/min for admin endpoints
@ApiBearerAuth()
export class SourcesController {
  constructor(
    private readonly sourcesService: SourcesService,
    private readonly auditService: AuditService,
    private readonly barSubjectCategorizer: BarSubjectCategorizerService,
  ) {}

  // ---- Source Registry ----

  @Get('sources')
  @ApiOperation({ summary: 'List all sources in the registry' })
  async listSources() {
    const sources = await this.sourcesService.list();
    return { success: true, data: sources };
  }

  @Get('sources/:id')
  @ApiOperation({ summary: 'Get source details with endpoints' })
  async getSource(@Param('id', ParseUUIDPipe) id: string) {
    const source = await this.sourcesService.findById(id);
    return { success: true, data: source };
  }

  @Post('sources')
  @ApiOperation({ summary: 'Register a new source' })
  async createSource(
    @Body() dto: CreateSourceDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const source = await this.sourcesService.create(dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'source.create',
      entityType: 'source',
      entityId: source.id,
      metadata: { ip, name: dto.name, type: dto.type },
    });
    return { success: true, data: source };
  }

  @Patch('sources/:id')
  @ApiOperation({ summary: 'Update a source configuration' })
  async updateSource(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSourceDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const source = await this.sourcesService.update(id, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'source.update',
      entityType: 'source',
      entityId: id,
      metadata: { ip, changes: Object.keys(dto) },
    });
    return { success: true, data: source };
  }

  // ---- Source Endpoints ----

  @Post('sources/:id/endpoints')
  @ApiOperation({ summary: 'Add an endpoint to a source' })
  async createEndpoint(
    @Param('id', ParseUUIDPipe) sourceId: string,
    @Body() dto: CreateSourceEndpointDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const endpoint = await this.sourcesService.createEndpoint(sourceId, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'source.endpoint_create',
      entityType: 'source_endpoint',
      entityId: endpoint.id,
      metadata: { ip, sourceId, parserType: dto.parserType },
    });
    return { success: true, data: endpoint };
  }

  @Patch('sources/:id/endpoints/:endpointId')
  @ApiOperation({ summary: 'Update a source endpoint' })
  async updateEndpoint(
    @Param('id', ParseUUIDPipe) sourceId: string,
    @Param('endpointId', ParseUUIDPipe) endpointId: string,
    @Body() dto: UpdateSourceEndpointDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const endpoint = await this.sourcesService.updateEndpoint(sourceId, endpointId, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'source.endpoint_update',
      entityType: 'source_endpoint',
      entityId: endpointId,
      metadata: { ip, sourceId, changes: Object.keys(dto) },
    });
    return { success: true, data: endpoint };
  }

  @Delete('sources/:id/endpoints/:endpointId')
  @ApiOperation({ summary: 'Remove a source endpoint' })
  async deleteEndpoint(
    @Param('id', ParseUUIDPipe) sourceId: string,
    @Param('endpointId', ParseUUIDPipe) endpointId: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.sourcesService.deleteEndpoint(sourceId, endpointId);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'source.endpoint_delete',
      entityType: 'source_endpoint',
      entityId: endpointId,
      metadata: { ip, sourceId },
    });
    return { success: true, data: { message: 'Endpoint deleted' } };
  }

  // ---- Manual Fetch Trigger ----

  @Post('sources/:id/fetch')
  @ApiOperation({ summary: 'Trigger a manual fetch job for a source' })
  async triggerFetch(
    @Param('id', ParseUUIDPipe) sourceId: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const job = await this.sourcesService.createIngestionJob(sourceId);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'source.fetch_triggered',
      entityType: 'ingestion_job',
      entityId: job.id,
      metadata: { ip, sourceId },
    });
    return { success: true, data: job };
  }

  // ---- Ingestion Jobs ----

  @Get('ingestion-jobs')
  @ApiOperation({ summary: 'List recent ingestion jobs' })
  async listIngestionJobs(
    @Query('sourceId') sourceId?: string,
  ) {
    const jobs = await this.sourcesService.listIngestionJobs(sourceId);
    return { success: true, data: jobs };
  }

  // ---- Ingestion Pipeline Dashboard ----

  @Get('ingestion/dashboard')
  @ApiOperation({ summary: 'Get ingestion pipeline stats (total jobs, success rate, avg duration, document counts)' })
  async getIngestionDashboard(@Query() query: IngestionDashboardQueryDto) {
    const stats = await this.sourcesService.getIngestionPipelineStats(query.period);
    return { success: true, data: stats };
  }

  @Get('ingestion/jobs')
  @ApiOperation({ summary: 'Paginated ingestion job history with filters' })
  async getIngestionJobHistory(@Query() query: IngestionJobHistoryQueryDto) {
    const result = await this.sourcesService.getIngestionJobHistory(query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get('ingestion/jobs/:id/candidates')
  @ApiOperation({ summary: 'List candidates for a specific ingestion job with dedup classification' })
  async getIngestionCandidates(
    @Param('id', ParseUUIDPipe) jobId: string,
    @Query() query: IngestionCandidatesQueryDto,
  ) {
    const result = await this.sourcesService.getIngestionCandidatesByJob(jobId, query.cursor);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get('ingestion/endpoints')
  @ApiOperation({ summary: 'All source endpoints with health info and recent job history' })
  async getSourceEndpointStatus() {
    const endpoints = await this.sourcesService.getSourceEndpointStatus();
    return { success: true, data: endpoints };
  }

  // ---- Review Queue ----

  @Get('review-queue')
  @ApiOperation({ summary: 'List digests pending editorial review' })
  async getReviewQueue(
    @Query('cursor') cursor?: string,
  ) {
    const result = await this.sourcesService.getReviewQueue(cursor);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Post('review-queue/:id/approve')
  @ApiOperation({ summary: 'Approve a digest in the review queue' })
  async approveDigest(
    @Param('id', ParseUUIDPipe) digestId: string,
    @Body('notes') notes: string | undefined,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.sourcesService.approveDigest(digestId, user.sub, notes);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'digest.approve',
      entityType: 'digest',
      entityId: digestId,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Digest approved' } };
  }

  @Post('review-queue/:id/reject')
  @ApiOperation({ summary: 'Reject a digest in the review queue' })
  async rejectDigest(
    @Param('id', ParseUUIDPipe) digestId: string,
    @Body('notes') notes: string | undefined,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.sourcesService.rejectDigest(digestId, user.sub, notes);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'digest.reject',
      entityType: 'digest',
      entityId: digestId,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Digest rejected' } };
  }

  // ---- Editorial Flags ----

  @Get('editorial-flags')
  @ApiOperation({ summary: 'List editorial flags' })
  async listEditorialFlags(
    @Query('status') status?: string,
  ) {
    const flags = await this.sourcesService.listEditorialFlags(status);
    return { success: true, data: flags };
  }

  // ---- Corpus Health ----

  @Get('corpus-health')
  @ApiOperation({ summary: 'Get corpus health metrics' })
  async getCorpusHealth() {
    const health = await this.sourcesService.getCorpusHealth();
    return { success: true, data: health };
  }

  // ---- Source Health ----

  @Get('sources/health')
  @ApiOperation({ summary: 'Get health reports for all enabled sources' })
  async getAllSourceHealth() {
    const reports = await this.sourcesService.computeAllSourceHealth();
    return { success: true, data: reports };
  }

  @Get('sources/:id/health')
  @ApiOperation({ summary: 'Get health report for a single source (cached 1hr or recomputed)' })
  async getSourceHealth(@Param('id', ParseUUIDPipe) id: string) {
    const report = await this.sourcesService.getSourceHealthReport(id);
    return { success: true, data: report };
  }

  @Post('sources/health/recompute')
  @ApiOperation({ summary: 'Recompute health scores for all enabled sources' })
  async recomputeAllSourceHealth(
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const reports = await this.sourcesService.computeAllSourceHealth();
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'source.health_recompute_all',
      entityType: 'source',
      entityId: undefined,
      metadata: { ip, sourcesProcessed: reports.length },
    });
    return { success: true, data: reports };
  }

  @Post('sources/:id/health/recompute')
  @ApiOperation({ summary: 'Recompute health score for a single source' })
  async recomputeSourceHealth(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const report = await this.sourcesService.computeSourceHealth(id);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'source.health_recompute',
      entityType: 'source',
      entityId: id,
      metadata: { ip, healthScore: report.healthScore },
    });
    return { success: true, data: report };
  }

  @Get('coverage-gaps')
  @ApiOperation({ summary: 'Coverage gap analysis by document type, court, and tag' })
  async getCoverageGaps() {
    const gaps = await this.sourcesService.getCoverageGapAnalysis();
    return { success: true, data: gaps };
  }

  @Get('staleness-report')
  @ApiOperation({ summary: 'Sources that have not been fetched recently' })
  async getStalenessReport(@Query() query: StalenessQueryDto) {
    const report = await this.sourcesService.getStalenessReport(query.staleDays);
    return { success: true, data: report };
  }

  // ---- Enhanced Coverage Gap Analysis ----

  @Get('coverage-gaps/enhanced')
  @ApiOperation({ summary: 'Filtered coverage gap analysis with gap scoring' })
  async getEnhancedCoverageGaps(@Query() query: CoverageGapQueryDto) {
    const data = await this.sourcesService.getEnhancedCoverageGapAnalysis(query);
    return { success: true, data };
  }

  @Get('coverage-gaps/bar-subjects')
  @ApiOperation({ summary: 'Bar subject coverage scores for all 8+ bar exam subjects' })
  async getBarSubjectCoverage() {
    const data = await this.sourcesService.getBarSubjectCoverage();
    return { success: true, data };
  }

  @Get('coverage-gaps/trends')
  @ApiOperation({ summary: 'Ingestion velocity trends over time' })
  async getIngestionTrends(@Query() query: IngestionTrendsQueryDto) {
    const data = await this.sourcesService.getIngestionTrends(query);
    return { success: true, data };
  }

  @Get('coverage-gaps/source/:id')
  @ApiOperation({ summary: 'Source-level gap drilldown by document type and court' })
  async getSourceGapDrilldown(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.sourcesService.getSourceLevelGapDrilldown(id);
    return { success: true, data };
  }

  @Get('coverage-gaps/export')
  @ApiOperation({ summary: 'Export coverage gap data as CSV or JSON' })
  async exportCoverageGaps(
    @Query() query: CoverageGapQueryDto,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    const fmt = format === 'json' ? 'json' : 'csv';
    const result = await this.sourcesService.exportCoverageGaps(query, fmt);
    const ext = fmt === 'json' ? 'json' : 'csv';
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="coverage-gaps.${ext}"`);
    res.send(result.data);
  }

  // ---- Bar Subject Categorization ----

  @Post('categorize-bar-subjects')
  @ApiOperation({
    summary: 'Run batch bar subject categorization on untagged documents',
    description:
      'Uses rule-based keyword matching to assign bar subject tags to published documents ' +
      'that have no bar subject tags yet. Processes up to batchSize documents per call.',
  })
  async categorizeBarSubjects(
    @Body('batchSize') batchSize: number | undefined,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.barSubjectCategorizer.categorizeBatch(batchSize ?? 500);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'corpus.categorize_bar_subjects',
      entityType: 'legal_document',
      entityId: undefined,
      metadata: {
        ip,
        batchSize: batchSize ?? 500,
        processed: result.processed,
        tagged: result.tagged,
        skipped: result.skipped,
        tagCounts: result.tagCounts,
      },
    });
    return { success: true, data: result };
  }
}
