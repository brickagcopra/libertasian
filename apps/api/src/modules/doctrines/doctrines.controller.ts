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
import { DoctrinesService } from './doctrines.service';
import {
  CreateDoctrineDto,
  CreateDoctrineLinkDto,
  ExtractDoctrinesBatchDto,
  ExtractDoctrinesDto,
  ListDoctrinesQueryDto,
  UpdateDoctrineDto,
} from './dto';

// ---- Public endpoints (approved doctrines) ----

@ApiTags('Doctrines')
@Controller('doctrines')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DoctrinesPublicController {
  constructor(private readonly doctrinesService: DoctrinesService) {}

  @Get()
  @ApiOperation({ summary: 'List approved doctrines (public)' })
  async listApproved(@Query() query: ListDoctrinesQueryDto) {
    const result = await this.doctrinesService.listApproved(query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an approved doctrine by ID (public)' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    const doctrine = await this.doctrinesService.findById(id);
    return { success: true, data: doctrine };
  }
}

// ---- Document-scoped endpoints ----

@ApiTags('Doctrines')
@Controller('documents')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DoctrinesDocumentController {
  constructor(private readonly doctrinesService: DoctrinesService) {}

  @Get(':id/doctrines')
  @ApiOperation({ summary: 'List doctrines for a specific document' })
  async findByDocument(@Param('id', ParseUUIDPipe) documentId: string) {
    const doctrines = await this.doctrinesService.findByDocument(documentId);
    return { success: true, data: doctrines };
  }
}

// ---- Admin endpoints (MFA + role-gated) ----

@ApiTags('Admin — Doctrines')
@Controller('admin')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions({ permissions: ['doctrines:read', 'doctrines:create'], mode: 'any' })
@Throttle({ default: { ttl: 60000, limit: 100 } })
@ApiBearerAuth()
export class DoctrinesAdminController {
  constructor(
    private readonly doctrinesService: DoctrinesService,
    private readonly auditService: AuditService,
  ) {}

  // ---- Doctrine Extraction ----

  @Post('doctrines/extract')
  @ApiOperation({ summary: 'Trigger doctrine extraction for a document' })
  async extract(
    @Body() dto: ExtractDoctrinesDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const doctrine = await this.doctrinesService.triggerExtraction(dto);
    if (doctrine) {
      await this.auditService.log({
        actorUserId: user.sub,
        actorType: 'admin',
        action: 'doctrine.extract',
        entityType: 'doctrine_extract',
        entityId: doctrine.id,
        metadata: { ip, legalDocumentId: dto.legalDocumentId, strategy: dto.strategy },
      });
    }
    return { success: true, data: doctrine };
  }

  @Post('doctrines/extract-batch')
  @ApiOperation({ summary: 'Trigger batch doctrine extraction for multiple documents' })
  async extractBatch(
    @Body() dto: ExtractDoctrinesBatchDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.doctrinesService.triggerBatchExtraction(dto, user.sub);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'doctrine.extract_batch',
      entityType: 'doctrine_extract',
      entityId: result.batchId,
      metadata: {
        ip,
        batchId: result.batchId,
        totalDocuments: result.totalDocuments,
        strategy: result.strategy,
      },
    });
    return { success: true, data: result };
  }

  // ---- Doctrine CRUD ----

  @Get('doctrines')
  @ApiOperation({ summary: 'List all doctrines (admin, filterable)' })
  async list(@Query() query: ListDoctrinesQueryDto) {
    const result = await this.doctrinesService.list(query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get('doctrines/:id')
  @ApiOperation({ summary: 'Get doctrine detail (admin)' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    const doctrine = await this.doctrinesService.findById(id);
    return { success: true, data: doctrine };
  }

  @Post('doctrines')
  @ApiOperation({ summary: 'Create a doctrine manually' })
  async create(
    @Body() dto: CreateDoctrineDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const doctrine = await this.doctrinesService.create(dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'doctrine.create',
      entityType: 'doctrine_extract',
      entityId: doctrine.id,
      metadata: { ip, doctrineType: dto.doctrineType, legalDocumentId: dto.legalDocumentId },
    });
    return { success: true, data: doctrine };
  }

  @Patch('doctrines/:id')
  @ApiOperation({ summary: 'Update a doctrine' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDoctrineDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const doctrine = await this.doctrinesService.update(id, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'doctrine.update',
      entityType: 'doctrine_extract',
      entityId: id,
      metadata: { ip, changes: Object.keys(dto) },
    });
    return { success: true, data: doctrine };
  }

  @Delete('doctrines/:id')
  @ApiOperation({ summary: 'Delete a doctrine' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.doctrinesService.delete(id);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'doctrine.delete',
      entityType: 'doctrine_extract',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Doctrine deleted' } };
  }

  // ---- Review Workflow ----

  @Post('doctrines/:id/approve')
  @ApiOperation({ summary: 'Approve a doctrine' })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const doctrine = await this.doctrinesService.approve(id);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'doctrine.approve',
      entityType: 'doctrine_extract',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: doctrine };
  }

  @Post('doctrines/:id/reject')
  @ApiOperation({ summary: 'Reject a doctrine' })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const doctrine = await this.doctrinesService.reject(id);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'doctrine.reject',
      entityType: 'doctrine_extract',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: doctrine };
  }

  // ---- Doctrine Links ----

  @Post('doctrine-links')
  @ApiOperation({ summary: 'Create a link between two doctrines' })
  async createLink(
    @Body() dto: CreateDoctrineLinkDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const link = await this.doctrinesService.createLink(dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'doctrine_link.create',
      entityType: 'doctrine_link',
      entityId: link.id,
      metadata: { ip, linkType: dto.linkType, fromDoctrineId: dto.fromDoctrineId, toDoctrineId: dto.toDoctrineId },
    });
    return { success: true, data: link };
  }

  @Get('doctrine-links')
  @ApiOperation({ summary: 'List links for a doctrine' })
  async listLinks(@Query('doctrineId', ParseUUIDPipe) doctrineId: string) {
    const links = await this.doctrinesService.listLinks(doctrineId);
    return { success: true, data: links };
  }

  @Delete('doctrine-links/:id')
  @ApiOperation({ summary: 'Delete a doctrine link' })
  async deleteLink(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.doctrinesService.deleteLink(id);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'doctrine_link.delete',
      entityType: 'doctrine_link',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Doctrine link deleted' } };
  }
}
