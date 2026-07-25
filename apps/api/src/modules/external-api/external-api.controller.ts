import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import {
  ApiKeyAuthGuard,
  TenantGuard,
  SubscriptionGuard,
} from '../../common/guards';
import {
  CurrentUser,
  RequiredApiKeyPermissions,
  RequiredSubscription,
} from '../../common/decorators';
import { SearchService } from '../search/search.service';
import { DocumentsService } from '../documents/documents.service';
import { MemosService } from '../memos/memos.service';
import { ExternalSearchDto, ExternalGenerateMemoDto } from './dto';

/**
 * External API endpoints for Enterprise API key access.
 * All endpoints require a valid X-API-Key header (ApiKeyAuthGuard)
 * and an active Enterprise subscription.
 */
@Controller('external-api')
@UseGuards(ApiKeyAuthGuard, TenantGuard, SubscriptionGuard)
@RequiredSubscription('enterprise')
@Throttle({ default: { limit: 100, ttl: 60000 } })
export class ExternalApiController {
  constructor(
    private readonly searchService: SearchService,
    private readonly documentsService: DocumentsService,
    private readonly memosService: MemosService,
  ) {}

  // ---- Search ----

  @Post('search')
  @RequiredApiKeyPermissions('search')
  async search(
    @Body() dto: ExternalSearchDto,
  ) {
    const result = await this.searchService.search({
      query: dto.query,
      // The external API keeps its single-value contract; SearchQueryDto now
      // models documentType as a multi-select array internally.
      ...(dto.documentType && { documentType: [dto.documentType] }),
      court: dto.court,
      ponente: dto.ponente,
      sourceId: dto.sourceId,
      grNo: dto.grNo,
      dateFrom: dto.dateFrom,
      dateTo: dto.dateTo,
      publishedOnly: dto.publishedOnly,
      page: dto.page,
      limit: dto.limit,
      mode: dto.mode,
    });

    return { success: true, ...result };
  }

  // ---- Documents ----

  @Get('documents/:id')
  @RequiredApiKeyPermissions('documents:read')
  async getDocument(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const doc = await this.documentsService.findById(id);
    return {
      success: true,
      data: {
        id: doc.id,
        title: doc.title,
        shortTitle: doc.shortTitle,
        citationText: doc.citationText,
        grNo: doc.grNo,
        documentType: doc.documentType,
        court: doc.court,
        decisionDate: doc.decisionDate,
        ponente: doc.ponente,
        status: doc.status,
        source: doc.source,
      },
    };
  }

  @Get('documents/:id/sections')
  @RequiredApiKeyPermissions('documents:read')
  async getDocumentSections(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const sections = await this.documentsService.listSections(id);
    return { success: true, data: sections };
  }

  // ---- Memos ----

  @Post('memos')
  @RequiredApiKeyPermissions('memos:generate')
  async generateMemo(
    @CurrentUser() user: { sub: string; organizationId: string },
    @Body() dto: ExternalGenerateMemoDto,
  ) {
    const memo = await this.memosService.triggerGeneration(
      {
        query: dto.query,
        memoType: dto.memoType,
        matterId: dto.matterId,
      },
      user.sub,
      user.organizationId,
    );

    return {
      success: true,
      data: {
        id: memo.id,
        status: memo.status,
        memoType: memo.memoType,
        query: memo.query,
        createdAt: memo.createdAt,
      },
    };
  }

  @Get('memos/:id')
  @RequiredApiKeyPermissions('memos:read')
  async getMemo(
    @CurrentUser() user: { sub: string; organizationId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const memo = await this.memosService.findById(
      id,
      user.sub,
      user.organizationId,
    );

    return {
      success: true,
      data: {
        id: memo.id,
        status: memo.status,
        memoType: memo.memoType,
        query: memo.query,
        structuredOutput: memo.structuredOutput,
        citationsJson: memo.citationsJson,
        confidenceScore: memo.confidenceScore,
        matterId: memo.matterId,
        createdAt: memo.createdAt,
        updatedAt: memo.updatedAt,
      },
    };
  }

  @Get('memos/:id/status')
  @RequiredApiKeyPermissions('memos:read')
  async getMemoStatus(
    @CurrentUser() user: { sub: string; organizationId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const status = await this.memosService.getStatus(
      id,
      user.sub,
      user.organizationId,
    );

    return { success: true, data: status };
  }
}
