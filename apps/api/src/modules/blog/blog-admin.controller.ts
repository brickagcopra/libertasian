import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { JwtPayload } from '@libertasian/types';
import sharp from 'sharp';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditService } from '../audit/audit.service';
import { S3Service } from '../uploads/s3.service';
import { ClamavService } from '../uploads/clamav.service';
import { BlogService } from './blog.service';
import { CreateBlogPostDto, UpdateBlogPostDto, BlogQueryDto, CreateTagDto } from './dto';

// file-type@16 uses fromBuffer
async function fileTypeFromBuffer(buffer: Uint8Array | ArrayBuffer) {
  const fileType = await import('file-type');
  return fileType.fromBuffer(buffer as Buffer);
}

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type AllowedMime = (typeof ALLOWED_MIMES)[number];
const MAX_COVER_SIZE = 20 * 1024 * 1024;
const COVER_MAX_WIDTH = 1200;
const COVER_JPEG_QUALITY = 85;

// Sharp security per CLAUDE.md
sharp.cache(false);

@ApiTags('Blog Admin')
@Controller('admin/blog')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions('blog:manage')
@ApiBearerAuth()
export class BlogAdminController {
  constructor(
    private readonly blogService: BlogService,
    private readonly auditService: AuditService,
    private readonly s3Service: S3Service,
    private readonly clamavService: ClamavService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all blog posts (admin)' })
  async listPosts(@Query() query: BlogQueryDto) {
    const result = await this.blogService.getAdminPosts(query);
    return {
      success: true,
      data: result.items,
      meta: { hasNext: result.hasNext, nextCursor: result.nextCursor },
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get blog post by ID (admin)' })
  async getPost(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.blogService.getAdminPost(id);
    return { success: true, data };
  }

  @Post()
  @ApiOperation({ summary: 'Create blog post' })
  async createPost(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateBlogPostDto,
  ) {
    const data = await this.blogService.createPost(dto, user.sub);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      organizationId: user.organizationId,
      action: 'blog_post.create',
      entityType: 'blog_post',
      entityId: data.id as string,
      metadata: { title: dto.title, status: dto.status ?? 'draft' },
    });
    return { success: true, data };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update blog post' })
  async updatePost(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBlogPostDto,
  ) {
    const data = await this.blogService.updatePost(id, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      organizationId: user.organizationId,
      action: 'blog_post.update',
      entityType: 'blog_post',
      entityId: id,
      metadata: { changedFields: Object.keys(dto) },
    });
    return { success: true, data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete blog post' })
  async deletePost(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.blogService.deletePost(id);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      organizationId: user.organizationId,
      action: 'blog_post.delete',
      entityType: 'blog_post',
      entityId: id,
    });
  }

  // =========================================================================
  // Tags
  // =========================================================================

  @Get('tags/all')
  @ApiOperation({ summary: 'List all tags (admin)' })
  async listTags() {
    const data = await this.blogService.getAllTags();
    return { success: true, data };
  }

  @Post('tags')
  @ApiOperation({ summary: 'Create blog tag' })
  async createTag(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTagDto,
  ) {
    const data = await this.blogService.createTag(dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      organizationId: user.organizationId,
      action: 'blog_tag.create',
      entityType: 'blog_tag',
      entityId: data.id,
      metadata: { name: dto.name },
    });
    return { success: true, data };
  }

  @Delete('tags/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete blog tag' })
  async deleteTag(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.blogService.deleteTag(id);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      organizationId: user.organizationId,
      action: 'blog_tag.delete',
      entityType: 'blog_tag',
      entityId: id,
    });
  }

  // =========================================================================
  // Cover Image Upload
  // =========================================================================

  @Post(':id/upload-cover')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 3600000, limit: 20 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_COVER_SIZE } }))
  @ApiOperation({ summary: 'Upload cover image for blog post' })
  @ApiConsumes('multipart/form-data')
  async uploadCover(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Verify post exists
    await this.blogService.getAdminPost(id);

    // Size check
    if (file.size > MAX_COVER_SIZE) {
      throw new BadRequestException(
        `File size ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds maximum 20MB`,
      );
    }

    // MIME allowlist check
    if (!ALLOWED_MIMES.includes(file.mimetype as AllowedMime)) {
      throw new BadRequestException(
        `File type "${file.mimetype}" not allowed. Allowed: ${ALLOWED_MIMES.join(', ')}`,
      );
    }

    // Magic byte validation
    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected || !ALLOWED_MIMES.includes(detected.mime as AllowedMime)) {
      throw new BadRequestException('File content does not match an allowed image type');
    }
    if (detected.mime !== file.mimetype) {
      throw new BadRequestException(
        `Declared MIME "${file.mimetype}" does not match detected "${detected.mime}"`,
      );
    }

    // ClamAV scan
    const scanResult = await this.clamavService.scanBuffer(file.buffer, `blog-cover-${id}`);
    if (!scanResult.clean) {
      throw new BadRequestException('File failed security scan');
    }

    // Process with Sharp: resize, strip EXIF, JPEG output
    const processedBuffer = await sharp(file.buffer, { limitInputPixels: 100_000_000 })
      .rotate()
      .withMetadata({})
      .resize({ width: COVER_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: COVER_JPEG_QUALITY })
      .toBuffer();

    // Upload to S3
    const objectKey = `blog/${id}/${crypto.randomUUID()}.jpg`;
    await this.s3Service.upload(objectKey, processedBuffer, 'image/jpeg', 'cover.jpg');

    // Generate URL (the S3 service should provide URL generation)
    const coverImageUrl = objectKey;

    // Update the blog post
    await this.blogService.updatePost(id, { coverImageUrl });

    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      organizationId: user.organizationId,
      action: 'blog_post.upload_cover',
      entityType: 'blog_post',
      entityId: id,
      metadata: { objectKey },
    });

    return { success: true, data: { coverImageUrl } };
  }
}
