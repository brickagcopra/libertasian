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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { AdsService } from './ads.service';
import {
  CreateCampaignDto,
  UpdateCampaignDto,
  UpdateCampaignStatusDto,
  CreateCreativeDto,
  UpdateCreativeDto,
} from './dto';

// file-type@16 uses fromBuffer
async function fileTypeFromBuffer(buffer: Uint8Array | ArrayBuffer) {
  const fileType = await import('file-type');
  return fileType.fromBuffer(buffer as Buffer);
}

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type AllowedMime = (typeof ALLOWED_MIMES)[number];
const MAX_AD_IMAGE_SIZE = 20 * 1024 * 1024;
const AD_IMAGE_MAX_WIDTH = 800;
const AD_JPEG_QUALITY = 85;

// Sharp security per CLAUDE.md
sharp.cache(false);

@ApiTags('Ads Admin')
@Controller('admin/ads')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions('ads:manage')
@ApiBearerAuth()
export class AdsAdminController {
  constructor(
    private readonly adsService: AdsService,
    private readonly auditService: AuditService,
    private readonly s3Service: S3Service,
    private readonly clamavService: ClamavService,
  ) {}

  // =========================================================================
  // Campaigns
  // =========================================================================

  @Get('campaigns')
  @ApiOperation({ summary: 'List all campaigns (admin)' })
  async listCampaigns(
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.adsService.getAdminCampaigns(
      status,
      cursor,
      limit ? parseInt(limit, 10) : 20,
    );
    return {
      success: true,
      data: result.items,
      meta: { hasNext: result.hasNext, nextCursor: result.nextCursor },
    };
  }

  @Get('campaigns/:id')
  @ApiOperation({ summary: 'Get campaign detail (admin)' })
  async getCampaign(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.adsService.getAdminCampaign(id);
    return { success: true, data };
  }

  @Post('campaigns')
  @ApiOperation({ summary: 'Create ad campaign' })
  async createCampaign(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCampaignDto,
  ) {
    const data = await this.adsService.createCampaign(dto, user.sub);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      organizationId: user.organizationId,
      action: 'ad_campaign.create',
      entityType: 'ad_campaign',
      entityId: data.id,
      metadata: { name: dto.name, status: dto.status ?? 'draft' },
    });
    return { success: true, data };
  }

  @Put('campaigns/:id')
  @ApiOperation({ summary: 'Update ad campaign' })
  async updateCampaign(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    const data = await this.adsService.updateCampaign(id, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      organizationId: user.organizationId,
      action: 'ad_campaign.update',
      entityType: 'ad_campaign',
      entityId: id,
      metadata: { changedFields: Object.keys(dto) },
    });
    return { success: true, data };
  }

  @Put('campaigns/:id/status')
  @ApiOperation({ summary: 'Quick status toggle for campaign' })
  async updateCampaignStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignStatusDto,
  ) {
    const data = await this.adsService.updateCampaignStatus(id, dto.status);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      organizationId: user.organizationId,
      action: 'ad_campaign.status_change',
      entityType: 'ad_campaign',
      entityId: id,
      metadata: { newStatus: dto.status },
    });
    return { success: true, data };
  }

  @Delete('campaigns/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete ad campaign' })
  async deleteCampaign(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.adsService.deleteCampaign(id);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      organizationId: user.organizationId,
      action: 'ad_campaign.delete',
      entityType: 'ad_campaign',
      entityId: id,
    });
  }

  @Get('campaigns/:id/analytics')
  @ApiOperation({ summary: 'Get campaign analytics' })
  async getCampaignAnalytics(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.adsService.getCampaignAnalytics(id);
    return { success: true, data };
  }

  // =========================================================================
  // Creatives
  // =========================================================================

  @Post('campaigns/:id/creatives')
  @ApiOperation({ summary: 'Add creative to campaign' })
  async createCreative(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) campaignId: string,
    @Body() dto: CreateCreativeDto,
  ) {
    const data = await this.adsService.createCreative(campaignId, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      organizationId: user.organizationId,
      action: 'ad_creative.create',
      entityType: 'ad_creative',
      entityId: data.id,
      metadata: { campaignId, displayType: dto.displayType },
    });
    return { success: true, data };
  }

  @Put('creatives/:id')
  @ApiOperation({ summary: 'Update creative' })
  async updateCreative(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCreativeDto,
  ) {
    const data = await this.adsService.updateCreative(id, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      organizationId: user.organizationId,
      action: 'ad_creative.update',
      entityType: 'ad_creative',
      entityId: id,
      metadata: { changedFields: Object.keys(dto) },
    });
    return { success: true, data };
  }

  @Delete('creatives/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete creative' })
  async deleteCreative(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.adsService.deleteCreative(id);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      organizationId: user.organizationId,
      action: 'ad_creative.delete',
      entityType: 'ad_creative',
      entityId: id,
    });
  }

  // =========================================================================
  // Creative Image Upload
  // =========================================================================

  @Post('creatives/:id/upload-image')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 3600000, limit: 20 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AD_IMAGE_SIZE } }))
  @ApiOperation({ summary: 'Upload image for ad creative' })
  @ApiConsumes('multipart/form-data')
  async uploadCreativeImage(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) creativeId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Size check
    if (file.size > MAX_AD_IMAGE_SIZE) {
      throw new BadRequestException(
        `File size ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds maximum 20MB`,
      );
    }

    // MIME check
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
    const scanResult = await this.clamavService.scanBuffer(file.buffer, `ad-creative-${creativeId}`);
    if (!scanResult.clean) {
      throw new BadRequestException('File failed security scan');
    }

    // Process with Sharp
    const processedBuffer = await sharp(file.buffer, { limitInputPixels: 100_000_000 })
      .rotate()
      .withMetadata({})
      .resize({ width: AD_IMAGE_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: AD_JPEG_QUALITY })
      .toBuffer();

    // Upload to S3
    const objectKey = `ads/${creativeId}/${crypto.randomUUID()}.jpg`;
    await this.s3Service.upload(objectKey, processedBuffer, 'image/jpeg', 'ad-image.jpg');

    // Update creative
    await this.adsService.updateCreative(creativeId, { imageUrl: objectKey });

    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      organizationId: user.organizationId,
      action: 'ad_creative.upload_image',
      entityType: 'ad_creative',
      entityId: creativeId,
      metadata: { objectKey },
    });

    return { success: true, data: { imageUrl: objectKey } };
  }
}
