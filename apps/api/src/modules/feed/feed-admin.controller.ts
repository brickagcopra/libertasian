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
import { FeedInteractionsService } from './feed-interactions.service';
import { FeedQueryDto, ModeratePostDto, ModerateReportDto } from './dto';

@ApiTags('Feed Admin')
@Controller('feed/admin')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions('community:moderate')
@ApiBearerAuth()
export class FeedAdminController {
  constructor(
    private readonly interactionsService: FeedInteractionsService,
    private readonly auditService: AuditService,
  ) {}

  @Get('reports')
  @ApiOperation({ summary: 'List open feed reports' })
  async listReports(@Query() query: FeedQueryDto) {
    const result = await this.interactionsService.listReports(query);
    return { success: true, data: result.items, meta: { hasNext: result.hasNext, nextCursor: result.nextCursor } };
  }

  @Patch('reports/:reportId')
  @ApiOperation({ summary: 'Resolve a feed report' })
  async resolveReport(
    @CurrentUser() user: JwtPayload,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Body() dto: ModerateReportDto,
  ) {
    const report = await this.interactionsService.resolveReport(reportId, user.sub, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      organizationId: user.organizationId,
      action: 'feed_report.resolve',
      entityType: 'feed_post_report',
      entityId: reportId,
      metadata: { status: dto.status },
    });
    return { success: true, data: report };
  }

  @Patch('posts/:postId')
  @ApiOperation({ summary: 'Moderate a feed post (hide/remove/restore)' })
  async moderatePost(
    @CurrentUser() user: JwtPayload,
    @Param('postId', ParseUUIDPipe) postId: string,
    @Body() dto: ModeratePostDto,
  ) {
    const post = await this.interactionsService.moderatePost(postId, dto.status);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      organizationId: user.organizationId,
      action: 'feed_post.moderate',
      entityType: 'feed_post',
      entityId: postId,
      metadata: { newStatus: dto.status },
    });
    return { success: true, data: post };
  }

  @Patch('comments/:commentId')
  @ApiOperation({ summary: 'Moderate a feed comment' })
  async moderateComment(
    @CurrentUser() user: JwtPayload,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: ModeratePostDto,
  ) {
    const comment = await this.interactionsService.moderateComment(commentId, dto.status);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      organizationId: user.organizationId,
      action: 'feed_comment.moderate',
      entityType: 'feed_comment',
      entityId: commentId,
      metadata: { newStatus: dto.status },
    });
    return { success: true, data: comment };
  }
}
