import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
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
import { AuditService } from '../audit/audit.service';
import { CouponService } from './coupon.service';
import {
  CreateCouponDto,
  UpdateCouponDto,
  ListCouponsQueryDto,
  ListRedemptionsQueryDto,
  AssignCouponUsersDto,
  AssignCouponOrgsDto,
  SetCouponPlanRulesDto,
} from './dto';

@ApiTags('Admin — Coupons')
@Controller('admin/coupons')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions({ permissions: ['admin:billing'], mode: 'any' })
@ApiBearerAuth()
@Throttle({ default: { ttl: 60000, limit: 100 } })
export class CouponAdminController {
  constructor(
    private readonly couponService: CouponService,
    private readonly auditService: AuditService,
  ) {}

  // ---- Coupon CRUD ----

  @Get()
  @ApiOperation({ summary: 'List all coupons (admin view — includes archived/inactive)' })
  async listCoupons(@Query() query: ListCouponsQueryDto) {
    const result = await this.couponService.list(query);
    return { success: true, data: result.data, nextCursor: result.nextCursor, hasNext: result.hasNext };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get coupon details by ID with stats' })
  async getCoupon(@Param('id', ParseUUIDPipe) id: string) {
    const coupon = await this.couponService.findById(id);
    return { success: true, data: coupon };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new coupon' })
  async createCoupon(
    @Body() dto: CreateCouponDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const coupon = await this.couponService.create(dto, user.sub);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'coupon.create',
      entityType: 'Coupon',
      entityId: coupon.id,
      metadata: { ip, code: coupon.code, discountType: dto.discountType, discountValue: dto.discountValue },
    });
    return { success: true, data: coupon };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a coupon' })
  async updateCoupon(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCouponDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const coupon = await this.couponService.update(id, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'coupon.update',
      entityType: 'Coupon',
      entityId: id,
      metadata: { ip, changes: Object.keys(dto) },
    });
    return { success: true, data: coupon };
  }

  @Post(':id/archive')
  @ApiOperation({ summary: 'Archive a coupon (soft-delete, cannot be used after archiving)' })
  async archiveCoupon(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const coupon = await this.couponService.archive(id);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'coupon.archive',
      entityType: 'Coupon',
      entityId: id,
      metadata: { ip, code: coupon.code },
    });
    return { success: true, data: coupon };
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Activate a coupon' })
  async activateCoupon(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const coupon = await this.couponService.toggleActive(id, true);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'coupon.activate',
      entityType: 'Coupon',
      entityId: id,
      metadata: { ip, code: coupon.code },
    });
    return { success: true, data: coupon };
  }

  @Post(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate a coupon' })
  async deactivateCoupon(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const coupon = await this.couponService.toggleActive(id, false);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'coupon.deactivate',
      entityType: 'Coupon',
      entityId: id,
      metadata: { ip, code: coupon.code },
    });
    return { success: true, data: coupon };
  }

  // ---- Redemption History ----

  @Get(':id/redemptions')
  @ApiOperation({ summary: 'Get redemption history for a coupon' })
  async getRedemptions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListRedemptionsQueryDto,
  ) {
    const result = await this.couponService.getRedemptionHistory(id, query);
    return { success: true, data: result.data, nextCursor: result.nextCursor, hasNext: result.hasNext };
  }

  // ---- Assignments ----

  @Post(':id/assign-users')
  @ApiOperation({ summary: 'Pre-assign coupon to specific users' })
  async assignUsers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignCouponUsersDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.couponService.assignUsers(id, dto.userIds);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'coupon.assign_users',
      entityType: 'Coupon',
      entityId: id,
      metadata: { ip, userCount: dto.userIds.length },
    });
    return { success: true, data: result };
  }

  @Post(':id/assign-orgs')
  @ApiOperation({ summary: 'Pre-assign coupon to specific organizations' })
  async assignOrgs(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignCouponOrgsDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const result = await this.couponService.assignOrgs(id, dto.organizationIds);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'coupon.assign_orgs',
      entityType: 'Coupon',
      entityId: id,
      metadata: { ip, orgCount: dto.organizationIds.length },
    });
    return { success: true, data: result };
  }

  // ---- Plan Rules ----

  @Post(':id/plan-rules')
  @ApiOperation({ summary: 'Set plan rules for a coupon (replaces all existing rules)' })
  async setPlanRules(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCouponPlanRulesDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const rules = await this.couponService.setPlanRules(id, dto.rules);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'coupon.set_plan_rules',
      entityType: 'Coupon',
      entityId: id,
      metadata: { ip, ruleCount: dto.rules.length },
    });
    return { success: true, data: rules };
  }
}
