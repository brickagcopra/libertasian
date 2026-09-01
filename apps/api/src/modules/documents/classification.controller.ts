import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
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
import { ClassificationService } from './classification.service';
import {
  ClassificationReviewQueryDto,
  ConfirmClassificationDto,
  RejectClassificationDto,
  OverrideClassificationDto,
} from './dto';

@ApiTags('Admin — Classification')
@Controller('admin/classification')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions('admin:documents')
@Throttle({ default: { ttl: 60000, limit: 100 } })
@ApiBearerAuth()
export class ClassificationController {
  constructor(
    private readonly classificationService: ClassificationService,
    private readonly auditService: AuditService,
  ) {}

  @Get('review-queue')
  @ApiOperation({ summary: 'Get documents with low-confidence classifications' })
  async getReviewQueue(@Query() query: ClassificationReviewQueryDto) {
    const result =
      await this.classificationService.getClassificationReviewQueue(query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get classification review stats' })
  async getStats() {
    const stats = await this.classificationService.getReviewStats();
    return { success: true, data: stats };
  }

  @Get(':id')
  @ApiOperation({ summary: "Get one document's classification detail" })
  async getDetail(@Param('id', ParseUUIDPipe) id: string) {
    const detail = await this.classificationService.getClassificationDetail(id);
    return { success: true, data: detail };
  }

  @Post('confirm')
  @ApiOperation({ summary: 'Confirm a classification as correct' })
  async confirm(
    @Body() dto: ConfirmClassificationDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.classificationService.confirmClassification(
      dto.documentId,
      dto.tagId,
    );
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'classification.confirmed',
      entityType: 'legal_document_tag_map',
      entityId: result.id,
      metadata: { ip, documentId: dto.documentId, tagId: dto.tagId },
    });
    return { success: true, data: result };
  }

  @Post('reject')
  @ApiOperation({ summary: 'Reject a classification' })
  async reject(
    @Body() dto: RejectClassificationDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.classificationService.rejectClassification(
      dto.documentId,
      dto.tagId,
    );
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'classification.rejected',
      entityType: 'legal_document_tag_map',
      entityId: result.id,
      metadata: { ip, documentId: dto.documentId, tagId: dto.tagId },
    });
    return { success: true, data: result };
  }

  @Post('override')
  @ApiOperation({ summary: 'Override classification with manual primary/secondary' })
  async override(
    @Body() dto: OverrideClassificationDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.classificationService.overrideClassification(
      dto.documentId,
      dto.primaryTagId,
      dto.secondaryTagIds,
    );
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'classification.overridden',
      entityType: 'legal_document',
      entityId: dto.documentId,
      metadata: {
        ip,
        primaryTagId: dto.primaryTagId,
        secondaryTagIds: dto.secondaryTagIds,
      },
    });
    return { success: true, data: result };
  }
}
