import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { RequiredSubscription } from '../../common/decorators/subscription.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { AuditService } from '../audit/audit.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import {
  AttachToMatterDto,
  GenerateDigestFromUploadDto,
  GenerateFlashcardsFromUploadDto,
  GenerateOutlineFromUploadDto,
  ListUploadsQueryDto,
  SearchUploadsDto,
  UpdatePrivacyDto,
  UploadCameraScanDto,
  UploadFileDto,
} from './dto';
import { UploadsService } from './uploads.service';
import { UserUploadSearchService } from './user-upload-search.service';

@ApiTags('Uploads')
@Controller('uploads')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UploadsController {
  constructor(
    private readonly uploadsService: UploadsService,
    private readonly auditService: AuditService,
    private readonly usageQuota: UsageQuotaService,
    private readonly userUploadSearch: UserUploadSearchService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 3600000, limit: 20 } }) // 20 uploads per hour
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Upload a document file (returns 202 with upload ID)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        privacyLevel: { type: 'string', enum: ['private', 'editorial_candidate'] },
      },
      required: ['file'],
    },
  })
  async uploadFile(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadFileDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Enforce plan-based document upload quota (free/edu: 0, pro+: unlimited)
    const quota = await this.usageQuota.checkAndIncrement(
      user.organizationId,
      user.sub,
      'documentUploadsPerMonth',
      { isPlatformAdmin: user.isPlatformAdmin === true },
    );
    if (!quota.allowed) {
      throw new ForbiddenException({
        message: 'Document uploads are available on Pro plans and above.',
        quota: { used: quota.used, limit: quota.limit, resetsAt: quota.resetsAt },
      });
    }

    const result = await this.uploadsService.uploadFile(
      file,
      user.organizationId,
      user.sub,
      dto.privacyLevel,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'upload.create',
      entityType: 'user_upload',
      entityId: result.id,
      metadata: {
        ip,
        uploadType: 'document',
        filename: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      },
    });

    return { success: true, data: result };
  }

  @Post('camera-scan')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 3600000, limit: 20 } })
  @UseInterceptors(
    FilesInterceptor('files', 20, { limits: { fileSize: 20 * 1024 * 1024 } }),
  )
  @ApiOperation({ summary: 'Upload camera scan images (multi-page, returns 202)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        devicePlatform: { type: 'string', enum: ['ios', 'android'] },
        captureMode: { type: 'string', enum: ['single_page', 'multi_page'] },
        privacyLevel: { type: 'string', enum: ['private', 'editorial_candidate'] },
      },
      required: ['files'],
    },
  })
  async uploadCameraScan(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() dto: UploadCameraScanDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files provided');
    }

    // Enforce plan-based camera scan quota
    const quota = await this.usageQuota.checkAndIncrement(
      user.organizationId,
      user.sub,
      'cameraScansPerMonth',
      { isPlatformAdmin: user.isPlatformAdmin === true },
    );
    if (!quota.allowed) {
      throw new ForbiddenException({
        message: 'Camera scan quota exceeded for this month',
        quota: { used: quota.used, limit: quota.limit, resetsAt: quota.resetsAt },
      });
    }

    const result = await this.uploadsService.uploadCameraScan(
      files,
      user.organizationId,
      user.sub,
      {
        devicePlatform: dto.devicePlatform,
        captureMode: dto.captureMode,
        privacyLevel: dto.privacyLevel,
      },
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'upload.create',
      entityType: 'user_upload',
      entityId: result.id,
      metadata: {
        ip,
        uploadType: 'camera_scan',
        imageCount: files.length,
        devicePlatform: dto.devicePlatform,
      },
    });

    return { success: true, data: result };
  }

  @Get()
  @ApiOperation({ summary: 'List uploads (cursor pagination, org-scoped)' })
  async list(
    @Query() query: ListUploadsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.uploadsService.list(user.organizationId, {
      cursor: query.cursor,
      limit: query.limit,
      uploadType: query.uploadType,
      processingStatus: query.processingStatus,
    });

    return { success: true, data: result.items, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get upload details' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const upload = await this.uploadsService.findById(id, user.organizationId);
    return { success: true, data: upload };
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Get upload processing status' })
  async getStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const status = await this.uploadsService.getStatus(id, user.organizationId);
    return { success: true, data: status };
  }

  @Get(':id/ocr')
  @ApiOperation({ summary: 'Get OCR results for an upload (text, quality, classification)' })
  async getOcrResults(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const results = await this.uploadsService.getOcrResults(id, user.organizationId);
    return { success: true, data: results };
  }

  @Post(':id/generate-digest')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(SubscriptionGuard)
  @RequiredSubscription('edu')
  @ApiOperation({
    summary: 'Trigger digest generation from upload (paid plan required)',
    description:
      'Per CLAUDE.md: free users get OCR text only. Digest generation requires Edu plan or higher. Enforced at API level.',
  })
  async generateDigestFromUpload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateDigestFromUploadDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    // Enforce plan-based digest generation quota
    const quota = await this.usageQuota.checkAndIncrement(
      user.organizationId,
      user.sub,
      'digestsPerMonth',
      { isPlatformAdmin: user.isPlatformAdmin === true },
    );
    if (!quota.allowed) {
      throw new ForbiddenException({
        message: 'Digest generation quota exceeded for this month',
        quota: { used: quota.used, limit: quota.limit, resetsAt: quota.resetsAt },
      });
    }

    const result = await this.uploadsService.generateDigestFromUpload(
      id,
      user.organizationId,
      user.sub,
      dto.digestType,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'upload.generate_digest',
      entityType: 'user_upload',
      entityId: id,
      metadata: {
        ip,
        digestId: result.digestId,
        digestType: dto.digestType ?? 'case_digest',
      },
    });

    return { success: true, data: result };
  }

  @Get('privacy-options')
  @ApiOperation({
    summary: 'Get available privacy options for current user',
    description:
      'Returns the privacy levels available based on the user role. ' +
      'Editorial roles can see editorial_candidate; others only see private.',
  })
  getPrivacyOptions(@CurrentUser() user: JwtPayload) {
    const editorialRoles = ['owner', 'admin', 'editor', 'reviewer'];
    const canPromoteToEditorial = editorialRoles.includes(user.role);

    const options = [
      { value: 'private', label: 'Private', description: 'Only you can access this upload' },
    ];

    if (canPromoteToEditorial) {
      options.push({
        value: 'editorial_candidate',
        label: 'Editorial Candidate',
        description: 'Editors may review this content for inclusion in the public corpus',
      });
    }

    return { success: true, data: { options, canPromoteToEditorial } };
  }

  @Patch(':id/privacy')
  @ApiOperation({
    summary: 'Update upload privacy level',
    description:
      'Per CLAUDE.md: all scans default to private. ' +
      'Only editorial roles (owner, admin, editor, reviewer) can set editorial_candidate.',
  })
  async updatePrivacy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePrivacyDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    // Enforce: only editorial-capable roles can promote to editorial_candidate
    const editorialRoles = ['owner', 'admin', 'editor', 'reviewer'];
    if (
      dto.privacyLevel === 'editorial_candidate' &&
      !editorialRoles.includes(user.role)
    ) {
      throw new ForbiddenException(
        'Only users with editorial roles (owner, admin, editor, reviewer) can flag uploads as editorial candidates.',
      );
    }

    const result = await this.uploadsService.updatePrivacy(
      id,
      user.organizationId,
      user.sub,
      dto.privacyLevel,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'upload.update_privacy',
      entityType: 'user_upload',
      entityId: id,
      metadata: { ip, privacyLevel: dto.privacyLevel },
    });

    return { success: true, data: result };
  }

  @Post(':id/attach-to-matter')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Attach upload to a workspace matter',
    description:
      'Creates a MatterDocument junction record linking this upload to a matter. ' +
      'Both the upload and the matter must belong to the same organization.',
  })
  async attachToMatter(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AttachToMatterDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.uploadsService.attachToMatter(
      id,
      user.organizationId,
      user.sub,
      dto.matterId,
      dto.title,
      dto.role,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'upload.attach_to_matter',
      entityType: 'matter_document',
      entityId: result.id,
      metadata: {
        ip,
        uploadId: id,
        matterId: dto.matterId,
        role: dto.role ?? 'reference',
      },
    });

    return { success: true, data: result };
  }

  @Post(':id/generate-flashcards')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SubscriptionGuard)
  @RequiredSubscription('edu')
  @ApiOperation({
    summary: 'Generate AI flashcards from upload OCR text (paid plan required)',
    description:
      'Uses extracted OCR text from a completed scan to generate flashcards via the RAG service. ' +
      'Generated cards are saved to the specified flashcard set. Requires Edu plan or higher.',
  })
  async generateFlashcardsFromUpload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateFlashcardsFromUploadDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.uploadsService.generateFlashcardsFromUpload(
      id,
      user.organizationId,
      user.sub,
      dto.flashcardSetId,
      {
        cardType: dto.cardType,
        count: dto.count,
        barSubject: dto.barSubject,
      },
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'upload.generate_flashcards',
      entityType: 'user_upload',
      entityId: id,
      metadata: {
        ip,
        flashcardSetId: dto.flashcardSetId,
        cardType: dto.cardType ?? 'mixed',
        requestedCount: dto.count ?? 10,
        generatedCount: result.generatedCount,
        confidenceScore: result.confidenceScore,
        modelName: result.modelName,
      },
    });

    return { success: true, data: result };
  }

  @Post(':id/generate-outline')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SubscriptionGuard)
  @RequiredSubscription('edu')
  @ApiOperation({
    summary: 'Generate a study outline from upload OCR text (paid plan required)',
    description:
      'Uses extracted OCR text from a completed scan to generate a structured study outline. ' +
      'Returns hierarchical sections with key points. Requires Edu plan or higher.',
  })
  async generateOutlineFromUpload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateOutlineFromUploadDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.uploadsService.generateOutlineFromUpload(
      id,
      user.organizationId,
      dto.outlineType,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'upload.generate_outline',
      entityType: 'user_upload',
      entityId: id,
      metadata: {
        ip,
        outlineType: dto.outlineType ?? 'topic_outline',
        confidenceScore: result.confidenceScore,
        modelName: result.modelName,
      },
    });

    return { success: true, data: result };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an upload (S3 + DB)' })
  async deleteUpload(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.uploadsService.delete(id, user.organizationId);

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'upload.delete',
      entityType: 'user_upload',
      entityId: id,
      metadata: { ip },
    });

    return { success: true, data: { message: 'Upload deleted' } };
  }

  // ---- Full-text OCR Search ----

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Full-text search across user uploads (tenant-scoped)',
    description:
      'Searches OCR text from user uploads. organizationId is extracted from JWT — never from client.',
  })
  async searchUploads(
    @Body() dto: SearchUploadsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.userUploadSearch.search(user.organizationId, dto);
    return { success: true, data: result };
  }

  @Post('search/backfill')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(TenantGuard, PermissionsGuard)
  @RequiredPermissions('admin:ingestion')
  @ApiOperation({
    summary: 'Bulk-index existing uploads for full-text search (admin only)',
    description:
      'Indexes all completed OCR uploads for the admin\'s organization into the search index.',
  })
  async backfillSearchIndex(
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.userUploadSearch.bulkIndexOrganizationUploads(
      user.organizationId,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'upload.search_backfill',
      entityType: 'user_upload',
      entityId: undefined,
      metadata: { ip, ...result },
    });

    return { success: true, data: result };
  }
}
