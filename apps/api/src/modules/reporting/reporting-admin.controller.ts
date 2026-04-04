import { Controller, Get, Ip, Query, UseGuards } from '@nestjs/common';
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
import { ReportingService } from './reporting.service';
import { DateRangeQueryDto, TrendQueryDto, TopItemsQueryDto } from './dto';

@ApiTags('Admin -- Reporting')
@Controller('admin/reporting')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions({ permissions: ['admin:billing'], mode: 'any' })
@ApiBearerAuth()
@Throttle({ default: { ttl: 60000, limit: 100 } })
export class ReportingAdminController {
  constructor(
    private readonly reportingService: ReportingService,
    private readonly auditService: AuditService,
  ) {}

  // =====================================================================
  // Revenue
  // =====================================================================

  @Get('revenue/summary')
  @ApiOperation({ summary: 'Get revenue summary (MRR, ARR, ARPU, net revenue)' })
  async getRevenueSummary(
    @Query() dto: DateRangeQueryDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = await this.reportingService.getRevenueSummary(dto);
    await this.audit(user, ip, 'reporting.revenue_summary');
    return { success: true, data };
  }

  @Get('revenue/trend')
  @ApiOperation({ summary: 'Get revenue trend over time' })
  async getRevenueTrend(
    @Query() dto: TrendQueryDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = await this.reportingService.getRevenueTrend(dto);
    await this.audit(user, ip, 'reporting.revenue_trend');
    return { success: true, data };
  }

  @Get('revenue/by-plan')
  @ApiOperation({ summary: 'Get revenue breakdown by plan' })
  async getRevenueByPlan(
    @Query() dto: DateRangeQueryDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = await this.reportingService.getRevenueByPlan(dto);
    await this.audit(user, ip, 'reporting.revenue_by_plan');
    return { success: true, data };
  }

  // =====================================================================
  // Subscriptions
  // =====================================================================

  @Get('subscriptions/summary')
  @ApiOperation({ summary: 'Get subscription summary (active, churn, growth)' })
  async getSubscriptionSummary(
    @Query() dto: DateRangeQueryDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = await this.reportingService.getSubscriptionSummary(dto);
    await this.audit(user, ip, 'reporting.subscription_summary');
    return { success: true, data };
  }

  @Get('subscriptions/trend')
  @ApiOperation({ summary: 'Get subscription trend (new vs cancelled over time)' })
  async getSubscriptionTrend(
    @Query() dto: TrendQueryDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = await this.reportingService.getSubscriptionTrend(dto);
    await this.audit(user, ip, 'reporting.subscription_trend');
    return { success: true, data };
  }

  @Get('subscriptions/distribution')
  @ApiOperation({ summary: 'Get subscription distribution by plan, status, billing period' })
  async getSubscriptionDistribution(
    @Query() dto: DateRangeQueryDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = await this.reportingService.getSubscriptionDistribution(dto);
    await this.audit(user, ip, 'reporting.subscription_distribution');
    return { success: true, data };
  }

  // =====================================================================
  // Trials
  // =====================================================================

  @Get('trials/summary')
  @ApiOperation({ summary: 'Get trial summary (conversion rate, avg duration)' })
  async getTrialSummary(
    @Query() dto: DateRangeQueryDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = await this.reportingService.getTrialSummary(dto);
    await this.audit(user, ip, 'reporting.trial_summary');
    return { success: true, data };
  }

  // =====================================================================
  // Payments
  // =====================================================================

  @Get('payments/summary')
  @ApiOperation({ summary: 'Get payment summary (success rate, avg value)' })
  async getPaymentSummary(
    @Query() dto: DateRangeQueryDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = await this.reportingService.getPaymentSummary(dto);
    await this.audit(user, ip, 'reporting.payment_summary');
    return { success: true, data };
  }

  @Get('payments/trend')
  @ApiOperation({ summary: 'Get payment trend (succeeded vs failed over time)' })
  async getPaymentTrend(
    @Query() dto: TrendQueryDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = await this.reportingService.getPaymentTrend(dto);
    await this.audit(user, ip, 'reporting.payment_trend');
    return { success: true, data };
  }

  // =====================================================================
  // Discounts
  // =====================================================================

  @Get('discounts/summary')
  @ApiOperation({ summary: 'Get discount summary (coupon + promotion impact)' })
  async getDiscountSummary(
    @Query() dto: DateRangeQueryDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = await this.reportingService.getDiscountSummary(dto);
    await this.audit(user, ip, 'reporting.discount_summary');
    return { success: true, data };
  }

  @Get('discounts/top-coupons')
  @ApiOperation({ summary: 'Get top coupons by redemption count' })
  async getTopCoupons(
    @Query() dto: TopItemsQueryDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = await this.reportingService.getTopCoupons(dto);
    await this.audit(user, ip, 'reporting.top_coupons');
    return { success: true, data };
  }

  @Get('discounts/top-promotions')
  @ApiOperation({ summary: 'Get top promotions by discount amount' })
  async getTopPromotions(
    @Query() dto: TopItemsQueryDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = await this.reportingService.getTopPromotions(dto);
    await this.audit(user, ip, 'reporting.top_promotions');
    return { success: true, data };
  }

  // =====================================================================
  // Customers
  // =====================================================================

  @Get('customers/summary')
  @ApiOperation({ summary: 'Get customer summary (org counts, signups, seat utilization)' })
  async getCustomerSummary(
    @Query() dto: DateRangeQueryDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const data = await this.reportingService.getCustomerSummary(dto);
    await this.audit(user, ip, 'reporting.customer_summary');
    return { success: true, data };
  }

  // =====================================================================
  // Private helpers
  // =====================================================================

  private async audit(user: JwtPayload, ip: string, action: string): Promise<void> {
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action,
      entityType: 'Report',
      metadata: { ip },
    });
  }
}
