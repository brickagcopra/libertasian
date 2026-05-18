import {
  Body,
  Controller,
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
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditService } from '../audit/audit.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { DocumentsService } from './documents.service';
import {
  CreateLegalDocumentDto,
  UpdateLegalDocumentDto,
  ListDocumentsQueryDto,
  CreateDocumentSectionDto,
} from './dto';

/**
 * Documents controller.
 * GET endpoints are public (published legal documents are publicly readable).
 * OptionalJwtAuthGuard hydrates `req.user` when a token is present so the
 * service can honor the free-plan `previewOnly` entitlement; anonymous
 * callers are treated as free-tier (preview cap applies).
 * POST/PATCH endpoints require JwtAuthGuard + MfaGuard + RolesGuard (admin/editor).
 */
@ApiTags('Documents')
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly auditService: AuditService,
    private readonly entitlementService: EntitlementService,
  ) {}

  private async resolvePreviewOnly(user: JwtPayload | null): Promise<boolean> {
    if (!user) return true;
    const ent = await this.entitlementService.resolveEffectiveEntitlements(
      user.organizationId,
    );
    return ent.previewOnly === true;
  }

  // ---- Public endpoints (published documents) ----

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @ApiOperation({ summary: 'List legal documents with filters and cursor pagination' })
  async list(
    @Query() query: ListDocumentsQueryDto,
    @CurrentUser() user: JwtPayload | null,
  ) {
    const previewOnly = await this.resolvePreviewOnly(user);
    const result = await this.documentsService.list(query, previewOnly);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @ApiOperation({ summary: 'Get a legal document by ID' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload | null,
  ) {
    const previewOnly = await this.resolvePreviewOnly(user);
    const doc = await this.documentsService.findById(id, previewOnly);
    return { success: true, data: doc };
  }

  @Get(':id/sections')
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @ApiOperation({ summary: 'List all sections of a legal document' })
  async listSections(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload | null,
  ) {
    const previewOnly = await this.resolvePreviewOnly(user);
    const sections = await this.documentsService.listSections(id, previewOnly);
    return { success: true, data: sections };
  }

  @Get(':id/sections/:sectionId')
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @ApiOperation({ summary: 'Get a specific section with full text' })
  async getSection(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser() user: JwtPayload | null,
  ) {
    const previewOnly = await this.resolvePreviewOnly(user);
    const section = await this.documentsService.getSection(id, sectionId, previewOnly);
    return { success: true, data: section };
  }

  @Get(':id/citations')
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @ApiOperation({ summary: 'List citations from a legal document' })
  async listCitations(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload | null,
  ) {
    const previewOnly = await this.resolvePreviewOnly(user);
    const citations = await this.documentsService.listCitations(id, previewOnly);
    return { success: true, data: citations };
  }

  @Get(':id/related')
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @ApiOperation({ summary: 'List documents related by citation' })
  async listRelated(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload | null,
  ) {
    const previewOnly = await this.resolvePreviewOnly(user);
    const related = await this.documentsService.listRelated(id, previewOnly);
    return { success: true, data: related };
  }

  // ---- Admin endpoints (document management) ----

  @Post()
  @UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
  @RequiredPermissions('documents:create')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a legal document (admin/editor only)' })
  async create(
    @Body() dto: CreateLegalDocumentDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const doc = await this.documentsService.create(dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      action: 'document.create',
      entityType: 'legal_document',
      entityId: doc.id,
      metadata: { ip, documentType: dto.documentType },
    });
    return { success: true, data: doc };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
  @RequiredPermissions('documents:update')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a legal document (admin/editor only)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLegalDocumentDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const doc = await this.documentsService.update(id, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      action: 'document.update',
      entityType: 'legal_document',
      entityId: id,
      metadata: { ip, changes: Object.keys(dto) },
    });
    return { success: true, data: doc };
  }

  @Post(':id/publish')
  @UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
  @RequiredPermissions('documents:publish')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publish a legal document (admin/editor only)' })
  async publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const doc = await this.documentsService.publishDocument(id);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      action: 'document.publish',
      entityType: 'legal_document',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: doc };
  }

  @Post(':id/quarantine')
  @UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
  @RequiredPermissions('documents:delete')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Quarantine a legal document (admin only)' })
  async quarantine(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const doc = await this.documentsService.quarantineDocument(id);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      action: 'document.quarantine',
      entityType: 'legal_document',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: doc };
  }

  @Post(':id/sections')
  @UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
  @RequiredPermissions('documents:create')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a section to a legal document (admin/editor only)' })
  async createSection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDocumentSectionDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const section = await this.documentsService.createSection(id, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'user',
      action: 'document.section_create',
      entityType: 'legal_document_section',
      entityId: section.id,
      metadata: { ip, documentId: id, sectionType: dto.sectionType },
    });
    return { success: true, data: section };
  }
}
