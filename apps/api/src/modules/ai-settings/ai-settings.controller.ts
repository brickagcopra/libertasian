import {
  Body,
  Controller,
  Get,
  Param,
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
import { AiSettingsService } from './ai-settings.service';
import { UpdateAiSettingDto, ResetUsageDto } from './dto';

/**
 * Admin AI settings controller — manages LLM budget, model selection,
 * and ingestion scheduling.
 *
 * All endpoints require admin role + MFA.
 */
@ApiTags('Admin — AI Settings')
@Controller('admin/ai-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions({ permissions: ['admin:ai-settings'], mode: 'any' })
@Throttle({ default: { ttl: 60000, limit: 100 } })
export class AiSettingsController {
  constructor(private readonly aiSettings: AiSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all AI settings' })
  async getAll() {
    return this.aiSettings.getAllSettings();
  }

  @Get(':key')
  @ApiOperation({ summary: 'Get a single AI setting by key' })
  async getOne(@Param('key') key: string) {
    return this.aiSettings.getSetting(key);
  }

  @Patch(':key')
  @ApiOperation({ summary: 'Update an AI setting' })
  async update(
    @Param('key') key: string,
    @Body() dto: UpdateAiSettingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.aiSettings.updateSetting(key, dto.value, user.sub);
    return { success: true };
  }

  @Get('usage/current')
  @ApiOperation({ summary: 'Get current month LLM usage and budget status' })
  async getUsageCurrent() {
    return this.aiSettings.getUsageSummary();
  }

  @Get('usage/history')
  @ApiOperation({ summary: 'Get LLM usage history for the last N months' })
  async getUsageHistory(@Query('months') months?: string) {
    const n = months ? parseInt(months, 10) : 12;
    return this.aiSettings.getUsageHistory(Math.min(Math.max(n, 1), 24));
  }

  @Post('usage/reset')
  @ApiOperation({ summary: 'Emergency reset of monthly usage counters' })
  async resetUsage(
    @Body() dto: ResetUsageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    if (dto.confirmation !== 'RESET') {
      return { success: false, message: 'Confirmation must be "RESET"' };
    }
    await this.aiSettings.resetUsage(dto.month, user.sub);
    return { success: true };
  }
}
