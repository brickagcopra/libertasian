import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TrackEvent } from '../analytics';
import { SubscriptionOperationsService } from './subscription-operations.service';
import {
  StartTrialDto,
  ConvertTrialDto,
  UpgradePlanDto,
  DowngradePlanDto,
  PauseSubscriptionDto,
} from './dto';

@ApiTags('Subscriptions')
@Controller('subscriptions')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@ApiBearerAuth()
@Throttle({ default: { ttl: 60000, limit: 20 } })
export class SubscriptionOperationsController {
  constructor(
    private readonly operationsService: SubscriptionOperationsService,
  ) {}

  @Post('trial/start')
  @ApiOperation({ summary: 'Start a free trial for the current organization' })
  @RequiredPermissions('subscriptions:manage')
  @TrackEvent('subscription_started', (req) => ({
    plan_code: (req.body?.planCode as string) ?? 'unknown',
    billing_period: 'trial',
  }))
  async startTrial(
    @Body() dto: StartTrialDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.operationsService.startTrial(
      user.organizationId,
      dto.planCode,
      user.sub,
    );
    return { success: true, data: result };
  }

  @Post(':id/trial/convert')
  @ApiOperation({ summary: 'Convert an active trial to a paid subscription' })
  @RequiredPermissions('subscriptions:manage')
  async convertTrial(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertTrialDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.operationsService.convertTrial(
      id,
      user.organizationId,
      dto.billingPeriod,
      user.sub,
    );
    return { success: true, data: result };
  }

  @Post('upgrade')
  @ApiOperation({ summary: 'Upgrade to a higher-tier plan (immediate proration)' })
  @RequiredPermissions('subscriptions:manage')
  @TrackEvent('subscription_upgraded', (req) => ({
    from_plan: 'current',
    to_plan: (req.body?.targetPlanCode as string) ?? 'unknown',
    trigger: 'user_initiated',
  }))
  async upgradePlan(
    @Body() dto: UpgradePlanDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.operationsService.upgradePlan(
      user.organizationId,
      dto.targetPlanCode,
      dto.billingPeriod,
      user.sub,
    );
    return { success: true, data: result };
  }

  @Post('downgrade')
  @ApiOperation({ summary: 'Downgrade to a lower-tier plan (end of period by default)' })
  @RequiredPermissions('subscriptions:manage')
  async downgradePlan(
    @Body() dto: DowngradePlanDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.operationsService.downgradePlan(
      user.organizationId,
      dto.targetPlanCode,
      dto.billingPeriod,
      dto.immediate ?? false,
      user.sub,
    );
    return { success: true, data: result };
  }

  @Post(':id/pause')
  @ApiOperation({ summary: 'Pause an active subscription' })
  @RequiredPermissions('subscriptions:manage')
  async pauseSubscription(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PauseSubscriptionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.operationsService.pauseSubscription(
      id,
      user.organizationId,
      user.sub,
      dto.reason,
    );
    return { success: true, data: result };
  }

  @Post(':id/resume')
  @ApiOperation({ summary: 'Resume a paused subscription' })
  @RequiredPermissions('subscriptions:manage')
  async resumeSubscription(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.operationsService.resumeSubscription(
      id,
      user.organizationId,
      user.sub,
    );
    return { success: true, data: result };
  }

  @Post(':id/reactivate')
  @ApiOperation({ summary: 'Reactivate a cancelled subscription' })
  @RequiredPermissions('subscriptions:manage')
  async reactivateSubscription(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const result = await this.operationsService.reactivateSubscription(
      id,
      user.organizationId,
      user.sub,
    );
    return { success: true, data: result };
  }
}
