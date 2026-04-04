import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditService } from '../audit/audit.service';
import { CommunityService } from './community.service';
import {
  ResolveCommunityFlagDto,
  ListFlagsQueryDto,
  ResolveExpertVerificationDto,
  ListExpertVerificationsQueryDto,
} from './dto';

@ApiTags('Community Admin')
@Controller('community/admin')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions('community:moderate')
@ApiBearerAuth()
export class CommunityAdminController {
  constructor(
    private readonly communityService: CommunityService,
    private readonly auditService: AuditService,
  ) {}

  // =========================================================================
  // Flag Management
  // =========================================================================

  @Get('flags')
  @ApiOperation({ summary: 'List content flags (admin/editor)' })
  async listFlags(@Query() query: ListFlagsQueryDto) {
    const result = await this.communityService.listFlags(query);
    return { success: true, data: result.items, meta: { hasNext: result.hasNext, nextCursor: result.nextCursor } };
  }

  @Patch('flags/:id')
  @ApiOperation({ summary: 'Resolve a content flag (admin/editor)' })
  async resolveFlag(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveCommunityFlagDto,
  ) {
    const flag = await this.communityService.resolveFlag(id, user.sub, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      organizationId: user.organizationId,
      action: 'community_flag.resolve',
      entityType: 'community_flag',
      entityId: id,
      metadata: { status: dto.status },
    });
    return { success: true, data: flag };
  }

  // =========================================================================
  // Expert Verification Management
  // =========================================================================

  @Get('expert-verifications')
  @ApiOperation({ summary: 'List expert verification requests (admin/editor)' })
  async listExpertVerifications(@Query() query: ListExpertVerificationsQueryDto) {
    const result = await this.communityService.listExpertVerifications(query);
    return { success: true, data: result.items, meta: { hasNext: result.hasNext, nextCursor: result.nextCursor } };
  }

  @Patch('expert-verifications/:id')
  @ApiOperation({ summary: 'Approve/reject/revoke expert verification (admin/editor)' })
  async resolveExpertVerification(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveExpertVerificationDto,
  ) {
    const verification = await this.communityService.resolveExpertVerification(id, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      organizationId: user.organizationId,
      action: 'expert_verification.resolve',
      entityType: 'expert_verification',
      entityId: id,
      metadata: { status: dto.status, userId: verification.userId },
    });
    return { success: true, data: verification };
  }
}
