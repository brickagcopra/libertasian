import { Body, Controller, Ip, Post, UseGuards } from '@nestjs/common';
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
import { SimulatorService } from './simulator.service';
import {
  SimulateTransitionDto,
  SimulateLifecycleDto,
  SimulatePricingDto,
  SimulateProrationDto,
  SimulateCouponDto,
  SimulatePromotionDto,
  SimulateRevenueImpactDto,
} from './dto';

@ApiTags('Admin — Simulator')
@Controller('admin/simulator')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions({ permissions: ['admin:billing'], mode: 'any' })
@ApiBearerAuth()
@Throttle({ default: { ttl: 60000, limit: 100 } })
export class SimulatorAdminController {
  constructor(
    private readonly simulatorService: SimulatorService,
    private readonly auditService: AuditService,
  ) {}

  @Post('transition')
  @ApiOperation({ summary: 'Simulate a single subscription state transition' })
  async simulateTransition(
    @Body() dto: SimulateTransitionDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = this.simulatorService.simulateTransition(dto);

    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'simulator.transition',
      entityType: 'Simulator',
      metadata: { ip, input: { currentState: dto.currentState, action: dto.action } },
    });

    return { success: true, data };
  }

  @Post('lifecycle')
  @ApiOperation({ summary: 'Simulate a multi-step subscription lifecycle' })
  async simulateLifecycle(
    @Body() dto: SimulateLifecycleDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = this.simulatorService.simulateLifecycle(dto);

    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'simulator.lifecycle',
      entityType: 'Simulator',
      metadata: { ip, input: { startingState: dto.startingState, actionCount: dto.actions.length } },
    });

    return { success: true, data };
  }

  @Post('pricing')
  @ApiOperation({ summary: 'Simulate full pricing breakdown for a plan' })
  async simulatePricing(
    @Body() dto: SimulatePricingDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = await this.simulatorService.simulatePricing(dto);

    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'simulator.pricing',
      entityType: 'Simulator',
      metadata: { ip, input: { planCode: dto.planCode, billingPeriod: dto.billingPeriod } },
    });

    return { success: true, data };
  }

  @Post('proration')
  @ApiOperation({ summary: 'Simulate plan change proration calculation' })
  async simulateProration(
    @Body() dto: SimulateProrationDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = await this.simulatorService.simulateProration(dto);

    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'simulator.proration',
      entityType: 'Simulator',
      metadata: {
        ip,
        input: { currentPlanCode: dto.currentPlanCode, newPlanCode: dto.newPlanCode },
      },
    });

    return { success: true, data };
  }

  @Post('coupon')
  @ApiOperation({ summary: 'Simulate coupon validation and discount calculation' })
  async simulateCoupon(
    @Body() dto: SimulateCouponDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = await this.simulatorService.simulateCoupon(dto);

    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'simulator.coupon',
      entityType: 'Simulator',
      metadata: { ip, input: { couponCode: dto.couponCode, planCode: dto.planCode } },
    });

    return { success: true, data };
  }

  @Post('promotion')
  @ApiOperation({ summary: 'Simulate promotion eligibility and discount' })
  async simulatePromotion(
    @Body() dto: SimulatePromotionDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = await this.simulatorService.simulatePromotion(dto);

    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'simulator.promotion',
      entityType: 'Simulator',
      metadata: { ip, input: { promotionId: dto.promotionId, planCode: dto.planCode } },
    });

    return { success: true, data };
  }

  @Post('revenue-impact')
  @ApiOperation({ summary: 'Simulate revenue impact of a coupon or promotion across plans' })
  async simulateRevenueImpact(
    @Body() dto: SimulateRevenueImpactDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = await this.simulatorService.simulateRevenueImpact(dto);

    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'simulator.revenue_impact',
      entityType: 'Simulator',
      metadata: {
        ip,
        input: {
          couponId: dto.couponId ?? null,
          promotionId: dto.promotionId ?? null,
          planCount: dto.plans.length,
        },
      },
    });

    return { success: true, data };
  }
}
