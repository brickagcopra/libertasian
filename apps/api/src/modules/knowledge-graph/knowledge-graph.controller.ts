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
import { KnowledgeGraphService } from './knowledge-graph.service';
import {
  CreateCaseCodalLinkDto,
  GraphQueryDto,
  ListCaseCodalLinksQueryDto,
  NetworkQueryDto,
  PrecedentTrailQueryDto,
  UnresolvedCitationsQueryDto,
  UpdateCaseCodalLinkDto,
} from './dto';

// ---- Public graph query endpoints (authenticated users) ----

@ApiTags('Knowledge Graph')
@Controller('knowledge-graph')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class KnowledgeGraphPublicController {
  constructor(
    private readonly knowledgeGraphService: KnowledgeGraphService,
  ) {}

  @Get('cites')
  @ApiOperation({
    summary: 'Get documents cited by a document (outgoing citations)',
  })
  async getCites(@Query() query: GraphQueryDto) {
    const result = await this.knowledgeGraphService.getCites(
      query.documentId,
      query.depth ?? 1,
    );
    return { success: true, data: result };
  }

  @Get('cited-by')
  @ApiOperation({
    summary: 'Get documents that cite a document (incoming citations)',
  })
  async getCitedBy(@Query() query: GraphQueryDto) {
    const result = await this.knowledgeGraphService.getCitedBy(
      query.documentId,
      query.depth ?? 1,
    );
    return { success: true, data: result };
  }

  @Get('chain')
  @ApiOperation({
    summary: 'Get full citation chain (both directions, BFS depth 3)',
  })
  async getChain(@Query() query: GraphQueryDto) {
    const result = await this.knowledgeGraphService.getChain(
      query.documentId,
      query.depth ?? 3,
    );
    return { success: true, data: result };
  }

  @Get('network')
  @ApiOperation({
    summary: 'Get network visualization graph for a document',
  })
  async getNetwork(@Query() query: NetworkQueryDto) {
    const result = await this.knowledgeGraphService.getNetwork(
      query.documentId,
      query.depth ?? 2,
    );
    return { success: true, data: result };
  }

  @Get('codal-links/:documentId')
  @ApiOperation({
    summary: 'Get codal links for a document (case→codal and codal→case)',
  })
  async getCodalLinks(
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    const result =
      await this.knowledgeGraphService.getCodalLinks(documentId);
    return { success: true, data: result };
  }

  @Get('precedent-trail')
  @ApiOperation({
    summary: 'Build a precedent trail showing doctrine evolution across cases',
    description:
      'Provide documentId, doctrineId, or doctrineText to anchor the trail. ' +
      'Returns a chronological list of cases with their doctrines and relationships.',
  })
  async getPrecedentTrail(@Query() query: PrecedentTrailQueryDto) {
    const result = await this.knowledgeGraphService.buildPrecedentTrail({
      documentId: query.documentId,
      doctrineId: query.doctrineId,
      doctrineText: query.doctrineText,
      depth: query.depth,
    });
    return { success: true, data: result };
  }
}

// ---- Admin endpoints (MFA + role-gated) ----

@ApiTags('Admin — Knowledge Graph')
@Controller('admin/knowledge-graph')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions('admin:knowledge-graph')
@Throttle({ default: { ttl: 60000, limit: 100 } })
@ApiBearerAuth()
export class KnowledgeGraphAdminController {
  constructor(
    private readonly knowledgeGraphService: KnowledgeGraphService,
    private readonly auditService: AuditService,
  ) {}

  // ---- Citation Resolution ----

  @Post('resolve-citations/:documentId')
  @ApiOperation({
    summary: 'Trigger citation resolution for a document',
  })
  async resolveCitations(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result =
      await this.knowledgeGraphService.triggerCitationResolution(documentId);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'citation.resolve_trigger',
      entityType: 'legal_document',
      entityId: documentId,
      metadata: { ip, unresolvedCount: result.unresolvedCitationCount },
    });
    return { success: true, data: result };
  }

  @Post('resolve-citation/:citationId')
  @ApiOperation({
    summary: 'Manually resolve a citation to a target document',
  })
  async resolveCitation(
    @Param('citationId', ParseUUIDPipe) citationId: string,
    @Body('toDocumentId', ParseUUIDPipe) toDocumentId: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.knowledgeGraphService.resolveCitation(
      citationId,
      toDocumentId,
    );
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'citation.resolve_manual',
      entityType: 'citation',
      entityId: citationId,
      metadata: { ip, toDocumentId },
    });
    return { success: true, data: result };
  }

  @Get('unresolved-citations')
  @ApiOperation({ summary: 'List unresolved citations' })
  async listUnresolvedCitations(
    @Query() query: UnresolvedCitationsQueryDto,
  ) {
    const result =
      await this.knowledgeGraphService.listUnresolvedCitations(query);
    return { success: true, data: result.items, meta: result.meta };
  }

  // ---- Case-Codal Link CRUD ----

  @Post('case-codal-links')
  @ApiOperation({ summary: 'Create a case-codal provision link' })
  async createCaseCodalLink(
    @Body() dto: CreateCaseCodalLinkDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const link = await this.knowledgeGraphService.createCaseCodalLink(
      dto,
      user.sub,
    );
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'case_codal_link.create',
      entityType: 'case_codal_link',
      entityId: link.id,
      metadata: {
        ip,
        linkType: dto.linkType,
        caseDocumentId: dto.caseDocumentId,
        codalDocumentId: dto.codalDocumentId,
      },
    });
    return { success: true, data: link };
  }

  @Get('case-codal-links')
  @ApiOperation({ summary: 'List case-codal links (filterable)' })
  async listCaseCodalLinks(@Query() query: ListCaseCodalLinksQueryDto) {
    const result =
      await this.knowledgeGraphService.listCaseCodalLinks(query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Patch('case-codal-links/:id')
  @ApiOperation({ summary: 'Update a case-codal link' })
  async updateCaseCodalLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCaseCodalLinkDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const link = await this.knowledgeGraphService.updateCaseCodalLink(
      id,
      dto,
    );
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'case_codal_link.update',
      entityType: 'case_codal_link',
      entityId: id,
      metadata: { ip, changes: Object.keys(dto) },
    });
    return { success: true, data: link };
  }

  @Delete('case-codal-links/:id')
  @ApiOperation({ summary: 'Delete a case-codal link' })
  async deleteCaseCodalLink(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.knowledgeGraphService.deleteCaseCodalLink(id);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'case_codal_link.delete',
      entityType: 'case_codal_link',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Case-codal link deleted' } };
  }

  // ---- Case-Codal Auto-Suggestion ----

  @Post('suggest-case-codal/:documentId')
  @ApiOperation({
    summary: 'AI-suggest codal provisions referenced by a case document',
  })
  async suggestCaseCodalLinks(
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result =
      await this.knowledgeGraphService.suggestCaseCodalLinks(documentId);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'case_codal.suggest',
      entityType: 'legal_document',
      entityId: documentId,
      metadata: {
        ip,
        suggestionsCount: result.suggestions.length,
      },
    });
    return { success: true, data: result };
  }
}
