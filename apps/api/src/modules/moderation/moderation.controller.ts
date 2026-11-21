import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredPlatformPermissions } from '../../common/decorators/platform-permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { PlatformPermissionsGuard } from '../../common/guards/platform-permissions.guard';
import {
  CaseParamsDto,
  CreateSanctionDto,
  CursorQueryDto,
  ListCasesQueryDto,
  ListSanctionsQueryDto,
  NoteDto,
  ResolveCaseDto,
} from './dto/moderation.dto';
import { ModerationService } from './moderation.service';

/**
 * Platform moderation queue. The community is cross-org, so this is a
 * PLATFORM capability: platform_role_grants only, never a workspace role.
 */
@ApiTags('Admin — Moderation')
@Controller('admin/moderation')
@UseGuards(JwtAuthGuard, MfaGuard, PlatformPermissionsGuard)
@RequiredPlatformPermissions('community:moderate')
@Throttle({ default: { ttl: 60000, limit: 100 } })
@ApiBearerAuth()
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Queue health: open, overdue (>24h), resolution time' })
  async stats() {
    return { success: true, data: await this.moderation.getStats() };
  }

  @Get('cases')
  @ApiOperation({ summary: 'Report cases (one per reported target), oldest first by default' })
  async listCases(@Query() query: ListCasesQueryDto) {
    const result = await this.moderation.listCases(query);
    return { success: true, data: result.items, meta: { total: result.total, hasNext: result.hasNext } };
  }

  @Get('cases/:targetType/:targetId')
  @ApiOperation({ summary: 'Case detail: content, context, reports, author, history' })
  async getCase(@CurrentUser() user: JwtPayload, @Param() params: CaseParamsDto) {
    return { success: true, data: await this.moderation.getCase(params.targetType, params.targetId, user.sub) };
  }

  @Post('cases/:targetType/:targetId/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Dismiss the reports or remove the content; resolves every open report' })
  async resolveCase(@CurrentUser() user: JwtPayload, @Param() params: CaseParamsDto, @Body() dto: ResolveCaseDto) {
    return {
      success: true,
      data: await this.moderation.resolveCase(params.targetType, params.targetId, dto, user.sub),
    };
  }

  @Post('content/:targetType/:targetId/restore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restore removed or auto-hidden content' })
  async restore(@CurrentUser() user: JwtPayload, @Param() params: CaseParamsDto, @Body() dto: NoteDto) {
    return {
      success: true,
      data: await this.moderation.restoreContent(params.targetType, params.targetId, dto.note, user.sub),
    };
  }

  @Get('users/:userId')
  @ApiOperation({ summary: "A user's moderation profile: sanctions, stats, history" })
  async user(@Param('userId', ParseUUIDPipe) userId: string) {
    return { success: true, data: await this.moderation.getUserProfile(userId) };
  }

  @Post('users/:userId/sanctions')
  @ApiOperation({ summary: 'Warn, suspend or ban a user from the community' })
  async createSanction(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: CreateSanctionDto,
  ) {
    return { success: true, data: await this.moderation.createSanction(userId, dto, user.sub) };
  }

  @Post('sanctions/:id/revoke')
  @HttpCode(200)
  @ApiOperation({ summary: 'Lift a sanction' })
  async revokeSanction(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NoteDto,
  ) {
    return { success: true, data: await this.moderation.revokeSanction(id, dto.note, user.sub) };
  }

  @Get('sanctions')
  @ApiOperation({ summary: 'Sanctions; active only unless active=false' })
  async listSanctions(@Query() query: ListSanctionsQueryDto) {
    const result = await this.moderation.listSanctions(query);
    return { success: true, data: result.items, meta: { hasNext: result.hasNext, nextCursor: result.nextCursor } };
  }

  @Get('log')
  @ApiOperation({ summary: 'Moderation action log, newest first' })
  async log(@Query() query: CursorQueryDto) {
    const result = await this.moderation.listLog(query);
    return { success: true, data: result.items, meta: { hasNext: result.hasNext, nextCursor: result.nextCursor } };
  }
}
