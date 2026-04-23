import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TrackEvent } from '../analytics';
import { AuditService } from '../audit/audit.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { DigestsService } from './digests.service';
import {
  BatchDigestsQueryDto,
  CreateDigestDto,
  CreateProvenanceDto,
  GenerateDigestDto,
  GenerateOnDemandDto,
  ListDigestsQueryDto,
  SearchDigestsQueryDto,
  UpdateDigestDto,
} from './dto';

/**
 * Digests controller — all endpoints require authentication.
 * Tenant scoping handled at service layer via organizationId from JWT.
 * MfaGuard not applied: regular users (member, student) can manage their own digests.
 * Subscription-based quotas for digest generation handled at service layer.
 */
@ApiTags('Digests')
@Controller('digests')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DigestsController {
  constructor(
    private readonly digestsService: DigestsService,
    private readonly auditService: AuditService,
    private readonly usageQuota: UsageQuotaService,
  ) {}

  @Post('by-documents')
  @ApiOperation({ summary: 'Get digests by legal document IDs (batch lookup)' })
  async findByDocuments(
    @Body() dto: BatchDigestsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const digests = await this.digestsService.findByDocumentIds(
      dto.legalDocumentIds,
      user.sub,
      user.organizationId,
    );
    return { success: true, data: digests };
  }

  @Post('by-documents/count')
  @ApiOperation({ summary: 'Count digests matching a set of legal document IDs' })
  async countByDocuments(
    @Body() dto: BatchDigestsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const count = await this.digestsService.countByDocumentIds(
      dto.legalDocumentIds,
      user.sub,
      user.organizationId,
    );
    return { success: true, data: { count } };
  }

  @Post('generate')
  @ApiOperation({ summary: 'Trigger digest generation from a legal document' })
  @TrackEvent('digest_generated', (req, res) => {
    const response = res.data as Record<string, unknown> | undefined;
    const digest = response?.['data'] as Record<string, unknown> | undefined;
    return {
      source_origin: (req.body?.sourceOrigin as string) ?? 'unknown',
      document_type: (req.body?.digestType as string) ?? 'general',
      confidence_score: (digest?.['confidenceScore'] as number) ?? 0,
      generation_time_ms: 0,
    };
  })
  async generate(
    @Body() dto: GenerateDigestDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const digest = await this.digestsService.triggerGeneration(
      dto,
      user.sub,
      user.organizationId,
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'digest.generate',
      entityType: 'digest',
      entityId: digest.id,
      metadata: { ip, legalDocumentId: dto.legalDocumentId, digestType: dto.digestType },
    });
    return { success: true, data: digest };
  }

  @Post()
  @ApiOperation({ summary: 'Create a digest manually' })
  @TrackEvent('digest_saved', (req) => ({
    digest_type: (req.body?.digestType as string) ?? 'manual',
    visibility: (req.body?.visibility as string) ?? 'private',
  }))
  async create(
    @Body() dto: CreateDigestDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const digest = await this.digestsService.create(
      dto,
      user.sub,
      user.organizationId,
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'digest.create',
      entityType: 'digest',
      entityId: digest.id,
      metadata: { ip, sourceOrigin: dto.sourceOrigin, digestType: dto.digestType },
    });
    return { success: true, data: digest };
  }

  @Get()
  @ApiOperation({ summary: 'List digests with cursor pagination and filters' })
  async list(
    @Query() query: ListDigestsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.digestsService.list(
      user.sub,
      user.organizationId,
      query,
    );
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get('search')
  @ApiOperation({
    summary:
      'Search approved public-editorial digests; returns matchedDocuments for on-demand generation when empty',
  })
  async search(@Query() query: SearchDigestsQueryDto) {
    const { results, hasMore, cursor, matchedDocuments } =
      await this.digestsService.search(query);
    return {
      success: true,
      data: { results, hasMore, cursor, matchedDocuments },
    };
  }

  @Post('generate-on-demand')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ApiOperation({
    summary:
      'On-demand case digest generation — gated on active subscription, monthly quota, and a 5/hour/user rate limit',
  })
  @TrackEvent('digest_generate_on_demand', (req) => ({
    legal_document_id: (req.body?.legalDocumentId as string) ?? 'unknown',
  }))
  async generateOnDemand(
    @Body() dto: GenerateOnDemandDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    // Subscription + quota gate. We call checkAndIncrement up-front: its
    // allowed=false branch handles both "no active subscription" (limit=0)
    // and "active subscription but quota exceeded" (used>=limit). We
    // disambiguate for the caller via the response body so the web can
    // route to /pricing vs. "comes back on <date>".
    const quota = await this.usageQuota.checkAndIncrement(
      user.organizationId,
      user.sub,
      'digestsPerMonth',
    );

    if (!quota.allowed) {
      if (quota.limit === 0) {
        throw new HttpException(
          {
            success: false,
            error: 'subscription_required',
            upgradeUrl: '/pricing',
            message: 'An active subscription is required to generate digests on demand.',
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }

      throw new HttpException(
        {
          success: false,
          error: 'quota_exceeded',
          resetAt: quota.resetsAt,
          currentUsage: quota.used,
          limit: quota.limit,
          message: 'Monthly digest generation quota exceeded.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const job = await this.digestsService.generateOnDemand(
      dto.legalDocumentId,
      user.sub,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'digest.generate_on_demand',
      entityType: 'derivative_generation_job',
      entityId: job.jobId,
      metadata: { ip, legalDocumentId: dto.legalDocumentId },
    });

    return {
      success: true,
      data: job,
      meta: {
        quota: { used: quota.used, limit: quota.limit, remaining: quota.remaining },
      },
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a digest by ID' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const digest = await this.digestsService.findById(
      id,
      user.sub,
      user.organizationId,
    );
    return { success: true, data: digest };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a digest' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDigestDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const digest = await this.digestsService.update(
      id,
      dto,
      user.sub,
      user.organizationId,
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'digest.update',
      entityType: 'digest',
      entityId: id,
      metadata: { ip, changes: Object.keys(dto) },
    });
    return { success: true, data: digest };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a digest' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.digestsService.delete(id, user.sub, user.organizationId);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'digest.delete',
      entityType: 'digest',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Digest deleted' } };
  }

  @Get(':id/provenance')
  @ApiOperation({ summary: 'Get provenance records for a digest' })
  async getProvenance(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    // Verify access to the digest first
    await this.digestsService.findById(id, user.sub, user.organizationId);
    const records = await this.digestsService.getProvenanceRecords(id);
    return { success: true, data: records };
  }

  @Post(':id/provenance')
  @ApiOperation({ summary: 'Add provenance records to a digest' })
  async addProvenance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() records: CreateProvenanceDto[],
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    // Verify access to the digest first
    await this.digestsService.findById(id, user.sub, user.organizationId);

    // Ensure all records reference this digest
    const normalizedRecords = records.map((r) => ({
      ...r,
      entityType: 'digest' as const,
      entityId: id,
    }));

    const result = await this.digestsService.createProvenanceRecords(normalizedRecords);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'digest.provenance.create',
      entityType: 'digest',
      entityId: id,
      metadata: { ip, recordCount: records.length },
    });
    return { success: true, data: result };
  }

  @Post(':id/compute-confidence')
  @ApiOperation({ summary: 'Recompute confidence score for a digest' })
  async computeConfidence(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    // Verify access
    await this.digestsService.findById(id, user.sub, user.organizationId);
    const digest = await this.digestsService.updateConfidenceScore(id);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'digest.confidence.recompute',
      entityType: 'digest',
      entityId: id,
      metadata: { ip, confidenceScore: digest.confidenceScore, reviewStatus: digest.reviewStatus },
    });
    return { success: true, data: digest };
  }
}
