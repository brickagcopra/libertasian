import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { PlansService } from './plans.service';
import {
  CreatePlanDto,
  UpdatePlanDto,
  CreatePlanPriceDto,
  UpdatePlanPriceDto,
  CreatePlanEntitlementDto,
  UpdatePlanEntitlementDto,
} from './dto';

/**
 * Admin plans controller — MFA enforced for admin roles.
 * Rate limited to 100 requests per minute per CLAUDE.md.
 */
@ApiTags('Admin — Plans')
@Controller('admin/plans')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions({ permissions: ['admin:plans', 'subscriptions:manage'], mode: 'any' })
@Throttle({ default: { ttl: 60000, limit: 100 } })
@ApiBearerAuth()
export class PlansAdminController {
  constructor(
    private readonly plansService: PlansService,
    private readonly auditService: AuditService,
  ) {}

  // ---- Plan CRUD ----

  @Get()
  @ApiOperation({ summary: 'List all plans (admin view — includes archived/inactive)' })
  async listPlans() {
    const plans = await this.plansService.findAllAdmin();
    return { success: true, data: plans };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get plan details by ID' })
  async getPlan(@Param('id', ParseUUIDPipe) id: string) {
    const plan = await this.plansService.findById(id);
    return { success: true, data: plan };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new plan' })
  async createPlan(
    @Body() dto: CreatePlanDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const plan = await this.plansService.create(dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'plan.create',
      entityType: 'plan',
      entityId: plan.id,
      metadata: { ip, code: dto.code, name: dto.name },
    });
    return { success: true, data: plan };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a plan' })
  async updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const plan = await this.plansService.update(id, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'plan.update',
      entityType: 'plan',
      entityId: id,
      metadata: { ip, changes: Object.keys(dto) },
    });
    return { success: true, data: plan };
  }

  @Post(':id/archive')
  @ApiOperation({ summary: 'Archive a plan (soft-delete)' })
  async archivePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const plan = await this.plansService.archive(id);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'plan.archive',
      entityType: 'plan',
      entityId: id,
      metadata: { ip, code: plan.code },
    });
    return { success: true, data: plan };
  }

  // ---- Plan Comparison ----

  @Get('compare/:fromCode/:toCode')
  @ApiOperation({ summary: 'Compare two plans (entitlement diff)' })
  async comparePlans(
    @Param('fromCode') fromCode: string,
    @Param('toCode') toCode: string,
  ) {
    const comparison = await this.plansService.comparePlans(fromCode, toCode);
    return { success: true, data: comparison };
  }

  // ---- Price Management ----

  @Post(':id/prices')
  @ApiOperation({ summary: 'Add a price tier to a plan' })
  async createPrice(
    @Param('id', ParseUUIDPipe) planId: string,
    @Body() dto: CreatePlanPriceDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const price = await this.plansService.createPrice(planId, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'plan.price_create',
      entityType: 'plan_price',
      entityId: price.id,
      metadata: { ip, planId, interval: dto.billingInterval, amount: dto.amount },
    });
    return { success: true, data: price };
  }

  @Patch(':id/prices/:priceId')
  @ApiOperation({ summary: 'Update a plan price' })
  async updatePrice(
    @Param('id', ParseUUIDPipe) planId: string,
    @Param('priceId', ParseUUIDPipe) priceId: string,
    @Body() dto: UpdatePlanPriceDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const price = await this.plansService.updatePrice(planId, priceId, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'plan.price_update',
      entityType: 'plan_price',
      entityId: priceId,
      metadata: { ip, planId, changes: Object.keys(dto) },
    });
    return { success: true, data: price };
  }

  @Delete(':id/prices/:priceId')
  @ApiOperation({ summary: 'Deactivate a plan price' })
  async deactivatePrice(
    @Param('id', ParseUUIDPipe) planId: string,
    @Param('priceId', ParseUUIDPipe) priceId: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const price = await this.plansService.deactivatePrice(planId, priceId);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'plan.price_deactivate',
      entityType: 'plan_price',
      entityId: priceId,
      metadata: { ip, planId },
    });
    return { success: true, data: price };
  }

  // ---- Entitlement Management ----

  @Post(':id/entitlements')
  @ApiOperation({ summary: 'Add an entitlement to a plan' })
  async createEntitlement(
    @Param('id', ParseUUIDPipe) planId: string,
    @Body() dto: CreatePlanEntitlementDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const entitlement = await this.plansService.createEntitlement(planId, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'plan.entitlement_create',
      entityType: 'plan_entitlement',
      entityId: entitlement.id,
      metadata: { ip, planId, key: dto.key, valueType: dto.valueType },
    });
    return { success: true, data: entitlement };
  }

  @Patch(':id/entitlements/:entitlementId')
  @ApiOperation({ summary: 'Update a plan entitlement' })
  async updateEntitlement(
    @Param('id', ParseUUIDPipe) planId: string,
    @Param('entitlementId', ParseUUIDPipe) entitlementId: string,
    @Body() dto: UpdatePlanEntitlementDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    const entitlement = await this.plansService.updateEntitlement(planId, entitlementId, dto);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'plan.entitlement_update',
      entityType: 'plan_entitlement',
      entityId: entitlementId,
      metadata: { ip, planId, changes: Object.keys(dto) },
    });
    return { success: true, data: entitlement };
  }

  @Delete(':id/entitlements/:entitlementId')
  @ApiOperation({ summary: 'Delete a plan entitlement' })
  async deleteEntitlement(
    @Param('id', ParseUUIDPipe) planId: string,
    @Param('entitlementId', ParseUUIDPipe) entitlementId: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.plansService.deleteEntitlement(planId, entitlementId);
    await this.auditService.log({
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'plan.entitlement_delete',
      entityType: 'plan_entitlement',
      entityId: entitlementId,
      metadata: { ip, planId },
    });
    return { success: true, data: { message: 'Entitlement deleted' } };
  }
}
